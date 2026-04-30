use std::io::{BufRead, BufReader, Read, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::Duration;

use serde_json::Value;
use tokio::sync::oneshot;
use tokio::time;

use super::state::{
    EngineHealthState, NdiConfig, NdiDiscoveredSource, NdiHealth, NdiInputConfig, NdiInputStatus,
    NdiSourceStatus, NdiStatus,
};
use super::telemetry::now_ms;
use super::video::{render_native_scene_alpha_rgba, render_native_scene_rgba, store_source_frame};

const PROGRAM_SOURCE: &str = "program";
const ALPHA_SOURCE: &str = "alpha";
const PROGRAM_NAME: &str = "Aether-Program";
const ALPHA_NAME: &str = "Aether-Alpha";

struct NdiRuntime {
    status: NdiStatus,
    child: Option<Child>,
    stdin: Option<Arc<Mutex<ChildStdin>>>,
    shutdown_tx: Option<Arc<Mutex<Option<oneshot::Sender<()>>>>>,
    external_program_last_ms: u64,
}

struct NdiInputRuntime {
    status: NdiInputStatus,
    child: Option<Child>,
}

impl Default for NdiInputRuntime {
    fn default() -> Self {
        Self {
            status: NdiInputStatus::default(),
            child: None,
        }
    }
}

impl Default for NdiRuntime {
    fn default() -> Self {
        Self {
            status: NdiStatus::default(),
            child: None,
            stdin: None,
            shutdown_tx: None,
            external_program_last_ms: 0,
        }
    }
}

fn ndi_runtime() -> &'static Mutex<NdiRuntime> {
    static INSTANCE: OnceLock<Mutex<NdiRuntime>> = OnceLock::new();
    INSTANCE.get_or_init(|| Mutex::new(NdiRuntime::default()))
}

fn ndi_input_runtime() -> &'static Mutex<NdiInputRuntime> {
    static INSTANCE: OnceLock<Mutex<NdiInputRuntime>> = OnceLock::new();
    INSTANCE.get_or_init(|| Mutex::new(NdiInputRuntime::default()))
}

fn resolve_ndi_resolution(resolution: &str) -> (u32, u32, String) {
    match resolution {
        "720p" => (1280, 720, "720p".into()),
        _ => (1920, 1080, "1080p".into()),
    }
}

fn repo_root_from(start: &Path) -> Option<PathBuf> {
    for candidate in start.ancestors() {
        if candidate.join("package.json").is_file()
            && candidate.join("scripts").join("ndi-sidecar.cjs").is_file()
        {
            return Some(candidate.to_path_buf());
        }
    }
    None
}

fn find_repo_root() -> Result<PathBuf, String> {
    let cwd = std::env::current_dir()
        .map_err(|err| format!("Failed to read current directory: {err}"))?;
    if let Some(root) = repo_root_from(&cwd) {
        return Ok(root);
    }
    let exe = std::env::current_exe()
        .map_err(|err| format!("Failed to read current executable: {err}"))?;
    if let Some(parent) = exe.parent() {
        if let Some(root) = repo_root_from(parent) {
            return Ok(root);
        }
    }
    Err("Could not locate Aether repo root for NDI sidecar".into())
}

fn sidecar_script_path() -> Result<PathBuf, String> {
    Ok(find_repo_root()?.join("scripts").join("ndi-sidecar.cjs"))
}

fn input_sidecar_script_path() -> Result<PathBuf, String> {
    Ok(find_repo_root()?.join("scripts").join("ndi-input-sidecar.cjs"))
}

fn write_packet(
    stdin: &Arc<Mutex<ChildStdin>>,
    header: Value,
    payload: Option<&[u8]>,
) -> Result<(), String> {
    let mut header = header;
    let payload_len = payload.map(|bytes| bytes.len()).unwrap_or(0);
    header["payloadBytes"] = Value::from(payload_len as u64);
    let header_bytes = serde_json::to_vec(&header).map_err(|err| err.to_string())?;
    let header_len = header_bytes.len() as u32;

    let mut guard = stdin.lock().map_err(|err| err.to_string())?;
    guard
        .write_all(&header_len.to_le_bytes())
        .map_err(|err| format!("NDI sidecar packet header write failed: {err}"))?;
    guard
        .write_all(&header_bytes)
        .map_err(|err| format!("NDI sidecar packet JSON write failed: {err}"))?;
    if let Some(bytes) = payload {
        guard
            .write_all(bytes)
            .map_err(|err| format!("NDI sidecar frame write failed: {err}"))?;
    }
    guard
        .flush()
        .map_err(|err| format!("NDI sidecar flush failed: {err}"))
}

fn engine_state_from_str(value: &str) -> EngineHealthState {
    match value {
        "starting" => EngineHealthState::Starting,
        "active" => EngineHealthState::Active,
        "degraded" => EngineHealthState::Degraded,
        "error" => EngineHealthState::Error,
        "stopped" => EngineHealthState::Stopped,
        _ => EngineHealthState::Inactive,
    }
}

fn update_status_from_sidecar(status_value: &Value) {
    let now = now_ms();
    if let Ok(mut runtime) = ndi_runtime().lock() {
        let state = status_value
            .get("state")
            .and_then(Value::as_str)
            .map(engine_state_from_str)
            .unwrap_or_else(|| runtime.status.state.clone());
        runtime.status.state = state;
        runtime.status.active = status_value
            .get("active")
            .and_then(Value::as_bool)
            .unwrap_or(runtime.status.active);
        runtime.status.frames_sent = status_value
            .get("framesSent")
            .and_then(Value::as_u64)
            .unwrap_or(runtime.status.frames_sent);
        runtime.status.dropped_frames = status_value
            .get("droppedFrames")
            .and_then(Value::as_u64)
            .unwrap_or(runtime.status.dropped_frames);
        runtime.status.last_frame_ms = status_value
            .get("lastFrameMs")
            .and_then(Value::as_u64)
            .unwrap_or(runtime.status.last_frame_ms);
        runtime.status.last_error = status_value
            .get("lastError")
            .and_then(Value::as_str)
            .map(str::to_string);
        runtime.status.health = status_value
            .get("health")
            .and_then(|health| serde_json::from_value(health.clone()).ok())
            .unwrap_or_else(|| runtime.status.health.clone());

        if let Some(sources) = status_value.get("sources").and_then(Value::as_array) {
            runtime.status.sources = sources
                .iter()
                .map(|source| {
                    let last_frame_ms = source
                        .get("lastFrameMs")
                        .and_then(Value::as_u64)
                        .unwrap_or(0);
                    NdiSourceStatus {
                        key: source
                            .get("key")
                            .and_then(Value::as_str)
                            .unwrap_or("unknown")
                            .into(),
                        name: source
                            .get("name")
                            .and_then(Value::as_str)
                            .unwrap_or("Aether-NDI")
                            .into(),
                        state: source
                            .get("state")
                            .and_then(Value::as_str)
                            .map(engine_state_from_str)
                            .unwrap_or(EngineHealthState::Inactive),
                        frames_sent: source
                            .get("framesSent")
                            .and_then(Value::as_u64)
                            .unwrap_or(0),
                        dropped_frames: source
                            .get("droppedFrames")
                            .and_then(Value::as_u64)
                            .unwrap_or(0),
                        last_frame_ms,
                        last_frame_age_ms: if last_frame_ms > 0 {
                            now.saturating_sub(last_frame_ms)
                        } else {
                            0
                        },
                        last_error: source
                            .get("lastError")
                            .and_then(Value::as_str)
                            .map(str::to_string),
                    }
                })
                .collect();
        }
    }
}

fn note_sidecar_error(message: String) {
    if let Ok(mut runtime) = ndi_runtime().lock() {
        runtime.status.state = if runtime.status.frames_sent > 0 {
            EngineHealthState::Degraded
        } else {
            EngineHealthState::Error
        };
        runtime.status.last_error = Some(message);
    }
}

fn note_input_error(message: String) {
    if let Ok(mut runtime) = ndi_input_runtime().lock() {
        runtime.status.state = if runtime.status.frames_received > 0 {
            EngineHealthState::Degraded
        } else {
            EngineHealthState::Error
        };
        runtime.status.last_error = Some(message);
        runtime.status.dropped_frames = runtime.status.dropped_frames.saturating_add(1);
    }
}

fn spawn_stdout_reader(stdout: impl std::io::Read + Send + 'static) {
    std::thread::spawn(move || {
        let reader = BufReader::new(stdout);
        for line in reader.lines().map_while(Result::ok) {
            let parsed: Value = match serde_json::from_str(&line) {
                Ok(value) => value,
                Err(_) => continue,
            };
            if let Some(status) = parsed.get("status") {
                update_status_from_sidecar(status);
            }
            if let Some(error) = parsed.get("error").and_then(Value::as_str) {
                note_sidecar_error(error.to_string());
            }
        }
    });
}

fn spawn_stderr_reader(stderr: impl std::io::Read + Send + 'static) {
    std::thread::spawn(move || {
        let reader = BufReader::new(stderr);
        for line in reader.lines().map_while(Result::ok) {
            note_sidecar_error(line);
        }
    });
}

fn spawn_input_stderr_reader(stderr: impl std::io::Read + Send + 'static) {
    std::thread::spawn(move || {
        let reader = BufReader::new(stderr);
        for line in reader.lines().map_while(Result::ok) {
            if let Ok(value) = serde_json::from_str::<Value>(&line) {
                if let Some(error) = value.get("error").and_then(Value::as_str) {
                    note_input_error(error.to_string());
                    continue;
                }
                if value.get("event").and_then(Value::as_str) == Some("started") {
                    if let Ok(mut runtime) = ndi_input_runtime().lock() {
                        runtime.status.state = EngineHealthState::Active;
                        runtime.status.active = true;
                        runtime.status.last_error = None;
                    }
                    continue;
                }
            }
            note_input_error(line);
        }
    });
}

fn read_exact_or_break(reader: &mut impl Read, buffer: &mut [u8]) -> bool {
    match reader.read_exact(buffer) {
        Ok(()) => true,
        Err(err) => {
            note_input_error(format!("NDI input sidecar read failed: {err}"));
            false
        }
    }
}

fn spawn_input_frame_reader(stdout: impl Read + Send + 'static, routed_source_id: String) {
    std::thread::spawn(move || {
        let mut reader = BufReader::new(stdout);
        loop {
            let mut len_bytes = [0u8; 4];
            if !read_exact_or_break(&mut reader, &mut len_bytes) {
                break;
            }
            let header_len = u32::from_le_bytes(len_bytes) as usize;
            if header_len == 0 || header_len > 64 * 1024 {
                note_input_error(format!("Invalid NDI input packet header length: {header_len}"));
                break;
            }

            let mut header_bytes = vec![0u8; header_len];
            if !read_exact_or_break(&mut reader, &mut header_bytes) {
                break;
            }
            let header: Value = match serde_json::from_slice(&header_bytes) {
                Ok(value) => value,
                Err(err) => {
                    note_input_error(format!("Invalid NDI input packet JSON: {err}"));
                    break;
                }
            };
            let payload_len = header
                .get("payloadBytes")
                .and_then(Value::as_u64)
                .unwrap_or(0) as usize;
            let mut payload = vec![0u8; payload_len];
            if payload_len > 0 && !read_exact_or_break(&mut reader, &mut payload) {
                break;
            }

            if header.get("event").and_then(Value::as_str) != Some("frame") {
                continue;
            }
            let width = header.get("width").and_then(Value::as_u64).unwrap_or(0) as u32;
            let height = header.get("height").and_then(Value::as_u64).unwrap_or(0) as u32;
            if width == 0 || height == 0 {
                note_input_error("NDI input frame missing dimensions".into());
                continue;
            }

            match store_source_frame(&routed_source_id, width, height, payload, true) {
                Ok(()) => {
                    if let Ok(mut runtime) = ndi_input_runtime().lock() {
                        runtime.status.state = EngineHealthState::Active;
                        runtime.status.active = true;
                        runtime.status.width = width;
                        runtime.status.height = height;
                        runtime.status.frames_received = header
                            .get("framesReceived")
                            .and_then(Value::as_u64)
                            .unwrap_or(runtime.status.frames_received.saturating_add(1));
                        runtime.status.dropped_frames = header
                            .get("droppedFrames")
                            .and_then(Value::as_u64)
                            .unwrap_or(runtime.status.dropped_frames);
                        runtime.status.last_frame_ms = now_ms();
                        runtime.status.last_error = None;
                    }
                }
                Err(err) => note_input_error(err),
            }
        }
    });
}

fn stop_ndi_runtime() {
    let (shutdown, mut child) = {
        let mut runtime = match ndi_runtime().lock() {
            Ok(guard) => guard,
            Err(_) => return,
        };
        runtime.status.desired_active = false;
        runtime.status.active = false;
        runtime.status.state = EngineHealthState::Stopped;
        let shutdown = runtime.shutdown_tx.take();
        runtime.stdin = None;
        (shutdown, runtime.child.take())
    };

    if let Some(shutdown) = shutdown {
        if let Ok(mut guard) = shutdown.lock() {
            if let Some(tx) = guard.take() {
                let _ = tx.send(());
            }
        }
    }

    if let Some(child) = child.as_mut() {
        let _ = child.kill();
        let _ = child.wait();
    }
}

fn stop_ndi_input_runtime() {
    let mut child = {
        let mut runtime = match ndi_input_runtime().lock() {
            Ok(guard) => guard,
            Err(_) => return,
        };
        runtime.status.desired_active = false;
        runtime.status.active = false;
        runtime.status.state = EngineHealthState::Stopped;
        runtime.child.take()
    };

    if let Some(child) = child.as_mut() {
        let _ = child.kill();
        let _ = child.wait();
    }
}

fn write_frame(source: &str, width: u32, height: u32, frame: Vec<u8>) -> Result<(), String> {
    let stdin = {
        let runtime = ndi_runtime().lock().map_err(|err| err.to_string())?;
        if !runtime.status.desired_active {
            return Ok(());
        }
        runtime
            .stdin
            .clone()
            .ok_or_else(|| "NDI sidecar stdin is not available".to_string())?
    };

    let timecode = (std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos()
        / 100) as u64;
    write_packet(
        &stdin,
        serde_json::json!({
            "command": "frame",
            "source": source,
            "width": width,
            "height": height,
            "timecode": timecode.to_string(),
        }),
        Some(&frame),
    )
}

async fn run_frame_loop(
    width: u32,
    height: u32,
    fps: u32,
    alpha_enabled: bool,
    mut shutdown_rx: oneshot::Receiver<()>,
) {
    let mut ticker = time::interval(Duration::from_millis((1000 / fps.max(1)) as u64));

    loop {
        tokio::select! {
            _ = &mut shutdown_rx => break,
            _ = ticker.tick() => {
                let use_internal_program = ndi_runtime()
                    .lock()
                    .map(|runtime| now_ms().saturating_sub(runtime.external_program_last_ms) > 1_000)
                    .unwrap_or(true);

                if use_internal_program {
                    let program = tokio::task::spawn_blocking(move || render_native_scene_rgba(width, height))
                        .await
                        .map_err(|err| err.to_string())
                        .and_then(|result| result);
                    match program {
                        Ok(frame) => {
                            if let Err(err) = tokio::task::spawn_blocking(move || write_frame(PROGRAM_SOURCE, width, height, frame)).await.unwrap_or_else(|err| Err(err.to_string())) {
                                note_sidecar_error(err);
                            }
                        }
                        Err(err) => note_sidecar_error(err),
                    }
                }

                if alpha_enabled {
                    let alpha = tokio::task::spawn_blocking(move || render_native_scene_alpha_rgba(width, height))
                        .await
                        .map_err(|err| err.to_string())
                        .and_then(|result| result);
                    match alpha {
                        Ok(frame) => {
                            if let Err(err) = tokio::task::spawn_blocking(move || write_frame(ALPHA_SOURCE, width, height, frame)).await.unwrap_or_else(|err| Err(err.to_string())) {
                                note_sidecar_error(err);
                            }
                        }
                        Err(err) => note_sidecar_error(err),
                    }
                }
            }
        }
    }
}

pub fn current_ndi_status() -> NdiStatus {
    let mut status = ndi_runtime()
        .lock()
        .map(|runtime| runtime.status.clone())
        .unwrap_or_default();
    let now = now_ms();
    status.uptime_ms = if status.started_at_ms > 0 {
        now.saturating_sub(status.started_at_ms)
    } else {
        0
    };
    status.last_frame_age_ms = if status.last_frame_ms > 0 {
        now.saturating_sub(status.last_frame_ms)
    } else {
        0
    };
    for source in status.sources.iter_mut() {
        source.last_frame_age_ms = if source.last_frame_ms > 0 {
            now.saturating_sub(source.last_frame_ms)
        } else {
            0
        };
    }
    status
}

pub fn current_ndi_input_status() -> NdiInputStatus {
    let mut status = ndi_input_runtime()
        .lock()
        .map(|runtime| runtime.status.clone())
        .unwrap_or_default();
    let now = now_ms();
    status.uptime_ms = if status.started_at_ms > 0 {
        now.saturating_sub(status.started_at_ms)
    } else {
        0
    };
    status.last_frame_age_ms = if status.last_frame_ms > 0 {
        now.saturating_sub(status.last_frame_ms)
    } else {
        0
    };
    status
}

#[tauri::command]
pub async fn probe_ndi() -> Result<String, String> {
    let script = sidecar_script_path()?;
    let output = Command::new("node")
        .arg(script)
        .arg("--probe")
        .output()
        .map_err(|err| format!("Failed to run NDI sidecar probe: {err}"))?;
    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if stdout.is_empty() {
        return Err("NDI sidecar probe returned no output".into());
    }
    if let Ok(value) = serde_json::from_str::<NdiHealth>(&stdout) {
        if let Ok(mut runtime) = ndi_runtime().lock() {
            runtime.status.health = value;
        }
    }
    Ok(stdout)
}

#[tauri::command]
pub async fn start_ndi(config: Option<NdiConfig>) -> Result<String, String> {
    stop_ndi_runtime();

    let config = config.unwrap_or(NdiConfig {
        resolution: "1080p".into(),
        fps: 30,
        alpha_enabled: true,
    });
    let (width, height, _resolution) = resolve_ndi_resolution(&config.resolution);
    let fps = config.fps.clamp(1, 60);
    let script = sidecar_script_path()?;
    let mut child = Command::new("node")
        .arg(script)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|err| format!("Failed to start NDI sidecar: {err}"))?;

    let stdin = Arc::new(Mutex::new(
        child
            .stdin
            .take()
            .ok_or_else(|| "Failed to open NDI sidecar stdin".to_string())?,
    ));
    if let Some(stdout) = child.stdout.take() {
        spawn_stdout_reader(stdout);
    }
    if let Some(stderr) = child.stderr.take() {
        spawn_stderr_reader(stderr);
    }

    let (shutdown_tx, shutdown_rx) = oneshot::channel::<()>();
    let shutdown_tx = Arc::new(Mutex::new(Some(shutdown_tx)));
    let started_at = now_ms();

    {
        let mut runtime = ndi_runtime().lock().map_err(|err| err.to_string())?;
        runtime.status = NdiStatus {
            state: EngineHealthState::Starting,
            health: NdiHealth {
                ok: true,
                error: None,
                mock: false,
            },
            active: false,
            desired_active: true,
            width,
            height,
            fps,
            alpha_enabled: config.alpha_enabled,
            frames_sent: 0,
            dropped_frames: 0,
            started_at_ms: started_at,
            uptime_ms: 0,
            last_frame_ms: 0,
            last_frame_age_ms: 0,
            last_error: None,
            sources: vec![NdiSourceStatus {
                key: PROGRAM_SOURCE.into(),
                name: PROGRAM_NAME.into(),
                state: EngineHealthState::Starting,
                frames_sent: 0,
                dropped_frames: 0,
                last_frame_ms: 0,
                last_frame_age_ms: 0,
                last_error: None,
            }],
        };
        if config.alpha_enabled {
            runtime.status.sources.push(NdiSourceStatus {
                key: ALPHA_SOURCE.into(),
                name: ALPHA_NAME.into(),
                state: EngineHealthState::Starting,
                frames_sent: 0,
                dropped_frames: 0,
                last_frame_ms: 0,
                last_frame_age_ms: 0,
                last_error: None,
            });
        }
        runtime.stdin = Some(stdin.clone());
        runtime.shutdown_tx = Some(shutdown_tx);
        runtime.child = Some(child);
        runtime.external_program_last_ms = 0;
    }

    write_packet(
        &stdin,
        serde_json::json!({
            "command": "start",
            "width": width,
            "height": height,
            "fps": fps,
            "alphaEnabled": config.alpha_enabled,
        }),
        None,
    )?;

    tauri::async_runtime::spawn(run_frame_loop(
        width,
        height,
        fps,
        config.alpha_enabled,
        shutdown_rx,
    ));

    serde_json::to_string(&current_ndi_status()).map_err(|err| err.to_string())
}

#[tauri::command]
pub async fn push_ndi_program_frame(
    width: u32,
    height: u32,
    frame_data: Vec<u8>,
) -> Result<(), String> {
    let expected = (width as usize)
        .saturating_mul(height as usize)
        .saturating_mul(4);
    if width == 0 || height == 0 || frame_data.len() != expected {
        return Err(format!(
            "Invalid NDI program frame: {} bytes for {}x{} RGBA, expected {}",
            frame_data.len(),
            width,
            height,
            expected
        ));
    }

    {
        let mut runtime = ndi_runtime().lock().map_err(|err| err.to_string())?;
        if !runtime.status.desired_active {
            return Ok(());
        }
        runtime.external_program_last_ms = now_ms();
    }

    tokio::task::spawn_blocking(move || write_frame(PROGRAM_SOURCE, width, height, frame_data))
        .await
        .map_err(|err| err.to_string())?
}

#[tauri::command]
pub async fn list_ndi_sources() -> Result<String, String> {
    let script = input_sidecar_script_path()?;
    let output = Command::new("node")
        .arg(script)
        .arg("--discover")
        .arg("--timeout")
        .arg("1800")
        .output()
        .map_err(|err| format!("Failed to run NDI discovery: {err}"))?;
    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if stdout.is_empty() {
        return Err("NDI discovery returned no output".into());
    }
    let parsed: Value = serde_json::from_str(&stdout)
        .map_err(|err| format!("Invalid NDI discovery response: {err}"))?;
    if !parsed.get("ok").and_then(Value::as_bool).unwrap_or(false) {
        return Err(parsed
            .get("error")
            .and_then(Value::as_str)
            .unwrap_or("NDI discovery failed")
            .into());
    }
    let sources = parsed
        .get("sources")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default()
        .into_iter()
        .filter_map(|source| {
            let name = source.get("name")?.as_str()?.to_string();
            Some(NdiDiscoveredSource {
                name,
                url_address: source
                    .get("urlAddress")
                    .and_then(Value::as_str)
                    .map(str::to_string),
            })
        })
        .collect::<Vec<_>>();
    serde_json::to_string(&sources).map_err(|err| err.to_string())
}

#[tauri::command]
pub async fn start_ndi_input(config: NdiInputConfig) -> Result<String, String> {
    let source_name = config.source_name.trim().to_string();
    if source_name.is_empty() {
        return Err("NDI source name is required".into());
    }
    stop_ndi_input_runtime();

    let script = input_sidecar_script_path()?;
    let mut child = Command::new("node")
        .arg(script)
        .arg("--source")
        .arg(&source_name)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|err| format!("Failed to start NDI input sidecar: {err}"))?;

    let routed_source_id = if config.routed_source_id.trim().is_empty() {
        "camera:local-2".to_string()
    } else {
        config.routed_source_id.trim().to_string()
    };
    if let Some(stdout) = child.stdout.take() {
        spawn_input_frame_reader(stdout, routed_source_id.clone());
    }
    if let Some(stderr) = child.stderr.take() {
        spawn_input_stderr_reader(stderr);
    }

    {
        let mut runtime = ndi_input_runtime().lock().map_err(|err| err.to_string())?;
        runtime.status = NdiInputStatus {
            state: EngineHealthState::Starting,
            active: false,
            desired_active: true,
            source_name: Some(source_name),
            routed_source_id,
            width: 0,
            height: 0,
            frames_received: 0,
            dropped_frames: 0,
            started_at_ms: now_ms(),
            uptime_ms: 0,
            last_frame_ms: 0,
            last_frame_age_ms: 0,
            last_error: None,
        };
        runtime.child = Some(child);
    }

    serde_json::to_string(&current_ndi_input_status()).map_err(|err| err.to_string())
}

#[tauri::command]
pub async fn stop_ndi_input() -> Result<String, String> {
    stop_ndi_input_runtime();
    serde_json::to_string(&current_ndi_input_status()).map_err(|err| err.to_string())
}

#[tauri::command]
pub async fn get_ndi_input_status() -> Result<String, String> {
    serde_json::to_string(&current_ndi_input_status()).map_err(|err| err.to_string())
}

#[tauri::command]
pub async fn stop_ndi() -> Result<String, String> {
    stop_ndi_runtime();
    serde_json::to_string(&current_ndi_status()).map_err(|err| err.to_string())
}

#[tauri::command]
pub async fn get_ndi_status() -> Result<String, String> {
    serde_json::to_string(&current_ndi_status()).map_err(|err| err.to_string())
}
