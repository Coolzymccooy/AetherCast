use std::collections::HashMap;
use std::io::Write;
use std::process::{Child, ChildStderr, Command, Stdio};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::Duration;

use base64::Engine;
use futures_util::StreamExt;
use tokio::net::TcpListener;
use tokio::sync::oneshot;
use tokio_tungstenite::accept_async;
use tokio_tungstenite::tungstenite::Message;

use super::audio::{
    append_audio_input_args, append_audio_output_args, apply_audio_runtime_signal,
    build_audio_plan, build_audio_status, describe_audio_plan, detect_audio_engine,
    set_audio_state, NativeAudioPlan,
};
use super::capture::{start_native_source_captures, stop_native_source_captures};
use super::ndi::{current_ndi_input_status, current_ndi_status};
use super::output::{
    append_output_args, append_worker_output_args, apply_output_runtime_signal,
    build_archive_pattern, build_output_manager_plan, build_output_statuses,
    set_output_recovery_delay_by_worker_id, set_output_state_by_worker_id, set_output_states,
    OutputManagerPlan, OutputWorkerKind, OutputWorkerPlan, DEFAULT_ARCHIVE_SEGMENT_SECONDS,
};
use super::source::{
    current_source_bridge_runtime, current_source_statuses, start_source_bridge, stop_source_bridge,
};
use super::state::{
    EngineHealthState, FrameBridgeRuntime, GPUStreamConfig, NativeAudioDiscovery,
    NativeStreamRuntime, NativeStreamStats, StartStreamResponse,
};
use super::telemetry::{build_archive_status, now_ms, set_archive_state};
use super::video::{current_video_status, render_native_scene_rgba};

const DEFAULT_MAX_RESTARTS: u32 = 48;
const DEFAULT_OUTPUT_MAX_RESTARTS: u32 = 120;
const WORKER_STDERR_CONTEXT_LINES: usize = 12;
#[cfg(target_os = "windows")]
const CREATE_NO_WINDOW: u32 = 0x08000000;
#[allow(dead_code)]
const RESTART_RESET_AFTER_MS: u64 = 180_000;

fn configure_background_command(command: &mut Command) -> &mut Command {
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(CREATE_NO_WINDOW);
    }

    command
}

#[cfg(target_os = "windows")]
pub fn cleanup_stale_aether_ffmpeg_processes() {
    let script = r#"
Get-CimInstance Win32_Process |
  Where-Object {
    $_.Name -eq 'ffmpeg.exe' -and
    $_.CommandLine -match 'pipe:0' -and
    $_.CommandLine -match 'rawvideo' -and
    $_.CommandLine -match 'VB-Audio Virtual Cable'
  } |
  ForEach-Object {
    try {
      Stop-Process -Id $_.ProcessId -Force -ErrorAction Stop
      Write-Output ('[aether] Cleaned stale FFmpeg worker PID ' + $_.ProcessId)
    } catch {
      Write-Output ('[aether] Failed to clean stale FFmpeg worker PID ' + $_.ProcessId + ': ' + $_.Exception.Message)
    }
  }
"#;

    let mut command = Command::new("powershell");
    configure_background_command(&mut command)
        .args([
            "-NoProfile",
            "-ExecutionPolicy",
            "Bypass",
            "-Command",
            script,
        ])
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    match command.output() {
        Ok(output) => {
            let stdout = String::from_utf8_lossy(&output.stdout);
            for line in stdout
                .lines()
                .map(str::trim)
                .filter(|line| !line.is_empty())
            {
                println!("{line}");
            }

            let stderr = String::from_utf8_lossy(&output.stderr);
            for line in stderr
                .lines()
                .map(str::trim)
                .filter(|line| !line.is_empty())
            {
                println!("[aether] FFmpeg cleanup stderr: {line}");
            }
        }
        Err(err) => {
            println!("[aether] Failed to run stale FFmpeg cleanup: {err}");
        }
    }
}

#[cfg(not(target_os = "windows"))]
pub fn cleanup_stale_aether_ffmpeg_processes() {}

struct OutputWorkerSink {
    session_id: u64,
    kind: OutputWorkerKind,
    recovery_delay_ms: u64,
    spawned_at_ms: u64,
    child: Arc<Mutex<Child>>,
    stdin: Arc<Mutex<std::process::ChildStdin>>,
}

fn output_worker_sinks() -> &'static Mutex<HashMap<String, OutputWorkerSink>> {
    static INSTANCE: OnceLock<Mutex<HashMap<String, OutputWorkerSink>>> = OnceLock::new();
    INSTANCE.get_or_init(|| Mutex::new(HashMap::new()))
}

#[allow(dead_code)]
fn ffmpeg_process() -> &'static Mutex<Option<Child>> {
    static INSTANCE: OnceLock<Mutex<Option<Child>>> = OnceLock::new();
    INSTANCE.get_or_init(|| Mutex::new(None))
}

#[allow(dead_code)]
fn ffmpeg_stdin() -> &'static Mutex<Option<std::process::ChildStdin>> {
    static INSTANCE: OnceLock<Mutex<Option<std::process::ChildStdin>>> = OnceLock::new();
    INSTANCE.get_or_init(|| Mutex::new(None))
}

// Frame counter for stats
fn frame_counter() -> &'static Mutex<u64> {
    static INSTANCE: OnceLock<Mutex<u64>> = OnceLock::new();
    INSTANCE.get_or_init(|| Mutex::new(0))
}

struct ReplayBuffer {
    frames: Vec<Vec<u8>>,
    capacity: usize,
    write_pos: usize,
    count: usize,
    width: u32,
    height: u32,
    fps: u32,
    active: bool,
}

impl ReplayBuffer {
    fn new() -> Self {
        Self {
            frames: Vec::new(),
            capacity: 0,
            write_pos: 0,
            count: 0,
            width: 1920,
            height: 1080,
            fps: 30,
            active: false,
        }
    }
}

fn replay_buffer() -> &'static Arc<Mutex<ReplayBuffer>> {
    static INSTANCE: OnceLock<Arc<Mutex<ReplayBuffer>>> = OnceLock::new();
    INSTANCE.get_or_init(|| Arc::new(Mutex::new(ReplayBuffer::new())))
}

fn stream_runtime() -> &'static Mutex<NativeStreamRuntime> {
    static INSTANCE: OnceLock<Mutex<NativeStreamRuntime>> = OnceLock::new();
    INSTANCE.get_or_init(|| {
        let mut runtime = NativeStreamRuntime::default();
        runtime.max_restarts = DEFAULT_MAX_RESTARTS;
        Mutex::new(runtime)
    })
}

fn frame_bridge_runtime() -> &'static Mutex<FrameBridgeRuntime> {
    static INSTANCE: OnceLock<Mutex<FrameBridgeRuntime>> = OnceLock::new();
    INSTANCE.get_or_init(|| Mutex::new(FrameBridgeRuntime::default()))
}

#[allow(dead_code)]
fn restart_delay_ms(restart_count: u32) -> u64 {
    match restart_count {
        0 | 1 => 1_000,
        2 => 2_000,
        3 => 4_000,
        4 => 8_000,
        _ => 15_000,
    }
}

fn worker_recovery_delay_ms(base_delay_ms: u64, restart_count: u32) -> u64 {
    let multiplier = match restart_count {
        0 | 1 => 1,
        2 | 3 => 2,
        4..=7 => 4,
        8..=15 => 8,
        _ => 16,
    };
    base_delay_ms
        .saturating_mul(multiplier)
        .clamp(base_delay_ms.max(1), 60_000)
}

fn stop_frame_bridge() {
    let shutdown = {
        let mut bridge = match frame_bridge_runtime().lock() {
            Ok(guard) => guard,
            Err(_) => return,
        };
        bridge.connected = false;
        bridge.url = None;
        bridge.token = None;
        bridge.frames_received = 0;
        bridge.bytes_received = 0;
        bridge.last_error = None;
        bridge.shutdown_tx.take()
    };

    if let Some(shutdown) = shutdown {
        if let Ok(mut tx_guard) = shutdown.lock() {
            if let Some(tx) = tx_guard.take() {
                let _ = tx.send(());
            }
        }
    }
}

fn write_bytes_to_workers(bytes: &[u8]) -> Result<(), String> {
    let desired_active = {
        let state = stream_runtime().lock().map_err(|e| e.to_string())?;
        state.desired_active
    };

    // Phase 1: collect stdin Arc handles without holding the main sinks lock.
    // This is critical — the blocking write_all below would otherwise hold the
    // sinks mutex for potentially hundreds of milliseconds, preventing the
    // worker monitor thread from cleaning up dead workers.
    type WriteTarget = (
        String,
        OutputWorkerKind,
        u64,
        Arc<Mutex<std::process::ChildStdin>>,
    );
    let targets: Vec<WriteTarget> = {
        let sinks = output_worker_sinks().lock().map_err(|e| e.to_string())?;
        if sinks.is_empty() {
            return if desired_active {
                Err("STREAM_RESTARTING".into())
            } else {
                Err("STREAM_DEAD".into())
            };
        }
        sinks
            .iter()
            .map(|(id, sink)| {
                (
                    id.clone(),
                    sink.kind.clone(),
                    sink.recovery_delay_ms,
                    Arc::clone(&sink.stdin),
                )
            })
            .collect()
    }; // sinks lock released — monitor thread can now clean up if FFmpeg dies

    // Phase 2: write to each worker's stdin. Each write may block for the
    // duration of the OS pipe flush. No main sinks lock held here.
    let mut succeeded = 0usize;
    let mut total_bytes_written = 0u64;
    let mut failures: Vec<(String, OutputWorkerKind, u64, String)> = Vec::new();

    for (worker_id, kind, recovery_delay_ms, stdin_arc) in &targets {
        let mut stdin = match stdin_arc.lock() {
            Ok(g) => g,
            Err(_) => {
                failures.push((
                    worker_id.clone(),
                    kind.clone(),
                    *recovery_delay_ms,
                    "stdin lock poisoned".into(),
                ));
                continue;
            }
        };
        match stdin.write_all(bytes) {
            Ok(()) => {
                succeeded += 1;
                total_bytes_written += bytes.len() as u64;
            }
            Err(err) => {
                eprintln!(
                    "[aether] write_all failed for worker {} ({:?}): {}",
                    worker_id, kind, err
                );
                failures.push((
                    worker_id.clone(),
                    kind.clone(),
                    *recovery_delay_ms,
                    err.to_string(),
                ));
            }
        }
    }

    // Phase 3: remove failed sinks (re-acquire lock briefly).
    {
        let mut sinks = output_worker_sinks().lock().map_err(|e| e.to_string())?;
        for (worker_id, _, _, _) in &failures {
            sinks.remove(worker_id);
        }
    }
    let remaining_workers = output_worker_sinks().lock().map(|s| s.len()).unwrap_or(0);

    if succeeded > 0 {
        if let Ok(mut counter) = frame_counter().lock() {
            *counter += 1;
        }
    }

    if let Ok(mut state) = stream_runtime().lock() {
        state.bytes_written += total_bytes_written;
        if !failures.is_empty() {
            state.write_failures += failures.len() as u64;
            state.last_error = Some(format!("{} output worker write failure(s)", failures.len()));
            state.last_restart_delay_ms = failures
                .iter()
                .map(|(_, _, recovery_delay_ms, _)| *recovery_delay_ms)
                .max()
                .unwrap_or(0);
        }
        state.active = remaining_workers > 0;
        if desired_active && !failures.is_empty() {
            state.restarting = true;
        } else if remaining_workers > 0 {
            state.restarting = false;
        }

        for (worker_id, kind, recovery_delay_ms, error) in &failures {
            match kind {
                OutputWorkerKind::Destination => {
                    set_output_recovery_delay_by_worker_id(
                        &mut state.output_statuses,
                        worker_id,
                        *recovery_delay_ms,
                    );
                    set_output_state_by_worker_id(
                        &mut state.output_statuses,
                        worker_id,
                        EngineHealthState::Recovering,
                        Some(format!("Worker pipe write failed: {}", error)),
                    );
                }
                OutputWorkerKind::Archive => {
                    state.archive_status.recovery_delay_ms = *recovery_delay_ms;
                    set_archive_state(
                        &mut state.archive_status,
                        EngineHealthState::Recovering,
                        Some(format!("Archive worker pipe write failed: {}", error)),
                    );
                }
            }
        }
    }

    if succeeded > 0 {
        Ok(())
    } else if desired_active {
        Err("STREAM_RESTARTING".into())
    } else {
        Err("STREAM_DEAD".into())
    }
}

fn write_bytes_to_shared_ffmpeg(bytes: &[u8]) -> Result<(), String> {
    let desired_active = {
        let state = stream_runtime().lock().map_err(|e| e.to_string())?;
        state.desired_active
    };

    let mut stdin_guard = ffmpeg_stdin().lock().map_err(|e| e.to_string())?;
    if let Some(ref mut stdin) = *stdin_guard {
        match stdin.write_all(bytes) {
            Ok(()) => {
                if let Ok(mut counter) = frame_counter().lock() {
                    *counter += 1;
                }
                if let Ok(mut state) = stream_runtime().lock() {
                    state.bytes_written += bytes.len() as u64;
                    state.active = true;
                    state.restarting = false;
                }
                Ok(())
            }
            Err(err) => {
                println!(
                    "[aether] FFmpeg stdin write failed: {} - clearing stream",
                    err
                );
                *stdin_guard = None;
                if let Ok(mut state) = stream_runtime().lock() {
                    state.write_failures += 1;
                    state.last_error = Some(format!("FFmpeg stdin write failed: {}", err));
                    if desired_active {
                        state.restarting = true;
                    }
                }
                if desired_active {
                    Err("STREAM_RESTARTING".into())
                } else {
                    Err("STREAM_DEAD".into())
                }
            }
        }
    } else if desired_active {
        Err("STREAM_RESTARTING".into())
    } else {
        Err("STREAM_DEAD".into())
    }
}

fn current_frame_spec() -> Option<(String, u32, u32)> {
    let state = stream_runtime().lock().ok()?;
    let config = state.config.as_ref()?;
    Some((config.mode.clone(), config.width, config.height))
}

fn handle_frame_bytes(bytes: Vec<u8>) -> Result<(), String> {
    if let Some((mode, width, height)) = current_frame_spec() {
        if mode != "jpeg" {
            let expected = (width.saturating_mul(height).saturating_mul(4)) as usize;
            if bytes.len() != expected {
                return Err(format!(
                    "RAW_FRAME_SIZE_MISMATCH: got {}, expected {} for {}x{} RGBA",
                    bytes.len(),
                    expected,
                    width,
                    height
                ));
            }
        }

        if let Ok(mut rb) = replay_buffer().lock() {
            rb.width = width;
            rb.height = height;
        }
    }

    {
        if let Ok(mut rb) = replay_buffer().lock() {
            if rb.active && rb.capacity > 0 {
                let pos = rb.write_pos;
                if pos < rb.frames.len() {
                    rb.frames[pos] = bytes.clone();
                } else {
                    rb.frames.push(bytes.clone());
                }
                rb.write_pos = (pos + 1) % rb.capacity;
                if rb.count < rb.capacity {
                    rb.count += 1;
                }
            }
        }
    }

    {
        let mut state = stream_runtime().lock().map_err(|e| e.to_string())?;
        state.last_frame_at_ms = now_ms();
        state.last_frame = Some(bytes.clone());
    }

    let has_worker_sinks = output_worker_sinks()
        .lock()
        .map(|sinks| !sinks.is_empty())
        .unwrap_or(false);

    if has_worker_sinks {
        return write_bytes_to_workers(&bytes);
    }

    return write_bytes_to_shared_ffmpeg(&bytes);
    /*
        if let Some(ref mut stdin) = *guard {
            match stdin.write_all(&bytes) {
                Ok(()) => {
                    if let Ok(mut c) = frame_counter().lock() {
                        *c += 1;
                    }
                    if let Ok(mut state) = stream_runtime().lock() {
                        state.bytes_written += bytes.len() as u64;
                    }
                    Ok(())
                }
                Err(e) => {
                    println!(
                        "[aether] FFmpeg stdin write failed: {} — clearing stream",
                        e
                    );
                    *guard = None;
                    if let Ok(mut state) = stream_runtime().lock() {
                        state.write_failures += 1;
                        state.last_error = Some(format!("FFmpeg stdin write failed: {}", e));
                        if state.desired_active {
                            state.restarting = true;
                            return Err("STREAM_RESTARTING".into());
                        }
                    }
                    Err("STREAM_DEAD".into())
                }
            }
        } else {
            let state = stream_runtime().lock().map_err(|e| e.to_string())?;
            if state.desired_active {
                Err("STREAM_RESTARTING".into())
            } else {
                Err("STREAM_DEAD".into())
            }
        }
    */
}

async fn start_frame_bridge(session_id: u64) -> Result<String, String> {
    stop_frame_bridge();

    let listener = TcpListener::bind("127.0.0.1:0")
        .await
        .map_err(|e| format!("Failed to bind local frame bridge: {}", e))?;
    let address = listener
        .local_addr()
        .map_err(|e| format!("Failed to read frame bridge address: {}", e))?;
    let bridge_url = format!("ws://127.0.0.1:{}/frames", address.port());
    let (shutdown_tx, mut shutdown_rx) = oneshot::channel::<()>();
    let shutdown_tx = Arc::new(Mutex::new(Some(shutdown_tx)));

    {
        let mut bridge = frame_bridge_runtime().lock().map_err(|e| e.to_string())?;
        bridge.session_id = session_id;
        bridge.url = Some(bridge_url.clone());
        bridge.token = None;
        bridge.connected = false;
        bridge.frames_received = 0;
        bridge.bytes_received = 0;
        bridge.shutdown_tx = Some(shutdown_tx.clone());
        bridge.last_error = None;
    }

    tauri::async_runtime::spawn(async move {
        loop {
            tokio::select! {
                _ = &mut shutdown_rx => {
                    break;
                }
                accept_result = listener.accept() => {
                    let (stream, _) = match accept_result {
                        Ok(parts) => parts,
                        Err(err) => {
                            if let Ok(mut bridge) = frame_bridge_runtime().lock() {
                                if bridge.session_id == session_id {
                                    bridge.last_error = Some(format!("Frame bridge accept failed: {}", err));
                                }
                            }
                            continue;
                        }
                    };

                    let mut websocket = match accept_async(stream).await {
                        Ok(ws) => ws,
                        Err(err) => {
                            if let Ok(mut bridge) = frame_bridge_runtime().lock() {
                                if bridge.session_id == session_id {
                                    bridge.last_error = Some(format!("Frame bridge handshake failed: {}", err));
                                }
                            }
                            continue;
                        }
                    };

                    if let Ok(mut bridge) = frame_bridge_runtime().lock() {
                        if bridge.session_id == session_id {
                            bridge.connected = true;
                            bridge.last_error = None;
                        }
                    }

                    while let Some(message_result) = websocket.next().await {
                        match message_result {
                            Ok(Message::Binary(bytes)) => {
                                if let Ok(mut bridge) = frame_bridge_runtime().lock() {
                                    if bridge.session_id == session_id {
                                        bridge.frames_received += 1;
                                        bridge.bytes_received += bytes.len() as u64;
                                    }
                                }

                                if let Err(err) = handle_frame_bytes(bytes.to_vec()) {
                                    if err != "STREAM_RESTARTING" {
                                        if let Ok(mut bridge) = frame_bridge_runtime().lock() {
                                            if bridge.session_id == session_id {
                                                bridge.last_error = Some(err);
                                            }
                                        }
                                    }
                                }
                            }
                            Ok(Message::Close(_)) => break,
                            Ok(Message::Ping(_))
                            | Ok(Message::Pong(_))
                            | Ok(Message::Text(_))
                            | Ok(Message::Frame(_)) => {}
                            Err(err) => {
                                if let Ok(mut bridge) = frame_bridge_runtime().lock() {
                                    if bridge.session_id == session_id {
                                        bridge.last_error = Some(format!("Frame bridge read failed: {}", err));
                                    }
                                }
                                break;
                            }
                        }
                    }

                    if let Ok(mut bridge) = frame_bridge_runtime().lock() {
                        if bridge.session_id == session_id {
                            bridge.connected = false;
                        }
                    }
                }
            }
        }

        if let Ok(mut bridge) = frame_bridge_runtime().lock() {
            if bridge.session_id == session_id {
                bridge.connected = false;
                bridge.shutdown_tx = None;
            }
        }
    });

    Ok(bridge_url)
}

// ---------------------------------------------------------------------------
// GPU Encoder Detection
// ---------------------------------------------------------------------------

fn find_ffmpeg() -> String {
    // 1. Check for bundled FFmpeg (Tauri externalBin)
    //    In production, Tauri places external binaries next to the app executable
    if let Ok(current_exe) = std::env::current_exe() {
        if let Some(dir) = current_exe.parent() {
            let bundled = dir.join(if cfg!(target_os = "windows") {
                "ffmpeg.exe"
            } else {
                "ffmpeg"
            });
            if bundled.exists() {
                let path = bundled.to_string_lossy().to_string();
                println!("[aether] Using bundled FFmpeg: {}", path);
                return path;
            }
        }
    }

    // 2. Check common install locations
    let candidates: Vec<&str> = if cfg!(target_os = "windows") {
        vec![
            "C:\\ffmpeg\\ffmpeg-8.0.1-essentials_build\\bin\\ffmpeg.exe",
            "C:\\ffmpeg\\bin\\ffmpeg.exe",
            "ffmpeg",
            "C:\\Program Files\\ffmpeg\\bin\\ffmpeg.exe",
        ]
    } else if cfg!(target_os = "macos") {
        vec![
            "ffmpeg",
            "/opt/homebrew/bin/ffmpeg",
            "/usr/local/bin/ffmpeg",
        ]
    } else {
        vec!["ffmpeg", "/usr/bin/ffmpeg", "/usr/local/bin/ffmpeg"]
    };

    for path in &candidates {
        let mut command = Command::new(path);
        if let Ok(status) = configure_background_command(&mut command)
            .arg("-version")
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status()
        {
            if status.success() {
                println!("[aether] Using system FFmpeg: {}", path);
                return path.to_string();
            }
        }
    }
    "ffmpeg".to_string()
}

/// Detect available hardware encoders by probing FFmpeg
fn detect_gpu_encoder(ffmpeg_bin: &str) -> String {
    // Try NVIDIA NVENC first (most common GPU encoder)
    if probe_encoder(ffmpeg_bin, "h264_nvenc") {
        println!("[aether] GPU encoder detected: NVIDIA NVENC (h264_nvenc)");
        return "h264_nvenc".to_string();
    }
    // Try Intel Quick Sync
    if probe_encoder(ffmpeg_bin, "h264_qsv") {
        println!("[aether] GPU encoder detected: Intel QSV (h264_qsv)");
        return "h264_qsv".to_string();
    }
    // Try AMD AMF
    if probe_encoder(ffmpeg_bin, "h264_amf") {
        println!("[aether] GPU encoder detected: AMD AMF (h264_amf)");
        return "h264_amf".to_string();
    }
    // macOS VideoToolbox
    if probe_encoder(ffmpeg_bin, "h264_videotoolbox") {
        println!("[aether] GPU encoder detected: VideoToolbox (h264_videotoolbox)");
        return "h264_videotoolbox".to_string();
    }
    // Fallback to software
    println!("[aether] No GPU encoder found, using software libx264");
    "libx264".to_string()
}

fn probe_encoder(ffmpeg_bin: &str, encoder: &str) -> bool {
    // First check if the encoder appears in the list (fast path)
    let list_ok = {
        let mut command = Command::new(ffmpeg_bin);
        configure_background_command(&mut command)
            .args(["-hide_banner", "-encoders"])
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .output()
            .map(|output| {
                let stdout = String::from_utf8_lossy(&output.stdout);
                stdout.contains(encoder)
            })
            .unwrap_or(false)
    };

    if !list_ok {
        return false;
    }

    // Actually try to encode 1 frame — catches nvcuda.dll / driver failures
    let mut command = Command::new(ffmpeg_bin);
    configure_background_command(&mut command)
        .args([
            "-hide_banner",
            "-loglevel",
            "error",
            "-f",
            "lavfi",
            "-i",
            "nullsrc=s=320x240:r=1",
            "-frames:v",
            "1",
            "-c:v",
            encoder,
            "-f",
            "null",
            "-",
        ])
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .map(|s| s.success())
        .unwrap_or(false)
}

fn supports_lavfi(ffmpeg_bin: &str) -> bool {
    let mut command = Command::new(ffmpeg_bin);
    configure_background_command(&mut command)
        .args(["-hide_banner", "-filters"])
        .stdout(Stdio::piped())
        .stderr(Stdio::null());

    command
        .output()
        .map(|output| {
            let stdout = String::from_utf8_lossy(&output.stdout);
            stdout.contains("anullsrc")
        })
        .unwrap_or(false)
}

fn is_twitch_ingest_target(target: &str) -> bool {
    let lowered = target.to_ascii_lowercase();
    lowered.contains("live.twitch.tv")
        || lowered.contains("ingest.global-contribute.live-video.net")
        || lowered.contains(".contribute.live-video.net")
        || lowered.contains(".contribute.video.net")
}

fn output_plan_targets_twitch(output_plan: &OutputManagerPlan) -> bool {
    output_plan
        .outputs
        .iter()
        .any(|output| output.protocol == "rtmp" && is_twitch_ingest_target(&output.ffmpeg_target))
}

fn append_h264_amf_args(
    args: &mut Vec<String>,
    config: &GPUStreamConfig,
    bitrate_kbps: u32,
    targets_twitch: bool,
) {
    args.extend(["-rc".into(), "cbr".into()]);

    if targets_twitch {
        // AMD exposes the compliance knobs below in FFmpeg. For Twitch ingest,
        // favor a stricter broadcast-style stream over the bare low-latency
        // profile so the FLV/RTMP output is easier for ingest to classify.
        args.extend([
            "-usage".into(),
            "transcoding".into(),
            "-quality".into(),
            "speed".into(),
            "-enforce_hrd".into(),
            "true".into(),
            "-filler_data".into(),
            "true".into(),
            "-aud".into(),
            "true".into(),
            "-forced_idr".into(),
            "true".into(),
            "-level".into(),
            "4.1".into(),
        ]);
    } else {
        args.extend([
            "-usage".into(),
            "lowlatency".into(),
            "-quality".into(),
            "speed".into(),
        ]);
    }

    args.extend([
        "-b:v".into(),
        format!("{}k", bitrate_kbps),
        "-maxrate".into(),
        format!("{}k", bitrate_kbps),
        "-bufsize".into(),
        format!("{}k", bitrate_kbps * 2),
        "-profile:v".into(),
        "high".into(),
        "-bf".into(),
        "0".into(),
        "-g".into(),
        (config.fps * 2).to_string(),
        "-keyint_min".into(),
        (config.fps * 2).to_string(),
        "-pix_fmt".into(),
        "yuv420p".into(),
    ]);
}

#[allow(dead_code)]
fn build_ffmpeg_args(
    config: &GPUStreamConfig,
    output_plan: &OutputManagerPlan,
    encoder: &str,
    is_gpu: bool,
    audio_plan: &NativeAudioPlan,
) -> Vec<String> {
    let is_jpeg_mode = config.mode == "jpeg";
    let targets_twitch = output_plan_targets_twitch(output_plan);
    let effective_is_gpu = is_gpu;
    let effective_encoder = if effective_is_gpu {
        encoder.to_string()
    } else {
        "libx264".to_string()
    };
    let effective_bitrate = if targets_twitch {
        config.bitrate.min(4_500)
    } else {
        config.bitrate
    };
    let mut args: Vec<String> = Vec::new();

    args.extend([
        "-y".into(),
        "-hide_banner".into(),
        "-loglevel".into(),
        "warning".into(),
    ]);

    if is_jpeg_mode {
        args.extend([
            "-fflags".into(),
            "+genpts+discardcorrupt+nobuffer".into(),
            "-thread_queue_size".into(),
            "4096".into(),
            "-f".into(),
            "image2pipe".into(),
            "-c:v".into(),
            "mjpeg".into(),
            "-framerate".into(),
            config.fps.to_string(),
            "-i".into(),
            "pipe:0".into(),
        ]);
    } else {
        args.extend([
            "-fflags".into(),
            "+genpts+discardcorrupt+nobuffer".into(),
            "-thread_queue_size".into(),
            "4096".into(),
            "-f".into(),
            "rawvideo".into(),
            "-pixel_format".into(),
            "rgba".into(),
            "-video_size".into(),
            format!("{}x{}", config.width, config.height),
            "-framerate".into(),
            config.fps.to_string(),
            "-i".into(),
            "pipe:0".into(),
        ]);
    }

    append_audio_input_args(&mut args, audio_plan);
    append_audio_output_args(&mut args, audio_plan);

    if effective_is_gpu {
        args.extend(["-c:v".into(), effective_encoder.clone()]);
        match effective_encoder.as_str() {
            "h264_nvenc" => {
                args.extend([
                    "-preset".into(),
                    "p4".into(),
                    "-tune".into(),
                    "ll".into(),
                    "-rc".into(),
                    "cbr".into(),
                    "-b:v".into(),
                    format!("{}k", effective_bitrate),
                    "-maxrate".into(),
                    format!("{}k", effective_bitrate),
                    "-bufsize".into(),
                    format!("{}k", effective_bitrate * 2),
                    "-profile:v".into(),
                    "high".into(),
                    "-g".into(),
                    (config.fps * 2).to_string(),
                    "-keyint_min".into(),
                    (config.fps * 2).to_string(),
                    "-sc_threshold".into(),
                    "0".into(),
                    "-pix_fmt".into(),
                    "yuv420p".into(),
                ]);
            }
            "h264_qsv" => {
                args.extend([
                    "-preset".into(),
                    "fast".into(),
                    "-b:v".into(),
                    format!("{}k", effective_bitrate),
                    "-maxrate".into(),
                    format!("{}k", effective_bitrate),
                    "-bufsize".into(),
                    format!("{}k", effective_bitrate * 2),
                    "-profile:v".into(),
                    "high".into(),
                    "-g".into(),
                    (config.fps * 2).to_string(),
                    "-keyint_min".into(),
                    (config.fps * 2).to_string(),
                    "-sc_threshold".into(),
                    "0".into(),
                    "-pix_fmt".into(),
                    "nv12".into(),
                ]);
            }
            "h264_amf" => {
                append_h264_amf_args(&mut args, config, effective_bitrate, targets_twitch);
            }
            "h264_videotoolbox" => {
                args.extend([
                    "-b:v".into(),
                    format!("{}k", effective_bitrate),
                    "-profile:v".into(),
                    "high".into(),
                    "-g".into(),
                    (config.fps * 2).to_string(),
                    "-keyint_min".into(),
                    (config.fps * 2).to_string(),
                    "-pix_fmt".into(),
                    "yuv420p".into(),
                ]);
            }
            _ => {
                args.extend([
                    "-pix_fmt".into(),
                    "yuv420p".into(),
                    "-b:v".into(),
                    format!("{}k", effective_bitrate),
                ]);
            }
        }
    } else {
        args.extend([
            "-c:v".into(),
            "libx264".into(),
            "-preset".into(),
            if targets_twitch {
                "ultrafast".into()
            } else {
                "veryfast".into()
            },
            "-tune".into(),
            "zerolatency".into(),
            "-b:v".into(),
            format!("{}k", effective_bitrate),
            "-maxrate".into(),
            format!("{}k", effective_bitrate),
            "-bufsize".into(),
            format!("{}k", effective_bitrate * 2),
            "-pix_fmt".into(),
            "yuv420p".into(),
            "-profile:v".into(),
            "high".into(),
            "-g".into(),
            (config.fps * 2).to_string(),
            "-keyint_min".into(),
            (config.fps * 2).to_string(),
            "-sc_threshold".into(),
            "0".into(),
        ]);
    }

    args.extend(["-max_interleave_delta".into(), "0".into()]);

    // Do not force +global_header on the shared native path. With h264_amf
    // going into Twitch FLV ingest, that can produce a connection that looks
    // healthy locally but never shows as live on Twitch.
    // Keep FFmpeg stats enabled so the terminal shows frame/fps/speed lines.
    args.extend(["-stats".into(), "-stats_period".into(), "5".into()]);

    let has_flv_output = output_plan
        .outputs
        .iter()
        .any(|output| output.muxer == "flv");
    if has_flv_output {
        args.extend(["-flvflags".into(), "no_duration_filesize".into()]);
    }

    append_output_args(&mut args, output_plan);

    args
}

#[derive(Clone)]
struct WorkerLaunchContext {
    session_id: u64,
    ffmpeg_bin: String,
    encoder: String,
    is_gpu: bool,
    config: GPUStreamConfig,
    audio_plan: NativeAudioPlan,
    worker: OutputWorkerPlan,
}

fn mark_worker_runtime_state(
    state: &mut NativeStreamRuntime,
    worker: &OutputWorkerPlan,
    next: EngineHealthState,
    message: Option<String>,
) {
    match worker.kind {
        OutputWorkerKind::Destination => {
            set_output_recovery_delay_by_worker_id(
                &mut state.output_statuses,
                &worker.worker_id,
                worker.recovery_delay_ms,
            );
            set_output_state_by_worker_id(
                &mut state.output_statuses,
                &worker.worker_id,
                next,
                message,
            );
        }
        OutputWorkerKind::Archive => {
            state.archive_status.recovery_delay_ms = worker.recovery_delay_ms;
            set_archive_state(&mut state.archive_status, next, message);
        }
    }
}

fn apply_worker_start_failure(context: &WorkerLaunchContext, error: String) {
    if let Ok(mut state) = stream_runtime().lock() {
        state.active = output_worker_sinks()
            .lock()
            .map(|sinks| !sinks.is_empty())
            .unwrap_or(false);
        state.restarting = false;
        state.last_error = Some(error.clone());
        state.last_exit_status = Some(format!("{}: startup failure", context.worker.worker_id));
        set_audio_state(
            &mut state.audio_status,
            EngineHealthState::Error,
            Some(error.clone()),
            Some(format!(
                "Output worker {} failed to start",
                context.worker.worker_id
            )),
        );
        mark_worker_runtime_state(
            &mut state,
            &context.worker,
            EngineHealthState::Error,
            Some(error),
        );
    }
}

fn worker_prefers_software_encoder(worker: &OutputWorkerPlan) -> bool {
    matches!(worker.kind, OutputWorkerKind::Archive)
}

fn build_worker_ffmpeg_args(
    config: &GPUStreamConfig,
    worker: &OutputWorkerPlan,
    encoder: &str,
    is_gpu: bool,
    audio_plan: &NativeAudioPlan,
) -> Vec<String> {
    let is_jpeg_mode = config.mode == "jpeg";
    let targets_twitch =
        worker.protocol == "rtmp" && is_twitch_ingest_target(&worker.ffmpeg_target);
    // Keep archive on software for predictable segmented files, but let live
    // RTMP use the detected GPU encoder. Running Twitch and archive as two
    // software encodes was enough to drag 30fps output down to ~20fps.
    let effective_is_gpu = is_gpu && !worker_prefers_software_encoder(worker);
    let effective_encoder = if effective_is_gpu {
        encoder.to_string()
    } else {
        "libx264".to_string()
    };
    let effective_bitrate = if targets_twitch {
        config.bitrate.min(4_500)
    } else if matches!(worker.kind, OutputWorkerKind::Archive) {
        config.bitrate.min(4_000)
    } else {
        config.bitrate
    };
    let mut args: Vec<String> = Vec::new();

    args.extend([
        "-y".into(),
        "-hide_banner".into(),
        "-loglevel".into(),
        "info".into(),
    ]);

    if is_jpeg_mode {
        args.extend([
            "-fflags".into(),
            "+genpts+discardcorrupt+nobuffer".into(),
            "-thread_queue_size".into(),
            "4096".into(),
            "-f".into(),
            "image2pipe".into(),
            "-c:v".into(),
            "mjpeg".into(),
            "-framerate".into(),
            config.fps.to_string(),
            "-i".into(),
            "pipe:0".into(),
        ]);
    } else {
        args.extend([
            "-fflags".into(),
            "+genpts+discardcorrupt+nobuffer".into(),
            "-thread_queue_size".into(),
            "4096".into(),
            "-f".into(),
            "rawvideo".into(),
            "-pixel_format".into(),
            "rgba".into(),
            "-video_size".into(),
            format!("{}x{}", config.width, config.height),
            "-framerate".into(),
            config.fps.to_string(),
            "-i".into(),
            "pipe:0".into(),
        ]);
    }

    append_audio_input_args(&mut args, audio_plan);
    append_audio_output_args(&mut args, audio_plan);

    if effective_is_gpu {
        args.extend(["-c:v".into(), effective_encoder.clone()]);
        match effective_encoder.as_str() {
            "h264_nvenc" => {
                args.extend([
                    "-preset".into(),
                    "p4".into(),
                    "-tune".into(),
                    "ll".into(),
                    "-rc".into(),
                    "cbr".into(),
                    "-b:v".into(),
                    format!("{}k", effective_bitrate),
                    "-maxrate".into(),
                    format!("{}k", effective_bitrate),
                    "-bufsize".into(),
                    format!("{}k", effective_bitrate * 2),
                    "-profile:v".into(),
                    "high".into(),
                    "-g".into(),
                    (config.fps * 2).to_string(),
                    "-keyint_min".into(),
                    (config.fps * 2).to_string(),
                    "-sc_threshold".into(),
                    "0".into(),
                    "-pix_fmt".into(),
                    "yuv420p".into(),
                ]);
            }
            "h264_qsv" => {
                args.extend([
                    "-preset".into(),
                    "fast".into(),
                    "-b:v".into(),
                    format!("{}k", effective_bitrate),
                    "-maxrate".into(),
                    format!("{}k", effective_bitrate),
                    "-bufsize".into(),
                    format!("{}k", effective_bitrate * 2),
                    "-profile:v".into(),
                    "high".into(),
                    "-g".into(),
                    (config.fps * 2).to_string(),
                    "-keyint_min".into(),
                    (config.fps * 2).to_string(),
                    "-sc_threshold".into(),
                    "0".into(),
                    "-pix_fmt".into(),
                    "nv12".into(),
                ]);
            }
            "h264_amf" => {
                append_h264_amf_args(&mut args, config, effective_bitrate, targets_twitch);
            }
            "h264_videotoolbox" => {
                args.extend([
                    "-b:v".into(),
                    format!("{}k", effective_bitrate),
                    "-profile:v".into(),
                    "high".into(),
                    "-g".into(),
                    (config.fps * 2).to_string(),
                    "-keyint_min".into(),
                    (config.fps * 2).to_string(),
                    "-pix_fmt".into(),
                    "yuv420p".into(),
                ]);
            }
            _ => {
                args.extend([
                    "-pix_fmt".into(),
                    "yuv420p".into(),
                    "-b:v".into(),
                    format!("{}k", effective_bitrate),
                ]);
            }
        }
    } else {
        args.extend([
            "-c:v".into(),
            "libx264".into(),
            "-preset".into(),
            if worker.protocol == "rtmp" {
                "ultrafast".into()
            } else if matches!(worker.kind, OutputWorkerKind::Archive) {
                "superfast".into()
            } else {
                "veryfast".into()
            },
            "-tune".into(),
            "zerolatency".into(),
            "-b:v".into(),
            format!("{}k", effective_bitrate),
            "-maxrate".into(),
            format!("{}k", effective_bitrate),
            "-bufsize".into(),
            format!("{}k", effective_bitrate * 2),
            "-pix_fmt".into(),
            "yuv420p".into(),
            "-profile:v".into(),
            "high".into(),
            "-g".into(),
            (config.fps * 2).to_string(),
            "-keyint_min".into(),
            (config.fps * 2).to_string(),
            "-sc_threshold".into(),
            "0".into(),
        ]);
    }

    args.extend(["-max_interleave_delta".into(), "0".into()]);

    // -flvflags is FLV-specific; do NOT apply to other muxers (e.g. segment/matroska).
    // NOTE: -flags +global_header is intentionally omitted for RTMP/FLV. With h264_amf
    // it causes malformed SPS/PPS in the FLV bitstream — Twitch's ingest accepts the
    // TCP connection but never registers the stream as live. The FLV muxer reads codec
    // extradata automatically without needing +global_header.
    if worker.muxer == "flv" {
        args.extend(["-flvflags".into(), "no_duration_filesize".into()]);
    }

    // Force stats output even when stderr is a pipe (not a TTY), so we can see
    // "frame=X fps=Y" progress lines in the terminal for debugging.
    args.extend(["-stats".into(), "-stats_period".into(), "5".into()]);

    append_worker_output_args(&mut args, worker);
    args
}

fn worker_launch_contexts_from_runtime() -> Result<Vec<WorkerLaunchContext>, String> {
    let (config, ffmpeg_bin, encoder, is_gpu, archive_path_pattern, session_id, lavfi_enabled) = {
        let state = stream_runtime().lock().map_err(|e| e.to_string())?;
        if !state.desired_active {
            return Err("Stream is not marked active".into());
        }
        (
            state.config.clone().ok_or("Missing stream config")?,
            state.ffmpeg_path.clone(),
            state.encoder.clone(),
            state.is_gpu,
            state.archive_path_pattern.clone(),
            state.session_id,
            state.lavfi_enabled,
        )
    };
    let audio_plan = build_audio_plan(&ffmpeg_bin, &config, lavfi_enabled);

    let output_plan = build_output_manager_plan(&config, archive_path_pattern.as_deref())?;
    Ok(output_plan
        .worker_plans()
        .into_iter()
        .map(|worker| WorkerLaunchContext {
            session_id,
            ffmpeg_bin: ffmpeg_bin.clone(),
            encoder: encoder.clone(),
            is_gpu,
            config: config.clone(),
            audio_plan: audio_plan.clone(),
            worker,
        })
        .collect())
}

fn spawn_output_worker(context: WorkerLaunchContext) -> Result<(), String> {
    let args = build_worker_ffmpeg_args(
        &context.config,
        &context.worker,
        &context.encoder,
        context.is_gpu,
        &context.audio_plan,
    );
    println!(
        "[aether] Output worker {} [{} {} -> {}] command: {} {}",
        context.worker.worker_id,
        context.worker.name,
        context.worker.protocol,
        context.worker.target,
        context.ffmpeg_bin,
        args.join(" ")
    );

    let mut cmd = Command::new(&context.ffmpeg_bin);
    cmd.args(&args)
        .stdin(Stdio::piped())
        .stdout(Stdio::null())
        .stderr(Stdio::piped());

    configure_background_command(&mut cmd);

    {
        let mut state = stream_runtime().lock().map_err(|e| e.to_string())?;
        mark_worker_runtime_state(
            &mut state,
            &context.worker,
            EngineHealthState::Starting,
            Some(format!("Starting worker {}", context.worker.worker_id)),
        );
    }

    let mut child = match cmd.spawn() {
        Ok(child) => child,
        Err(e) => {
            let error = format!("Failed to spawn worker {}: {}", context.worker.worker_id, e);
            apply_worker_start_failure(&context, error.clone());
            return Err(error);
        }
    };
    let stdin_handle = match child.stdin.take() {
        Some(handle) => handle,
        None => {
            let error = format!(
                "Failed to capture worker stdin: {}",
                context.worker.worker_id
            );
            let _ = child.kill();
            let _ = child.wait();
            apply_worker_start_failure(&context, error.clone());
            return Err(error);
        }
    };
    let stderr_handle = child.stderr.take();
    let child_handle = Arc::new(Mutex::new(child));

    {
        let mut sinks = output_worker_sinks().lock().map_err(|e| e.to_string())?;
        if sinks.contains_key(&context.worker.worker_id) {
            if let Ok(mut child) = child_handle.lock() {
                let _ = child.kill();
                let _ = child.wait();
            }
            let error = format!(
                "Refusing to register duplicate output worker id: {}",
                context.worker.worker_id
            );
            apply_worker_start_failure(&context, error.clone());
            return Err(error);
        }
        sinks.insert(
            context.worker.worker_id.clone(),
            OutputWorkerSink {
                session_id: context.session_id,
                kind: context.worker.kind.clone(),
                recovery_delay_ms: context.worker.recovery_delay_ms,
                spawned_at_ms: now_ms(),
                child: child_handle.clone(),
                stdin: Arc::new(Mutex::new(stdin_handle)),
            },
        );
    }

    {
        let mut state = stream_runtime().lock().map_err(|e| e.to_string())?;
        state.active = true;
        state.restarting = false;
        state.last_error = None;
        state.last_exit_status = None;
        state.last_spawn_at_ms = now_ms();
        set_audio_state(
            &mut state.audio_status,
            EngineHealthState::Active,
            None,
            Some(format!("Worker {} active", context.worker.worker_id)),
        );
        mark_worker_runtime_state(
            &mut state,
            &context.worker,
            EngineHealthState::Starting,
            Some(format!(
                "Worker {} process started; waiting for encoder progress",
                context.worker.worker_id
            )),
        );
    }

    spawn_output_worker_monitor(context, child_handle, stderr_handle);
    Ok(())
}

fn spawn_output_worker_monitor(
    context: WorkerLaunchContext,
    child_handle: Arc<Mutex<Child>>,
    stderr: Option<ChildStderr>,
) {
    std::thread::spawn(move || {
        use std::io::{BufRead, BufReader};

        let mut last_error_line: Option<String> = None;
        let mut last_seen_line: Option<String> = None;
        let mut stderr_context: Vec<String> = Vec::new();

        if let Some(stderr) = stderr {
            let reader = BufReader::new(stderr);
            for line in reader.lines() {
                match line {
                    Ok(line) => {
                        let trimmed = line.trim();
                        if trimmed.is_empty() {
                            continue;
                        }
                        last_seen_line = Some(trimmed.to_string());
                        stderr_context.push(trimmed.to_string());
                        if stderr_context.len() > WORKER_STDERR_CONTEXT_LINES {
                            stderr_context.remove(0);
                        }
                        println!("[ffmpeg:{}] {}", context.worker.worker_id, trimmed);
                        if let Ok(mut state) = stream_runtime().lock() {
                            let NativeStreamRuntime {
                                audio_status,
                                output_statuses,
                                archive_status,
                                ..
                            } = &mut *state;
                            apply_audio_runtime_signal(trimmed, audio_status);
                            apply_output_runtime_signal(
                                &context.worker.worker_id,
                                context.worker.kind.clone(),
                                trimmed,
                                output_statuses,
                                archive_status,
                            );
                        }
                        let lowered = trimmed.to_ascii_lowercase();
                        if lowered.contains("error")
                            || lowered.contains("failed")
                            || lowered.contains("invalid")
                            || lowered.contains("timed out")
                        {
                            let context_text = stderr_context.join(" | ");
                            last_error_line =
                                Some(format!("{trimmed} | recent stderr: {context_text}"));
                        }
                    }
                    Err(_) => break,
                }
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
        if last_error_line.is_none() && !status_text.contains("exit code: 0") {
            last_error_line = Some(format!(
                "Worker {} exited with {}; last stderr: {}",
                context.worker.worker_id,
                status_text,
                last_seen_line.unwrap_or_else(|| "no stderr captured".into())
            ));
        }
        eprintln!(
            "[aether] Worker {} exited: {} | last_error: {:?}",
            context.worker.worker_id, status_text, last_error_line
        );

        let worker_started_at_ms = {
            let mut started_at_ms = 0;
            if let Ok(mut sinks) = output_worker_sinks().lock() {
                if let Some(sink) = sinks.get(&context.worker.worker_id) {
                    if sink.session_id == context.session_id {
                        started_at_ms = sink.spawned_at_ms;
                        sinks.remove(&context.worker.worker_id);
                    }
                }
            }
            started_at_ms
        };

        let remaining_workers = output_worker_sinks()
            .lock()
            .map(|sinks| sinks.len())
            .unwrap_or(0);
        let mut should_restart = false;
        let mut restart_delay_ms = context.worker.recovery_delay_ms;
        {
            let mut state = match stream_runtime().lock() {
                Ok(guard) => guard,
                Err(_) => return,
            };
            state.active = remaining_workers > 0;
            let exit_at_ms = now_ms();
            state.last_exit_status = Some(format!("{}: {}", context.worker.worker_id, status_text));
            state.last_error = Some(last_error_line.clone().unwrap_or_else(|| {
                format!(
                    "Worker {} exited with {}",
                    context.worker.worker_id, status_text
                )
            }));
            let worker_runtime_ms = if worker_started_at_ms > 0 {
                exit_at_ms.saturating_sub(worker_started_at_ms)
            } else {
                0
            };

            let worker_restart_count = match context.worker.kind {
                OutputWorkerKind::Destination => {
                    if let Some(output) = state
                        .output_statuses
                        .iter_mut()
                        .find(|output| output.worker_id == context.worker.worker_id)
                    {
                        if worker_runtime_ms >= RESTART_RESET_AFTER_MS {
                            output.restart_count = 0;
                        }
                        output.restart_count
                    } else {
                        0
                    }
                }
                OutputWorkerKind::Archive => {
                    if worker_runtime_ms >= RESTART_RESET_AFTER_MS {
                        state.archive_status.restart_count = 0;
                    }
                    state.archive_status.restart_count
                }
            };

            if state.desired_active && worker_restart_count < DEFAULT_OUTPUT_MAX_RESTARTS {
                state.restart_count += 1;
                state.restarting = true;
                state.last_restart_at_ms = exit_at_ms;
                restart_delay_ms = worker_recovery_delay_ms(
                    context.worker.recovery_delay_ms,
                    worker_restart_count,
                );
                state.last_restart_delay_ms = restart_delay_ms;
                should_restart = true;
                let last_error = state.last_error.clone();
                set_audio_state(
                    &mut state.audio_status,
                    EngineHealthState::Recovering,
                    last_error.clone(),
                    Some(format!(
                        "Restarting worker {} after {}ms",
                        context.worker.worker_id, restart_delay_ms
                    )),
                );
                match context.worker.kind {
                    OutputWorkerKind::Destination => {
                        set_output_recovery_delay_by_worker_id(
                            &mut state.output_statuses,
                            &context.worker.worker_id,
                            restart_delay_ms,
                        );
                        set_output_state_by_worker_id(
                            &mut state.output_statuses,
                            &context.worker.worker_id,
                            EngineHealthState::Recovering,
                            last_error.clone(),
                        );
                    }
                    OutputWorkerKind::Archive => {
                        state.archive_status.recovery_delay_ms = restart_delay_ms;
                        set_archive_state(
                            &mut state.archive_status,
                            EngineHealthState::Recovering,
                            last_error,
                        );
                    }
                }
            } else {
                let desired_active = state.desired_active;
                let last_error = state.last_error.clone();
                if !state.desired_active {
                    state.restarting = false;
                } else {
                    state.desired_active = remaining_workers > 0;
                    state.restarting = false;
                }
                set_audio_state(
                    &mut state.audio_status,
                    if desired_active {
                        EngineHealthState::Error
                    } else {
                        EngineHealthState::Stopped
                    },
                    last_error.clone(),
                    Some(format!("Worker {} exited", context.worker.worker_id)),
                );
                match context.worker.kind {
                    OutputWorkerKind::Destination => {
                        set_output_recovery_delay_by_worker_id(
                            &mut state.output_statuses,
                            &context.worker.worker_id,
                            context.worker.recovery_delay_ms,
                        );
                        set_output_state_by_worker_id(
                            &mut state.output_statuses,
                            &context.worker.worker_id,
                            if desired_active {
                                EngineHealthState::Error
                            } else {
                                EngineHealthState::Stopped
                            },
                            last_error.clone(),
                        );
                    }
                    OutputWorkerKind::Archive => {
                        state.archive_status.recovery_delay_ms = context.worker.recovery_delay_ms;
                        set_archive_state(
                            &mut state.archive_status,
                            if desired_active {
                                EngineHealthState::Error
                            } else {
                                EngineHealthState::Stopped
                            },
                            last_error,
                        );
                    }
                }
            }
        }

        if should_restart {
            std::thread::sleep(Duration::from_millis(restart_delay_ms.max(1)));
            let _ = spawn_output_worker(context);
        }
    });
}

fn spawn_output_workers_from_runtime() -> Result<(), String> {
    let contexts = worker_launch_contexts_from_runtime()?;
    for context in contexts {
        if let Err(err) = spawn_output_worker(context) {
            stop_output_workers();
            if let Ok(mut state) = stream_runtime().lock() {
                state.active = false;
                state.restarting = false;
            }
            return Err(err);
        }
    }
    Ok(())
}

fn stop_output_workers() {
    let worker_handles = {
        let mut sinks = match output_worker_sinks().lock() {
            Ok(guard) => guard,
            Err(_) => return,
        };
        let handles = sinks
            .values()
            .map(|sink| sink.child.clone())
            .collect::<Vec<_>>();
        sinks.clear();
        handles
    };

    for child_handle in worker_handles {
        if let Ok(mut child) = child_handle.lock() {
            let _ = child.kill();
            let _ = child.wait();
        }
    }
}

fn stop_shared_ffmpeg() {
    if let Ok(mut stdin_guard) = ffmpeg_stdin().lock() {
        *stdin_guard = None;
    }

    let child = {
        let mut process_guard = match ffmpeg_process().lock() {
            Ok(guard) => guard,
            Err(_) => return,
        };
        process_guard.take()
    };

    if let Some(mut child) = child {
        let _ = child.kill();
        let _ = child.wait();
    }
}

fn start_keepalive_loop(session_id: u64) {
    std::thread::spawn(move || loop {
        let (
            should_run,
            current_session_id,
            mode,
            width,
            height,
            fps,
            last_frame,
            last_frame_at_ms,
        ) = {
            let state = match stream_runtime().lock() {
                Ok(guard) => guard,
                Err(_) => return,
            };
            (
                state.desired_active,
                state.session_id,
                state
                    .config
                    .as_ref()
                    .map(|cfg| cfg.mode.clone())
                    .unwrap_or_else(|| "raw".into()),
                state.config.as_ref().map(|cfg| cfg.width).unwrap_or(1280),
                state.config.as_ref().map(|cfg| cfg.height).unwrap_or(720),
                state.config.as_ref().map(|cfg| cfg.fps).unwrap_or(30),
                state.last_frame.clone(),
                state.last_frame_at_ms,
            )
        };

        if !should_run || current_session_id != session_id {
            return;
        }

        let frame_interval_ms = u64::from(1000 / fps.max(1));
        // Fill smaller frame gaps sooner so viewers see a steadier cadence instead
        // of waiting for a full 2-frame stall before the watchdog duplicates.
        let duplicate_threshold_ms =
            frame_interval_ms.saturating_add((frame_interval_ms / 4).max(4));
        let now = now_ms();
        let frame_age_ms = now.saturating_sub(last_frame_at_ms);
        let should_duplicate = last_frame.is_some() && frame_age_ms >= duplicate_threshold_ms;
        let should_render_natively =
            mode == "native-scene" && frame_age_ms >= frame_interval_ms.saturating_mul(4);

        if should_duplicate || should_render_natively {
            let keepalive_frame = if should_render_natively {
                match render_native_scene_rgba(width, height) {
                    Ok(frame) => Some((frame, true)),
                    Err(err) => {
                        if let Ok(mut state) = stream_runtime().lock() {
                            if state.session_id != session_id {
                                return;
                            }
                            state.last_error =
                                Some(format!("Watchdog native scene render failed: {}", err));
                        }
                        last_frame.map(|frame| (frame, false))
                    }
                }
            } else {
                last_frame.map(|frame| (frame, false))
            };

            let Some((bytes, rendered_natively)) = keepalive_frame else {
                std::thread::sleep(Duration::from_millis(frame_interval_ms.max(16)));
                continue;
            };

            match write_bytes_to_workers(&bytes) {
                Ok(()) => {
                    if let Ok(mut state) = stream_runtime().lock() {
                        if state.session_id != session_id || !state.desired_active {
                            return;
                        }
                        state.keepalive_frames += 1;
                        state.last_frame_at_ms = now_ms();
                        state.last_frame = Some(bytes);
                        if rendered_natively {
                            state.watchdog_renders += 1;
                        }
                    }
                }
                Err(_) => {
                    if let Ok(mut state) = stream_runtime().lock() {
                        if state.session_id != session_id {
                            return;
                        }
                        state.write_failures += 1;
                    }
                }
            }
        }

        std::thread::sleep(Duration::from_millis(frame_interval_ms.max(16)));
    });
}

#[allow(dead_code)]
fn spawn_ffmpeg_from_runtime() -> Result<(), String> {
    let (config, ffmpeg_bin, encoder, is_gpu, restart_count, archive_path_pattern, lavfi_enabled) = {
        let state = stream_runtime().lock().map_err(|e| e.to_string())?;
        if !state.desired_active {
            return Err("Stream is not marked active".into());
        }
        (
            state.config.clone().ok_or("Missing stream config")?,
            state.ffmpeg_path.clone(),
            state.encoder.clone(),
            state.is_gpu,
            state.restart_count,
            state.archive_path_pattern.clone(),
            state.lavfi_enabled,
        )
    };
    let audio_plan = build_audio_plan(&ffmpeg_bin, &config, lavfi_enabled);

    let output_plan = build_output_manager_plan(&config, archive_path_pattern.as_deref())?;

    let args = build_ffmpeg_args(&config, &output_plan, &encoder, is_gpu, &audio_plan);
    println!("[aether] FFmpeg command: {} {}", ffmpeg_bin, args.join(" "));

    let mut cmd = Command::new(&ffmpeg_bin);
    cmd.args(&args)
        .stdin(Stdio::piped())
        .stdout(Stdio::null())
        .stderr(Stdio::piped());

    configure_background_command(&mut cmd);

    let mut child = cmd
        .spawn()
        .map_err(|e| format!("Failed to spawn FFmpeg: {}", e))?;
    let child_pid = child.id();
    let stdin_handle = child.stdin.take().ok_or("Failed to capture FFmpeg stdin")?;
    let stderr_handle = child.stderr.take();

    *ffmpeg_stdin().lock().map_err(|e| e.to_string())? = Some(stdin_handle);
    *ffmpeg_process().lock().map_err(|e| e.to_string())? = Some(child);

    {
        let mut state = stream_runtime().lock().map_err(|e| e.to_string())?;
        state.active = true;
        state.restarting = false;
        state.last_error = None;
        state.last_exit_status = None;
        set_audio_state(
            &mut state.audio_status,
            EngineHealthState::Active,
            None,
            Some("Legacy native audio active".into()),
        );
        set_output_states(&mut state.output_statuses, EngineHealthState::Active, None);
        set_archive_state(&mut state.archive_status, EngineHealthState::Active, None);
        if state.started_at_ms == 0 {
            state.started_at_ms = now_ms();
        }
        state.last_spawn_at_ms = now_ms();
        println!(
            "[aether] Native stream active: encoder={} lavfi={} restart={}",
            state.encoder, state.lavfi_enabled, restart_count
        );
    }

    spawn_ffmpeg_monitor(child_pid, stderr_handle);
    Ok(())
}

#[allow(dead_code)]
fn spawn_ffmpeg_monitor(child_pid: u32, stderr: Option<ChildStderr>) {
    std::thread::spawn(move || {
        use std::io::{BufRead, BufReader};

        let mut last_error_line: Option<String> = None;

        if let Some(stderr) = stderr {
            let reader = BufReader::new(stderr);
            for line in reader.lines() {
                match line {
                    Ok(line) => {
                        let trimmed = line.trim();
                        if trimmed.is_empty() {
                            continue;
                        }
                        println!("[ffmpeg] {}", trimmed);
                        if let Ok(mut state) = stream_runtime().lock() {
                            let NativeStreamRuntime {
                                audio_status,
                                output_statuses,
                                archive_status,
                                ..
                            } = &mut *state;
                            apply_audio_runtime_signal(trimmed, audio_status);
                            apply_output_runtime_signal(
                                "legacy:shared",
                                OutputWorkerKind::Archive,
                                trimmed,
                                output_statuses,
                                archive_status,
                            );
                        }
                        let lowered = trimmed.to_ascii_lowercase();
                        if lowered.contains("error")
                            || lowered.contains("failed")
                            || lowered.contains("invalid")
                            || lowered.contains("timed out")
                        {
                            last_error_line = Some(trimmed.to_string());
                        }
                    }
                    Err(_) => break,
                }
            }
        }

        let status_text = {
            let mut process_guard = match ffmpeg_process().lock() {
                Ok(guard) => guard,
                Err(_) => return,
            };

            let Some(process) = process_guard.as_ref() else {
                return;
            };

            if process.id() != child_pid {
                return;
            }

            let mut child = process_guard.take().expect("child existed above");
            match child.wait() {
                Ok(status) => format!("{status}"),
                Err(err) => format!("wait failed: {err}"),
            }
        };

        if let Ok(mut stdin_guard) = ffmpeg_stdin().lock() {
            *stdin_guard = None;
        }

        let exit_at_ms = now_ms();
        let mut should_restart = false;
        let mut delay_before_restart_ms = 0;
        {
            let mut state = match stream_runtime().lock() {
                Ok(guard) => guard,
                Err(_) => return,
            };
            state.active = false;
            state.last_exit_status = Some(status_text.clone());
            if let Some(line) = last_error_line.clone() {
                state.last_error = Some(line);
            } else {
                state.last_error = Some(format!("FFmpeg exited with status {}", status_text));
            }

            if state.desired_active {
                let stable_runtime_ms = exit_at_ms.saturating_sub(state.last_spawn_at_ms);
                if stable_runtime_ms >= RESTART_RESET_AFTER_MS {
                    state.restart_count = 0;
                }

                if state.restart_count < state.max_restarts {
                    state.restart_count += 1;
                    state.restarting = true;
                    state.last_restart_at_ms = exit_at_ms;
                    delay_before_restart_ms = restart_delay_ms(state.restart_count);
                    state.last_restart_delay_ms = delay_before_restart_ms;
                    let error_message = state.last_error.clone();
                    set_audio_state(
                        &mut state.audio_status,
                        EngineHealthState::Recovering,
                        error_message.clone(),
                        Some("Legacy native audio restarting".into()),
                    );
                    set_output_states(
                        &mut state.output_statuses,
                        EngineHealthState::Recovering,
                        error_message.clone(),
                    );
                    set_archive_state(
                        &mut state.archive_status,
                        EngineHealthState::Recovering,
                        error_message,
                    );
                    should_restart = true;
                } else {
                    state.desired_active = false;
                    state.restarting = false;
                    state.last_restart_delay_ms = 0;
                    state.last_error = Some(
                        state
                            .last_error
                            .clone()
                            .unwrap_or_else(|| "Native stream restart limit reached".into()),
                    );
                    let error_message = state.last_error.clone();
                    set_audio_state(
                        &mut state.audio_status,
                        EngineHealthState::Error,
                        error_message.clone(),
                        Some("Legacy native audio restart limit reached".into()),
                    );
                    set_output_states(
                        &mut state.output_statuses,
                        EngineHealthState::Error,
                        error_message.clone(),
                    );
                    set_archive_state(
                        &mut state.archive_status,
                        EngineHealthState::Error,
                        error_message,
                    );
                }
            } else {
                set_audio_state(
                    &mut state.audio_status,
                    EngineHealthState::Stopped,
                    None,
                    Some("Legacy native audio stopped".into()),
                );
                set_output_states(&mut state.output_statuses, EngineHealthState::Stopped, None);
                set_archive_state(&mut state.archive_status, EngineHealthState::Stopped, None);
            }
        }

        if should_restart {
            std::thread::sleep(Duration::from_millis(delay_before_restart_ms.max(1)));
            if let Err(err) = spawn_ffmpeg_from_runtime() {
                if let Ok(mut state) = stream_runtime().lock() {
                    state.desired_active = false;
                    state.active = false;
                    state.restarting = false;
                    state.last_restart_delay_ms = 0;
                    state.last_error = Some(err.clone());
                    set_audio_state(
                        &mut state.audio_status,
                        EngineHealthState::Error,
                        Some(err.clone()),
                        Some("Legacy native audio failed to recover".into()),
                    );
                    set_output_states(
                        &mut state.output_statuses,
                        EngineHealthState::Error,
                        Some(err.clone()),
                    );
                    set_archive_state(
                        &mut state.archive_status,
                        EngineHealthState::Error,
                        Some(err),
                    );
                }
            }
        }
    });
}

// ---------------------------------------------------------------------------
// Tauri Commands
// ---------------------------------------------------------------------------

/// Start GPU-accelerated streaming pipeline
#[tauri::command]
pub async fn start_stream(config: GPUStreamConfig) -> Result<String, String> {
    {
        let mut guard = stream_runtime().lock().map_err(|e| e.to_string())?;
        let worker_count = output_worker_sinks()
            .lock()
            .map(|sinks| sinks.len())
            .unwrap_or(0);
        if guard.desired_active && (guard.active || guard.restarting || worker_count > 0) {
            return Err("Stream already running. Stop it first.".into());
        }
        if guard.desired_active {
            guard.desired_active = false;
            guard.active = false;
            guard.restarting = false;
            guard.last_error = None;
        }
    }

    let ffmpeg_bin = find_ffmpeg();

    // Auto-detect or use specified encoder
    let requested_encoder = if config.encoder.is_empty() || config.encoder == "auto" {
        detect_gpu_encoder(&ffmpeg_bin)
    } else if config.encoder == "software" {
        "libx264".to_string()
    } else {
        config.encoder.clone()
    };

    let session_id = now_ms();
    let archive_path_pattern = Some(build_archive_pattern(session_id)?);
    let output_plan = build_output_manager_plan(&config, archive_path_pattern.as_deref())?;
    let encoder = requested_encoder;
    let is_gpu = encoder != "libx264";
    let lavfi_enabled = supports_lavfi(&ffmpeg_bin);
    let audio_plan = build_audio_plan(&ffmpeg_bin, &config, lavfi_enabled);
    let output_statuses = build_output_statuses(&output_plan, &config);
    let archive_status = build_archive_status(
        output_plan
            .archive_path_pattern()
            .map(|path| path.to_string()),
        output_plan.archive_segment_seconds(),
        output_plan
            .archive
            .as_ref()
            .map(|archive| archive.recovery_delay_ms)
            .unwrap_or(0),
        if output_plan.archive_path_pattern().is_some() {
            EngineHealthState::Starting
        } else {
            EngineHealthState::Stopped
        },
    );
    let audio_status = build_audio_status(&audio_plan, EngineHealthState::Starting);

    if let Ok(mut counter) = frame_counter().lock() {
        *counter = 0;
    }

    {
        let mut state = stream_runtime().lock().map_err(|e| e.to_string())?;
        state.desired_active = true;
        state.active = false;
        state.restarting = false;
        state.restart_count = 0;
        state.max_restarts = DEFAULT_MAX_RESTARTS;
        state.session_id = session_id;
        state.last_spawn_at_ms = 0;
        state.last_restart_delay_ms = 0;
        state.ffmpeg_path = ffmpeg_bin.clone();
        state.encoder = encoder.clone();
        state.is_gpu = is_gpu;
        state.config = Some(config.clone());
        state.lavfi_enabled = lavfi_enabled;
        state.archive_path_pattern = output_plan
            .archive_path_pattern()
            .map(|path| path.to_string());
        state.last_error = None;
        state.last_exit_status = None;
        state.started_at_ms = now_ms();
        state.last_restart_at_ms = 0;
        state.last_frame_at_ms = 0;
        state.bytes_written = 0;
        state.write_failures = 0;
        state.keepalive_frames = 0;
        state.watchdog_renders = 0;
        state.last_frame = None;
        state.audio_status = audio_status;
        state.output_statuses = output_statuses;
        state.archive_status = archive_status;
    }

    stop_shared_ffmpeg();
    stop_output_workers();

    if let Err(err) = start_native_source_captures(&ffmpeg_bin, &config, session_id) {
        if let Ok(mut state) = stream_runtime().lock() {
            state.last_error = Some(err.clone());
        }
        return Err(err);
    }

    if let Err(err) = spawn_output_workers_from_runtime() {
        stop_native_source_captures();
        stop_output_workers();
        stop_shared_ffmpeg();
        if let Ok(mut state) = stream_runtime().lock() {
            state.desired_active = false;
            state.active = false;
            state.restarting = false;
            state.last_error = Some(err.clone());
            set_audio_state(
                &mut state.audio_status,
                EngineHealthState::Error,
                Some(err.clone()),
                Some("Native output workers failed to start".into()),
            );
            set_output_states(
                &mut state.output_statuses,
                EngineHealthState::Error,
                Some(err.clone()),
            );
            set_archive_state(
                &mut state.archive_status,
                EngineHealthState::Error,
                Some(err.clone()),
            );
        }
        return Err(err);
    }
    start_keepalive_loop(session_id);

    let bridge_url = if config.mode == "native-scene" {
        None
    } else {
        match start_frame_bridge(session_id).await {
            Ok(url) => Some(url),
            Err(err) => {
                println!(
                    "[aether] Frame bridge unavailable, using invoke fallback: {}",
                    err
                );
                if let Ok(mut state) = stream_runtime().lock() {
                    state.last_error = Some(format!(
                        "Frame bridge unavailable, using invoke fallback: {}",
                        err
                    ));
                }
                None
            }
        }
    };
    let source_bridge_url = if config.mode == "native-scene" {
        match start_source_bridge(session_id).await {
            Ok(url) => Some(url),
            Err(err) => {
                println!(
                    "[aether] Source bridge unavailable, using invoke fallback for source sync: {}",
                    err
                );
                if let Ok(mut state) = stream_runtime().lock() {
                    state.last_error = Some(format!(
                        "Source bridge unavailable, using invoke fallback for source sync: {}",
                        err
                    ));
                }
                None
            }
        }
    } else {
        None
    };

    let encoder_label = if is_gpu {
        format!("GPU ({})", encoder)
    } else {
        "Software (libx264)".into()
    };
    let audio_label = describe_audio_plan(&audio_plan);
    let video_label = match config.mode.as_str() {
        "jpeg" => "jpeg-image2pipe",
        "native-scene" => "native-scene-rgba",
        _ => "raw-rgba",
    };
    let message = format!(
        "Streaming via {} [native output workers] video: {} audio: {} at {}x{} @{}fps to {} destination(s); archive: {}",
        encoder_label,
        video_label,
        audio_label,
        config.width,
        config.height,
        config.fps,
        output_plan.destination_count(),
        output_plan
            .archive_path_pattern()
            .map(|path| path.to_string())
            .unwrap_or_else(|| "disabled by operator".into())
    );

    let response = StartStreamResponse {
        message,
        bridge_url: bridge_url.clone(),
        bridge_token: None,
        source_bridge_url: source_bridge_url.clone(),
        transport: if bridge_url.is_some() {
            "bridge".into()
        } else {
            "invoke".into()
        },
    };

    serde_json::to_string(&response).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn stop_stream() -> Result<String, String> {
    let archive_path_pattern = {
        let state = stream_runtime().lock().map_err(|e| e.to_string())?;
        state.archive_path_pattern.clone()
    };

    {
        let mut state = stream_runtime().lock().map_err(|e| e.to_string())?;
        state.desired_active = false;
        state.active = false;
        state.restarting = false;
        state.last_frame = None;
        state.last_restart_delay_ms = 0;
        set_audio_state(
            &mut state.audio_status,
            EngineHealthState::Stopped,
            None,
            Some("Native audio stopped".into()),
        );
        set_output_states(&mut state.output_statuses, EngineHealthState::Stopped, None);
        set_archive_state(&mut state.archive_status, EngineHealthState::Stopped, None);
    }

    stop_frame_bridge();
    stop_source_bridge();
    stop_native_source_captures();
    stop_shared_ffmpeg();
    stop_output_workers();

    let frames = frame_counter().lock().map(|c| *c).unwrap_or(0);
    return Ok(match archive_path_pattern {
        Some(path) => format!(
            "Stream stopped ({} frames encoded). Archive segments: {}",
            frames, path
        ),
        None => format!("Stream stopped ({} frames encoded)", frames),
    });
}

/// Write a base64-encoded JPEG frame to FFmpeg stdin (used in jpeg mode)
#[tauri::command]
pub async fn write_frame(data: String) -> Result<(), String> {
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(&data)
        .map_err(|e| format!("Base64 decode failed: {}", e))?;

    handle_frame_bytes(bytes)
}

/// Receive raw RGBA frame and write to FFmpeg stdin (legacy raw mode)
#[tauri::command]
pub async fn encode_frame(frame_data: Vec<u8>, width: u32, height: u32) -> Result<(), String> {
    let expected = (width * height * 4) as usize;
    if frame_data.len() != expected {
        return Err(format!(
            "Frame size mismatch: {} vs expected {}",
            frame_data.len(),
            expected
        ));
    }

    {
        if let Ok(mut rb) = replay_buffer().lock() {
            rb.width = width;
            rb.height = height;
        }
    }

    handle_frame_bytes(frame_data)
}

/// Render the current native scene snapshot into a raw RGBA frame and write it to worker stdin.
#[tauri::command]
pub async fn render_native_scene_frame() -> Result<(), String> {
    let (mode, width, height) =
        current_frame_spec().ok_or_else(|| "NATIVE_SCENE_NOT_ACTIVE".to_string())?;
    if mode != "native-scene" {
        return Err(format!(
            "NATIVE_SCENE_MODE_REQUIRED: current mode is {}",
            mode
        ));
    }

    // Phase 1: Render the scene on a blocking thread (CPU-intensive compositor).
    // We await this so the JS frame loop knows when the GPU work is done and can
    // schedule the next frame at the right time (~1-2 ms per frame with h264_amf).
    let frame = tokio::task::spawn_blocking(move || render_native_scene_rgba(width, height))
        .await
        .map_err(|e| e.to_string())??;

    // Update replay buffer dimensions immediately (fast, non-blocking).
    if let Ok(mut rb) = replay_buffer().lock() {
        rb.width = width;
        rb.height = height;
    }

    // Phase 2: write to the workers on a blocking thread and await completion.
    // This preserves bounded backpressure: the JS frame loop will only queue the
    // next native-scene frame after this dispatch finishes, which is far safer
    // than piling up hundreds of 720p/1080p RGBA frames in memory when an output
    // worker falls behind real-time.
    tokio::task::spawn_blocking(move || handle_frame_bytes(frame))
        .await
        .map_err(|e| e.to_string())?
}

/// Get streaming stats
#[tauri::command]
pub async fn get_stream_stats() -> Result<String, String> {
    let frames = frame_counter().lock().map(|c| *c).unwrap_or(0);
    let state = stream_runtime().lock().map_err(|e| e.to_string())?.clone();
    let bridge = frame_bridge_runtime()
        .lock()
        .map_err(|e| e.to_string())?
        .clone();
    let source_bridge = current_source_bridge_runtime();
    let video_status = current_video_status();
    let source_statuses = current_source_statuses();
    let (width, height, fps, bitrate_kbps) = state
        .config
        .as_ref()
        .map(|cfg| (cfg.width, cfg.height, cfg.fps, cfg.bitrate))
        .unwrap_or((0, 0, 0, 0));
    let last_frame_age_ms = if state.last_frame_at_ms > 0 {
        now_ms().saturating_sub(state.last_frame_at_ms)
    } else {
        0
    };
    let uptime_ms = if state.started_at_ms > 0 {
        now_ms().saturating_sub(state.started_at_ms)
    } else {
        0
    };

    return Ok(serde_json::to_string(&NativeStreamStats {
        frames,
        active: state.active,
        desired_active: state.desired_active,
        restarting: state.restarting,
        restart_count: state.restart_count,
        max_restarts: state.max_restarts,
        session_id: state.session_id,
        encoder: state.encoder,
        is_gpu: state.is_gpu,
        width,
        height,
        fps,
        bitrate_kbps,
        bytes_written: state.bytes_written,
        write_failures: state.write_failures,
        keepalive_frames: state.keepalive_frames,
        watchdog_renders: state.watchdog_renders,
        archive_path_pattern: state.archive_path_pattern,
        archive_segment_seconds: if state.archive_status.segment_seconds > 0 {
            state.archive_status.segment_seconds
        } else {
            DEFAULT_ARCHIVE_SEGMENT_SECONDS
        },
        last_restart_delay_ms: state.last_restart_delay_ms,
        last_error: state.last_error,
        last_exit_status: state.last_exit_status,
        ffmpeg_path: state.ffmpeg_path,
        started_at_ms: state.started_at_ms,
        last_frame_age_ms,
        uptime_ms,
        lavfi_enabled: state.lavfi_enabled,
        transport_mode: if bridge.url.is_some() {
            "bridge".into()
        } else {
            "invoke".into()
        },
        frame_transport: state
            .config
            .as_ref()
            .map(|cfg| match cfg.mode.as_str() {
                "jpeg" => "jpeg-image2pipe".into(),
                "native-scene" => "native-scene-rgba".into(),
                _ => "raw-rgba".into(),
            })
            .unwrap_or_else(|| "unknown".into()),
        bridge_url: bridge.url,
        bridge_connected: bridge.connected,
        bridge_frames_received: bridge.frames_received,
        bridge_bytes_received: bridge.bytes_received,
        bridge_last_error: bridge.last_error,
        source_bridge_url: source_bridge.url,
        source_bridge_connected_sources: source_bridge.connected_sources.len() as u32,
        source_bridge_frames_received: source_bridge.frames_received,
        source_bridge_bytes_received: source_bridge.bytes_received,
        source_bridge_last_error: source_bridge.last_error,
        video_status,
        source_statuses,
        audio_status: state.audio_status,
        output_statuses: state.output_statuses,
        archive_status: state.archive_status,
        ndi_status: current_ndi_status(),
        ndi_input_status: current_ndi_input_status(),
    })
    .map_err(|e| e.to_string())?);
}

/// Detect available GPU encoder
#[tauri::command]
pub async fn detect_encoder() -> Result<String, String> {
    let ffmpeg_bin = find_ffmpeg();
    let encoder = detect_gpu_encoder(&ffmpeg_bin);
    let is_gpu = encoder != "libx264";
    Ok(serde_json::json!({
        "encoder": encoder,
        "isGPU": is_gpu,
        "ffmpegPath": ffmpeg_bin,
    })
    .to_string())
}

#[tauri::command]
pub async fn list_audio_devices() -> Result<String, String> {
    let ffmpeg_bin = find_ffmpeg();
    let discovery: NativeAudioDiscovery =
        detect_audio_engine(&ffmpeg_bin, supports_lavfi(&ffmpeg_bin));
    serde_json::to_string(&discovery).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn start_replay_buffer(buffer_duration_sec: u32, fps: u32) -> Result<String, String> {
    let capacity = (buffer_duration_sec * fps) as usize;
    if capacity == 0 {
        return Err("Buffer params must be > 0".into());
    }
    let mut rb = replay_buffer().lock().map_err(|e| e.to_string())?;
    rb.frames = Vec::with_capacity(capacity);
    rb.capacity = capacity;
    rb.write_pos = 0;
    rb.count = 0;
    rb.fps = fps;
    rb.active = true;
    Ok(format!(
        "Replay buffer: {}s @{}fps",
        buffer_duration_sec, fps
    ))
}

#[tauri::command]
pub async fn capture_replay(duration_sec: u32) -> Result<String, String> {
    let (frames_to_save, width, height, fps) = {
        let rb = replay_buffer().lock().map_err(|e| e.to_string())?;
        if !rb.active || rb.count == 0 {
            return Err("No replay data".into());
        }
        let n = ((duration_sec * rb.fps) as usize).min(rb.count);
        let start = if rb.count == rb.capacity {
            (rb.write_pos + rb.capacity - n) % rb.capacity
        } else {
            rb.count - n
        };
        let frames: Vec<Vec<u8>> = (0..n)
            .filter_map(|i| {
                let idx = (start + i) % rb.capacity;
                rb.frames.get(idx).cloned()
            })
            .collect();
        (frames, rb.width, rb.height, rb.fps)
    };

    let ts = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();
    let out = std::env::temp_dir().join(format!("aether_replay_{}.webm", ts));
    let out_str = out.to_string_lossy().to_string();
    let ffmpeg_bin = find_ffmpeg();

    let mut command = Command::new(&ffmpeg_bin);
    let mut child = configure_background_command(&mut command)
        .args([
            "-y",
            "-f",
            "rawvideo",
            "-pixel_format",
            "rgba",
            "-video_size",
            &format!("{}x{}", width, height),
            "-framerate",
            &fps.to_string(),
            "-i",
            "pipe:0",
            "-c:v",
            "libvpx-vp9",
            "-crf",
            "30",
            "-b:v",
            "0",
            &out_str,
        ])
        .stdin(Stdio::piped())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|e| format!("FFmpeg spawn failed: {}", e))?;

    if let Some(ref mut stdin) = child.stdin {
        for frame in &frames_to_save {
            let _ = stdin.write_all(frame);
        }
    }
    drop(child.stdin.take());

    let status = child.wait().map_err(|e| e.to_string())?;
    if !status.success() {
        return Err(format!("FFmpeg exited: {}", status));
    }
    Ok(out_str)
}

#[tauri::command]
pub async fn stop_replay_buffer() -> Result<String, String> {
    let mut rb = replay_buffer().lock().map_err(|e| e.to_string())?;
    rb.active = false;
    rb.frames.clear();
    rb.capacity = 0;
    Ok("Replay buffer stopped".into())
}
