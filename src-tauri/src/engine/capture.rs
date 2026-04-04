use std::collections::{HashMap, HashSet};
use std::io::{BufRead, BufReader, Read};
use std::process::{Child, ChildStderr, ChildStdout, Command, Stdio};
use std::sync::{Arc, Mutex, OnceLock};

use super::audio::supports_dshow;
use super::source::note_source_error;
use super::state::{GPUStreamConfig, NativeVideoSourceConfig};
use super::video::{clear_source_frame, store_source_frame};

#[cfg(target_os = "windows")]
const CREATE_NO_WINDOW: u32 = 0x08000000;

fn configure_background_command(command: &mut Command) -> &mut Command {
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(CREATE_NO_WINDOW);
    }

    command
}

#[derive(Debug, Clone)]
struct NativeVideoDevice {
    name: String,
    alternative_name: Option<String>,
    backend: String,
}

struct NativeSourceWorker {
    session_id: u64,
    child: Arc<Mutex<Child>>,
}

fn native_source_workers() -> &'static Mutex<HashMap<String, NativeSourceWorker>> {
    static INSTANCE: OnceLock<Mutex<HashMap<String, NativeSourceWorker>>> = OnceLock::new();
    INSTANCE.get_or_init(|| Mutex::new(HashMap::new()))
}

pub fn start_native_source_captures(
    ffmpeg_bin: &str,
    config: &GPUStreamConfig,
    session_id: u64,
) -> Result<(), String> {
    stop_native_source_captures();

    if config.native_video_sources.is_empty() {
        return Ok(());
    }

    if !supports_dshow(ffmpeg_bin) {
        for source in &config.native_video_sources {
            note_source_error(
                &source.source_id,
                "Native video capture requires FFmpeg DirectShow support".into(),
            );
            clear_source_frame(&source.source_id);
        }
        return Ok(());
    }

    let devices = list_video_devices(ffmpeg_bin);
    if devices.is_empty() {
        for source in &config.native_video_sources {
            note_source_error(
                &source.source_id,
                "No native DirectShow video devices were detected".into(),
            );
            clear_source_frame(&source.source_id);
        }
        return Ok(());
    }

    let mut auto_reserved = HashSet::new();
    for source in &config.native_video_sources {
        let device = resolve_video_device(&devices, source, &mut auto_reserved);
        let Some(device) = device else {
            let requested = source.device_name.trim();
            let message = if requested.is_empty() {
                "No native video device was available for capture".into()
            } else {
                format!("Native video device '{}' was not found", requested)
            };
            note_source_error(&source.source_id, message);
            clear_source_frame(&source.source_id);
            continue;
        };

        if let Err(err) = spawn_native_source_worker(
            ffmpeg_bin,
            session_id,
            source.clone(),
            device,
        ) {
            note_source_error(&source.source_id, err.clone());
            clear_source_frame(&source.source_id);
        }
    }

    Ok(())
}

pub fn stop_native_source_captures() {
    let worker_handles = {
        let mut workers = match native_source_workers().lock() {
            Ok(guard) => guard,
            Err(_) => return,
        };

        let handles = workers
            .drain()
            .map(|(source_id, worker)| (source_id, worker.child))
            .collect::<Vec<_>>();
        handles
    };

    for (source_id, child_handle) in worker_handles {
        clear_source_frame(&source_id);
        if let Ok(mut child) = child_handle.lock() {
            let _ = child.kill();
            let _ = child.wait();
        }
    }
}

fn spawn_native_source_worker(
    ffmpeg_bin: &str,
    session_id: u64,
    source: NativeVideoSourceConfig,
    device: NativeVideoDevice,
) -> Result<(), String> {
    let args = build_native_source_ffmpeg_args(&source, &device);
    println!(
        "[aether] Native source worker {} [{}] command: {} {}",
        source.source_id,
        device.name,
        ffmpeg_bin,
        args.join(" ")
    );

    let mut cmd = Command::new(ffmpeg_bin);
    cmd.args(&args)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x08000000);
    }

    let mut child = cmd.spawn().map_err(|e| {
        format!(
            "Failed to start native capture for {} ({}): {}",
            source.source_id, device.name, e
        )
    })?;
    let stdout = child.stdout.take().ok_or_else(|| {
        format!(
            "Native capture stdout unavailable for {} ({})",
            source.source_id, device.name
        )
    })?;
    let stderr = child.stderr.take();
    let child_handle = Arc::new(Mutex::new(child));

    {
        let mut workers = native_source_workers().lock().map_err(|e| e.to_string())?;
        workers.insert(
            source.source_id.clone(),
            NativeSourceWorker {
                session_id,
                child: child_handle.clone(),
            },
        );
    }

    spawn_native_source_monitor(session_id, source, device, child_handle, stdout, stderr);
    Ok(())
}

fn spawn_native_source_monitor(
    session_id: u64,
    source: NativeVideoSourceConfig,
    device: NativeVideoDevice,
    child_handle: Arc<Mutex<Child>>,
    mut stdout: ChildStdout,
    stderr: Option<ChildStderr>,
) {
    std::thread::spawn(move || {
        let last_error = Arc::new(Mutex::new(None::<String>));
        if let Some(stderr) = stderr {
            let source_id = source.source_id.clone();
            let device_name = device.name.clone();
            let last_error_ref = last_error.clone();
            std::thread::spawn(move || {
                let reader = BufReader::new(stderr);
                for line in reader.lines() {
                    let Ok(line) = line else {
                        break;
                    };
                    let trimmed = line.trim();
                    if trimmed.is_empty() {
                        continue;
                    }

                    println!("[native-source:{}] {}", source_id, trimmed);
                    let lowered = trimmed.to_ascii_lowercase();
                    if lowered.contains("error")
                        || lowered.contains("failed")
                        || lowered.contains("invalid")
                        || lowered.contains("timed out")
                    {
                        let message = format!("{}: {}", device_name, trimmed);
                        if let Ok(mut guard) = last_error_ref.lock() {
                            *guard = Some(message.clone());
                        }
                        note_source_error(&source_id, message);
                    }
                }
            });
        }

        let frame_len = (source.width as usize)
            .saturating_mul(source.height as usize)
            .saturating_mul(4);
        let mut frame = vec![0u8; frame_len];

        loop {
            match stdout.read_exact(&mut frame) {
                Ok(()) => {
                    if let Err(err) = store_source_frame(
                        &source.source_id,
                        source.width,
                        source.height,
                        frame.clone(),
                    ) {
                        if let Ok(mut guard) = last_error.lock() {
                            *guard = Some(err.clone());
                        }
                        note_source_error(&source.source_id, err);
                    }
                }
                Err(_) => break,
            }
        }

        let status_text = {
            let mut child = match child_handle.lock() {
                Ok(guard) => guard,
                Err(_) => return,
            };
            match child.wait() {
                Ok(status) => format!("{status}"),
                Err(err) => format!("wait failed: {err}"),
            }
        };

        let still_owned = {
            let mut workers = match native_source_workers().lock() {
                Ok(guard) => guard,
                Err(_) => return,
            };

            if let Some(worker) = workers.get(&source.source_id) {
                if worker.session_id == session_id {
                    workers.remove(&source.source_id);
                    true
                } else {
                    false
                }
            } else {
                false
            }
        };

        if still_owned {
            clear_source_frame(&source.source_id);
            let error_message = last_error
                .lock()
                .ok()
                .and_then(|guard| guard.clone())
                .unwrap_or_else(|| {
                    format!(
                        "Native source '{}' exited with {}",
                        source.source_id, status_text
                    )
                });
            note_source_error(&source.source_id, error_message);
        }
    });
}

fn build_native_source_ffmpeg_args(
    source: &NativeVideoSourceConfig,
    device: &NativeVideoDevice,
) -> Vec<String> {
    let width = source.width.max(2);
    let height = source.height.max(2);
    let fps = source.fps.max(1);
    let input_name = device
        .alternative_name
        .as_deref()
        .unwrap_or(&device.name)
        .to_string();
    let filter = format!(
        "fps={fps},scale={width}:{height}:flags=lanczos:force_original_aspect_ratio=decrease,pad={width}:{height}:(ow-iw)/2:(oh-ih)/2:black"
    );

    vec![
        "-hide_banner".into(),
        "-loglevel".into(),
        "warning".into(),
        "-fflags".into(),
        "+genpts+discardcorrupt+nobuffer".into(),
        "-thread_queue_size".into(),
        "4096".into(),
        "-f".into(),
        device.backend.clone(),
        "-rtbufsize".into(),
        "256M".into(),
        "-i".into(),
        format!("video={input_name}"),
        "-an".into(),
        "-vf".into(),
        filter,
        "-pix_fmt".into(),
        "rgba".into(),
        "-f".into(),
        "rawvideo".into(),
        "pipe:1".into(),
    ]
}

fn list_video_devices(ffmpeg_bin: &str) -> Vec<NativeVideoDevice> {
    let mut command = Command::new(ffmpeg_bin);
    let output = match configure_background_command(&mut command)
        .args(["-hide_banner", "-list_devices", "true", "-f", "dshow", "-i", "dummy"])
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .output()
    {
        Ok(output) => output,
        Err(_) => return Vec::new(),
    };

    parse_dshow_video_devices(&format!(
        "{}\n{}",
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr)
    ))
}

fn parse_dshow_video_devices(output: &str) -> Vec<NativeVideoDevice> {
    let mut devices: Vec<NativeVideoDevice> = Vec::new();

    for raw_line in output.lines() {
        let line = raw_line.trim();
        if let Some(name) = extract_video_device_name(line) {
            devices.push(NativeVideoDevice {
                name,
                alternative_name: None,
                backend: "dshow".into(),
            });
            continue;
        }

        if line.contains("Alternative name") {
            if let Some(last) = devices.last_mut() {
                if last.alternative_name.is_none() {
                    last.alternative_name = extract_quoted_value(line);
                }
            }
        }
    }

    devices
}

fn extract_video_device_name(line: &str) -> Option<String> {
    if !line.contains("(video)") {
        return None;
    }
    extract_quoted_value(line)
}

fn extract_quoted_value(line: &str) -> Option<String> {
    let start = line.find('"')?;
    let rest = &line[start + 1..];
    let end = rest.find('"')?;
    Some(rest[..end].to_string())
}

fn resolve_video_device(
    devices: &[NativeVideoDevice],
    source: &NativeVideoSourceConfig,
    auto_reserved: &mut HashSet<String>,
) -> Option<NativeVideoDevice> {
    let requested = source.device_name.trim();
    if !requested.is_empty() {
        return find_video_device_by_name(devices, requested).cloned();
    }

    for device in devices {
        let identity = device
            .alternative_name
            .clone()
            .unwrap_or_else(|| device.name.clone());
        if auto_reserved.insert(identity) {
            return Some(device.clone());
        }
    }

    None
}

fn find_video_device_by_name<'a>(
    devices: &'a [NativeVideoDevice],
    requested: &str,
) -> Option<&'a NativeVideoDevice> {
    let lowered = requested.to_ascii_lowercase();
    devices.iter().find(|device| {
        device.name.eq_ignore_ascii_case(requested)
            || device
                .alternative_name
                .as_ref()
                .map(|alt| alt.eq_ignore_ascii_case(requested))
                .unwrap_or(false)
            || device.name.to_ascii_lowercase().contains(&lowered)
            || device
                .alternative_name
                .as_ref()
                .map(|alt| alt.to_ascii_lowercase().contains(&lowered))
                .unwrap_or(false)
    })
}
