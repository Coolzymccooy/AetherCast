use std::io::Write;
use std::path::PathBuf;
use std::process::{Child, ChildStderr, Command, Stdio};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use base64::Engine;
use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use tokio::net::TcpListener;
use tokio::sync::oneshot;
use tokio_tungstenite::accept_async;
use tokio_tungstenite::tungstenite::Message;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct StreamDestination {
    pub url: String,
    #[serde(alias = "streamKey", alias = "stream_key", default)]
    pub stream_key: String,
    #[serde(default = "default_protocol")]
    pub protocol: String,
    #[serde(default)]
    pub name: String,
    #[serde(default = "default_true")]
    pub enabled: bool,
    // Legacy field from frontend
    #[serde(alias = "rtmpUrl", default)]
    pub rtmp_url: Option<String>,
}

fn default_protocol() -> String { "rtmp".into() }
fn default_true() -> bool { true }

#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct GPUStreamConfig {
    pub destinations: Vec<StreamDestination>,
    #[serde(default = "default_width")]
    pub width: u32,
    #[serde(default = "default_height")]
    pub height: u32,
    #[serde(default = "default_fps")]
    pub fps: u32,
    #[serde(default = "default_bitrate")]
    pub bitrate: u32, // kbps
    #[serde(default)]
    pub encoder: String, // auto, nvenc, qsv, videotoolbox, software
    /// Input mode: "raw" for raw RGBA pixels, "jpeg" for MJPEG frames via image2pipe
    #[serde(default)]
    pub mode: String,
}

fn default_width() -> u32 { 1920 }
fn default_height() -> u32 { 1080 }
fn default_fps() -> u32 { 30 }
fn default_bitrate() -> u32 { 6000 }

const DEFAULT_MAX_RESTARTS: u32 = 12;
const RESTART_RESET_AFTER_MS: u64 = 180_000;
const ARCHIVE_SEGMENT_SECONDS: u32 = 300;
const FIFO_QUEUE_SIZE: i32 = 180;

// ---------------------------------------------------------------------------
// Global state
// ---------------------------------------------------------------------------

fn ffmpeg_process() -> &'static Mutex<Option<Child>> {
    static INSTANCE: OnceLock<Mutex<Option<Child>>> = OnceLock::new();
    INSTANCE.get_or_init(|| Mutex::new(None))
}

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
        Self { frames: Vec::new(), capacity: 0, write_pos: 0, count: 0, width: 1920, height: 1080, fps: 30, active: false }
    }
}

fn replay_buffer() -> &'static Arc<Mutex<ReplayBuffer>> {
    static INSTANCE: OnceLock<Arc<Mutex<ReplayBuffer>>> = OnceLock::new();
    INSTANCE.get_or_init(|| Arc::new(Mutex::new(ReplayBuffer::new())))
}

#[derive(Debug, Clone)]
struct NativeStreamRuntime {
    desired_active: bool,
    active: bool,
    restarting: bool,
    restart_count: u32,
    max_restarts: u32,
    session_id: u64,
    last_spawn_at_ms: u64,
    last_restart_delay_ms: u64,
    ffmpeg_path: String,
    encoder: String,
    is_gpu: bool,
    config: Option<GPUStreamConfig>,
    lavfi_enabled: bool,
    archive_path_pattern: Option<String>,
    last_error: Option<String>,
    last_exit_status: Option<String>,
    started_at_ms: u64,
    last_restart_at_ms: u64,
    last_frame_at_ms: u64,
    bytes_written: u64,
    write_failures: u64,
    keepalive_frames: u64,
    last_frame: Option<Vec<u8>>,
}

impl Default for NativeStreamRuntime {
    fn default() -> Self {
        Self {
            desired_active: false,
            active: false,
            restarting: false,
            restart_count: 0,
            max_restarts: DEFAULT_MAX_RESTARTS,
            session_id: 0,
            last_spawn_at_ms: 0,
            last_restart_delay_ms: 0,
            ffmpeg_path: String::new(),
            encoder: String::new(),
            is_gpu: false,
            config: None,
            lavfi_enabled: true,
            archive_path_pattern: None,
            last_error: None,
            last_exit_status: None,
            started_at_ms: 0,
            last_restart_at_ms: 0,
            last_frame_at_ms: 0,
            bytes_written: 0,
            write_failures: 0,
            keepalive_frames: 0,
            last_frame: None,
        }
    }
}

#[derive(Debug, Serialize)]
struct NativeStreamStats {
    frames: u64,
    active: bool,
    desired_active: bool,
    restarting: bool,
    restart_count: u32,
    max_restarts: u32,
    encoder: String,
    is_gpu: bool,
    width: u32,
    height: u32,
    fps: u32,
    bitrate_kbps: u32,
    bytes_written: u64,
    write_failures: u64,
    keepalive_frames: u64,
    archive_path_pattern: Option<String>,
    archive_segment_seconds: u32,
    last_restart_delay_ms: u64,
    last_error: Option<String>,
    last_exit_status: Option<String>,
    ffmpeg_path: String,
    last_frame_age_ms: u64,
    uptime_ms: u64,
    lavfi_enabled: bool,
    transport_mode: String,
    bridge_url: Option<String>,
    bridge_connected: bool,
    bridge_frames_received: u64,
    bridge_bytes_received: u64,
    bridge_last_error: Option<String>,
}

fn stream_runtime() -> &'static Mutex<NativeStreamRuntime> {
    static INSTANCE: OnceLock<Mutex<NativeStreamRuntime>> = OnceLock::new();
    INSTANCE.get_or_init(|| Mutex::new(NativeStreamRuntime::default()))
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

#[derive(Debug, Clone)]
struct FrameBridgeRuntime {
    session_id: u64,
    url: Option<String>,
    token: Option<String>,
    connected: bool,
    frames_received: u64,
    bytes_received: u64,
    shutdown_tx: Option<Arc<Mutex<Option<oneshot::Sender<()>>>>>,
    last_error: Option<String>,
}

impl Default for FrameBridgeRuntime {
    fn default() -> Self {
        Self {
            session_id: 0,
            url: None,
            token: None,
            connected: false,
            frames_received: 0,
            bytes_received: 0,
            shutdown_tx: None,
            last_error: None,
        }
    }
}

#[derive(Debug, Serialize)]
struct StartStreamResponse {
    message: String,
    bridge_url: Option<String>,
    bridge_token: Option<String>,
    transport: String,
}

fn frame_bridge_runtime() -> &'static Mutex<FrameBridgeRuntime> {
    static INSTANCE: OnceLock<Mutex<FrameBridgeRuntime>> = OnceLock::new();
    INSTANCE.get_or_init(|| Mutex::new(FrameBridgeRuntime::default()))
}

fn restart_delay_ms(restart_count: u32) -> u64 {
    match restart_count {
        0 | 1 => 1_000,
        2 => 2_000,
        3 => 4_000,
        4 => 8_000,
        _ => 15_000,
    }
}

fn archive_root_dir() -> PathBuf {
    if cfg!(target_os = "windows") {
        if let Some(profile) = std::env::var_os("USERPROFILE") {
            return PathBuf::from(profile).join("Videos").join("AetherCast").join("Archive");
        }
    }

    if cfg!(target_os = "macos") {
        if let Some(home) = std::env::var_os("HOME") {
            return PathBuf::from(home).join("Movies").join("AetherCast").join("Archive");
        }
    }

    if let Some(home) = std::env::var_os("HOME") {
        return PathBuf::from(home).join("Videos").join("AetherCast").join("Archive");
    }

    std::env::current_dir()
        .unwrap_or_else(|_| std::env::temp_dir())
        .join("aether-archive")
}

fn build_archive_pattern(session_id: u64) -> Result<String, String> {
    let root = archive_root_dir();
    std::fs::create_dir_all(&root)
        .map_err(|e| format!("Failed to create archive directory {}: {}", root.display(), e))?;

    let pattern = root.join(format!("aethercast-session-{}-%Y%m%d-%H%M%S.mkv", session_id));
    Ok(pattern.to_string_lossy().replace('\\', "/"))
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

fn handle_frame_bytes(bytes: Vec<u8>) -> Result<(), String> {
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

    let mut guard = ffmpeg_stdin().lock().map_err(|e| e.to_string())?;
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
                println!("[aether] FFmpeg stdin write failed: {} — clearing stream", e);
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
            let bundled = dir.join(if cfg!(target_os = "windows") { "ffmpeg.exe" } else { "ffmpeg" });
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
        vec!["ffmpeg", "/opt/homebrew/bin/ffmpeg", "/usr/local/bin/ffmpeg"]
    } else {
        vec!["ffmpeg", "/usr/bin/ffmpeg", "/usr/local/bin/ffmpeg"]
    };

    for path in &candidates {
        if let Ok(status) = Command::new(path).arg("-version").stdout(Stdio::null()).stderr(Stdio::null()).status() {
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
    Command::new(ffmpeg_bin)
        .args(["-hide_banner", "-encoders"])
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .output()
        .map(|output| {
            let stdout = String::from_utf8_lossy(&output.stdout);
            stdout.contains(encoder)
        })
        .unwrap_or(false)
}

fn supports_lavfi(ffmpeg_bin: &str) -> bool {
    Command::new(ffmpeg_bin)
        .args(["-hide_banner", "-filters"])
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .output()
        .map(|output| {
            let stdout = String::from_utf8_lossy(&output.stdout);
            stdout.contains("anullsrc")
        })
        .unwrap_or(false)
}

fn destination_to_output(dest: &StreamDestination) -> (String, String) {
    let url = if let Some(ref rtmp_url) = dest.rtmp_url {
        if !rtmp_url.is_empty() { rtmp_url.clone() } else { dest.url.clone() }
    } else {
        dest.url.clone()
    };

    let proto = if dest.protocol.is_empty() {
        // Auto-detect from URL
        if url.starts_with("srt://") { "srt" } else if url.starts_with("rist://") { "rist" } else { "rtmp" }
    } else {
        dest.protocol.as_str()
    };

    match proto {
        "srt" => {
            let sep = if url.contains('?') { "&" } else { "?" };
            let full = format!("{}{}mode=caller&latency=200000", url, sep);
            ("mpegts".into(), full)
        }
        "rist" => ("mpegts".into(), url),
        _ => {
            // RTMP/RTMPS
            let full = if !dest.stream_key.is_empty() {
                format!("{}/{}", url.trim_end_matches('/'), dest.stream_key)
            } else {
                url
            };
            ("flv".into(), full)
        }
    }
}

fn build_ffmpeg_args(
    config: &GPUStreamConfig,
    active: &[&StreamDestination],
    encoder: &str,
    is_gpu: bool,
    lavfi_enabled: bool,
    archive_path_pattern: Option<&str>,
) -> Vec<String> {
    let is_jpeg_mode = config.mode == "jpeg";
    let mut args: Vec<String> = Vec::new();

    args.extend([
        "-y".into(),
        "-hide_banner".into(),
        "-loglevel".into(),
        "warning".into(),
    ]);

    if is_jpeg_mode {
        args.extend([
            "-fflags".into(), "+genpts+discardcorrupt+nobuffer".into(),
            "-thread_queue_size".into(), "4096".into(),
            "-f".into(), "image2pipe".into(),
            "-c:v".into(), "mjpeg".into(),
            "-framerate".into(), config.fps.to_string(),
            "-i".into(), "pipe:0".into(),
        ]);
    } else {
        args.extend([
            "-fflags".into(), "+genpts+discardcorrupt+nobuffer".into(),
            "-thread_queue_size".into(), "4096".into(),
            "-f".into(), "rawvideo".into(),
            "-pixel_format".into(), "rgba".into(),
            "-video_size".into(), format!("{}x{}", config.width, config.height),
            "-framerate".into(), config.fps.to_string(),
            "-i".into(), "pipe:0".into(),
        ]);
    }

    if lavfi_enabled {
        args.extend([
            "-f".into(), "lavfi".into(),
            "-i".into(), "anullsrc=r=44100:cl=stereo".into(),
        ]);
    }

    args.extend(["-map".into(), "0:v".into()]);
    if lavfi_enabled {
        args.extend([
            "-map".into(), "1:a".into(),
            "-c:a".into(), "aac".into(),
            "-b:a".into(), "128k".into(),
            "-ar".into(), "44100".into(),
            "-shortest".into(),
        ]);
    } else {
        args.push("-an".into());
    }

    if is_gpu {
        args.extend(["-c:v".into(), encoder.to_string()]);
        match encoder {
            "h264_nvenc" => {
                args.extend([
                    "-preset".into(), "p4".into(),
                    "-tune".into(), "ll".into(),
                    "-rc".into(), "cbr".into(),
                    "-b:v".into(), format!("{}k", config.bitrate),
                    "-maxrate".into(), format!("{}k", config.bitrate),
                    "-bufsize".into(), format!("{}k", config.bitrate * 2),
                    "-profile:v".into(), "high".into(),
                    "-g".into(), (config.fps * 2).to_string(),
                    "-keyint_min".into(), (config.fps * 2).to_string(),
                    "-sc_threshold".into(), "0".into(),
                    "-pix_fmt".into(), "yuv420p".into(),
                ]);
            }
            "h264_qsv" => {
                args.extend([
                    "-preset".into(), "fast".into(),
                    "-b:v".into(), format!("{}k", config.bitrate),
                    "-maxrate".into(), format!("{}k", config.bitrate),
                    "-bufsize".into(), format!("{}k", config.bitrate * 2),
                    "-profile:v".into(), "high".into(),
                    "-g".into(), (config.fps * 2).to_string(),
                    "-keyint_min".into(), (config.fps * 2).to_string(),
                    "-sc_threshold".into(), "0".into(),
                    "-pix_fmt".into(), "nv12".into(),
                ]);
            }
            "h264_amf" => {
                args.extend([
                    "-usage".into(), "ultralowlatency".into(),
                    "-rc".into(), "cbr".into(),
                    "-b:v".into(), format!("{}k", config.bitrate),
                    "-maxrate".into(), format!("{}k", config.bitrate),
                    "-bufsize".into(), format!("{}k", config.bitrate * 2),
                    "-profile:v".into(), "high".into(),
                    "-g".into(), (config.fps * 2).to_string(),
                    "-keyint_min".into(), (config.fps * 2).to_string(),
                    "-sc_threshold".into(), "0".into(),
                    "-pix_fmt".into(), "yuv420p".into(),
                ]);
            }
            "h264_videotoolbox" => {
                args.extend([
                    "-b:v".into(), format!("{}k", config.bitrate),
                    "-profile:v".into(), "high".into(),
                    "-g".into(), (config.fps * 2).to_string(),
                    "-keyint_min".into(), (config.fps * 2).to_string(),
                    "-sc_threshold".into(), "0".into(),
                    "-pix_fmt".into(), "yuv420p".into(),
                ]);
            }
            _ => {
                args.extend([
                    "-pix_fmt".into(), "yuv420p".into(),
                    "-b:v".into(), format!("{}k", config.bitrate),
                ]);
            }
        }
    } else {
        args.extend([
            "-c:v".into(), "libx264".into(),
            "-preset".into(), "veryfast".into(),
            "-tune".into(), "zerolatency".into(),
            "-b:v".into(), format!("{}k", config.bitrate),
            "-maxrate".into(), format!("{}k", config.bitrate),
            "-bufsize".into(), format!("{}k", config.bitrate * 2),
            "-pix_fmt".into(), "yuv420p".into(),
            "-profile:v".into(), "high".into(),
            "-g".into(), (config.fps * 2).to_string(),
            "-keyint_min".into(), (config.fps * 2).to_string(),
            "-sc_threshold".into(), "0".into(),
        ]);
    }

    args.extend([
        "-max_interleave_delta".into(), "0".into(),
        "-flags".into(), "+global_header".into(),
        "-flvflags".into(), "no_duration_filesize".into(),
    ]);

    let mut tee_outputs: Vec<String> = active
        .iter()
        .map(|d| {
            let (fmt, url) = destination_to_output(d);
            format!("[f={}:onfail=ignore]{}", fmt, url)
        })
        .collect();

    if let Some(archive_path_pattern) = archive_path_pattern {
        tee_outputs.push(format!(
            "[f=segment:onfail=ignore:segment_format=matroska:segment_time={}:reset_timestamps=1:strftime=1]{}",
            ARCHIVE_SEGMENT_SECONDS,
            archive_path_pattern
        ));
    }

    let fifo_options = format!(
        "attempt_recovery=1:recover_any_error=1:drop_pkts_on_overflow=1:queue_size={}:max_recovery_attempts=0:recovery_wait_time=1:restart_with_keyframe=1",
        FIFO_QUEUE_SIZE
    );
    args.extend([
        "-f".into(),
        "tee".into(),
        "-use_fifo".into(),
        "1".into(),
        "-fifo_options".into(),
        fifo_options,
        tee_outputs.join("|"),
    ]);

    args
}

fn start_keepalive_loop(session_id: u64) {
    std::thread::spawn(move || {
        loop {
            let (should_run, current_session_id, fps, last_frame, last_frame_at_ms) = {
                let state = match stream_runtime().lock() {
                    Ok(guard) => guard,
                    Err(_) => return,
                };
                (
                    state.desired_active,
                    state.session_id,
                    state.config.as_ref().map(|cfg| cfg.fps).unwrap_or(30),
                    state.last_frame.clone(),
                    state.last_frame_at_ms,
                )
            };

            if !should_run || current_session_id != session_id {
                return;
            }

            let frame_interval_ms = u64::from(1000 / fps.max(1));
            let now = now_ms();
            let should_duplicate = last_frame.is_some()
                && now.saturating_sub(last_frame_at_ms) >= frame_interval_ms.saturating_mul(2);

            if should_duplicate {
                let bytes = last_frame.unwrap_or_default();
                let write_result = {
                    let mut guard = match ffmpeg_stdin().lock() {
                        Ok(guard) => guard,
                        Err(_) => return,
                    };
                    if let Some(ref mut stdin) = *guard {
                        stdin.write_all(&bytes)
                    } else {
                        Ok(())
                    }
                };

                match write_result {
                    Ok(()) => {
                        if let Ok(mut counter) = frame_counter().lock() {
                            *counter += 1;
                        }
                        if let Ok(mut state) = stream_runtime().lock() {
                            if state.session_id != session_id || !state.desired_active {
                                return;
                            }
                            state.keepalive_frames += 1;
                            state.bytes_written += bytes.len() as u64;
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
        }
    });
}

fn spawn_ffmpeg_from_runtime() -> Result<(), String> {
    let (config, ffmpeg_bin, encoder, is_gpu, lavfi_enabled, restart_count, archive_path_pattern) = {
        let state = stream_runtime().lock().map_err(|e| e.to_string())?;
        if !state.desired_active {
            return Err("Stream is not marked active".into());
        }
        (
            state.config.clone().ok_or("Missing stream config")?,
            state.ffmpeg_path.clone(),
            state.encoder.clone(),
            state.is_gpu,
            state.lavfi_enabled,
            state.restart_count,
            state.archive_path_pattern.clone(),
        )
    };

    let active: Vec<&StreamDestination> = config.destinations.iter().filter(|d| d.enabled).collect();
    if active.is_empty() {
        return Err("No enabled destinations".into());
    }

    let args = build_ffmpeg_args(
        &config,
        &active,
        &encoder,
        is_gpu,
        lavfi_enabled,
        archive_path_pattern.as_deref(),
    );
    println!("[aether] FFmpeg command: {} {}", ffmpeg_bin, args.join(" "));

    let mut cmd = Command::new(&ffmpeg_bin);
    cmd.args(&args).stdin(Stdio::piped()).stdout(Stdio::null()).stderr(Stdio::piped());

    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x08000000);
    }

    let mut child = cmd.spawn().map_err(|e| format!("Failed to spawn FFmpeg: {}", e))?;
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
        if state.started_at_ms == 0 {
            state.started_at_ms = now_ms();
        }
        state.last_spawn_at_ms = now_ms();
        println!(
            "[aether] Native stream active: encoder={} lavfi={} restart={}",
            state.encoder,
            state.lavfi_enabled,
            restart_count
        );
    }

    spawn_ffmpeg_monitor(child_pid, stderr_handle);
    Ok(())
}

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
                }
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
                    state.last_error = Some(err);
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
    let active: Vec<&StreamDestination> = config.destinations.iter().filter(|d| d.enabled).collect();
    if active.is_empty() {
        return Err("No enabled destinations".into());
    }

    {
        let guard = stream_runtime().lock().map_err(|e| e.to_string())?;
        if guard.desired_active {
            return Err("Stream already running. Stop it first.".into());
        }
    }

    let ffmpeg_bin = find_ffmpeg();

    // Auto-detect or use specified encoder
    let encoder = if config.encoder.is_empty() || config.encoder == "auto" {
        detect_gpu_encoder(&ffmpeg_bin)
    } else if config.encoder == "software" {
        "libx264".to_string()
    } else {
        config.encoder.clone()
    };

    let is_gpu = encoder != "libx264";
    let lavfi_enabled = supports_lavfi(&ffmpeg_bin);
    let session_id = now_ms();
    let archive_path_pattern = build_archive_pattern(session_id)?;

    if let Ok(mut counter) = frame_counter().lock() {
        *counter = 0;
    }

    {
        let mut state = stream_runtime().lock().map_err(|e| e.to_string())?;
        state.desired_active = true;
        state.active = false;
        state.restarting = false;
        state.restart_count = 0;
        state.session_id = session_id;
        state.last_spawn_at_ms = 0;
        state.last_restart_delay_ms = 0;
        state.ffmpeg_path = ffmpeg_bin.clone();
        state.encoder = encoder.clone();
        state.is_gpu = is_gpu;
        state.config = Some(config.clone());
        state.lavfi_enabled = lavfi_enabled;
        state.archive_path_pattern = Some(archive_path_pattern.clone());
        state.last_error = None;
        state.last_exit_status = None;
        state.started_at_ms = now_ms();
        state.last_restart_at_ms = 0;
        state.last_frame_at_ms = 0;
        state.bytes_written = 0;
        state.write_failures = 0;
        state.keepalive_frames = 0;
        state.last_frame = None;
    }

    start_keepalive_loop(session_id);
    spawn_ffmpeg_from_runtime()?;

    let bridge_url = match start_frame_bridge(session_id).await {
        Ok(url) => Some(url),
        Err(err) => {
            println!("[aether] Frame bridge unavailable, using invoke fallback: {}", err);
            if let Ok(mut state) = stream_runtime().lock() {
                state.last_error = Some(format!("Frame bridge unavailable, using invoke fallback: {}", err));
            }
            None
        }
    };

    let encoder_label = if is_gpu { format!("GPU ({})", encoder) } else { "Software (libx264)".into() };
    let mode_label = if config.mode == "jpeg" { "JPEG->image2pipe" } else { "Raw RGBA" };
    let audio_label = if lavfi_enabled { "with silent audio keepalive" } else { "without synthetic audio fallback" };
    let message = format!(
        "Streaming via {} [{}] {} at {}x{} @{}fps to {} destination(s); archive segments: {}",
        encoder_label,
        mode_label,
        audio_label,
        config.width,
        config.height,
        config.fps,
        active.len(),
        archive_path_pattern
    );

    let response = StartStreamResponse {
        message,
        bridge_url: bridge_url.clone(),
        bridge_token: None,
        transport: if bridge_url.is_some() { "bridge".into() } else { "invoke".into() },
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
    }

    stop_frame_bridge();
    { *ffmpeg_stdin().lock().map_err(|e| e.to_string())? = None; }
    let mut guard = ffmpeg_process().lock().map_err(|e| e.to_string())?;
    if let Some(mut child) = guard.take() {
        let _ = child.kill();
        let _ = child.wait();
    }

    let frames = frame_counter().lock().map(|c| *c).unwrap_or(0);
    return Ok(match archive_path_pattern {
        Some(path) => format!("Stream stopped ({} frames encoded). Archive segments: {}", frames, path),
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
        return Err(format!("Frame size mismatch: {} vs expected {}", frame_data.len(), expected));
    }

    {
        if let Ok(mut rb) = replay_buffer().lock() {
            rb.width = width;
            rb.height = height;
        }
    }

    handle_frame_bytes(frame_data)
}

/// Get streaming stats
#[tauri::command]
pub async fn get_stream_stats() -> Result<String, String> {
    let frames = frame_counter().lock().map(|c| *c).unwrap_or(0);
    let state = stream_runtime().lock().map_err(|e| e.to_string())?.clone();
    let bridge = frame_bridge_runtime().lock().map_err(|e| e.to_string())?.clone();
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
        encoder: state.encoder,
        is_gpu: state.is_gpu,
        width,
        height,
        fps,
        bitrate_kbps,
        bytes_written: state.bytes_written,
        write_failures: state.write_failures,
        keepalive_frames: state.keepalive_frames,
        archive_path_pattern: state.archive_path_pattern,
        archive_segment_seconds: ARCHIVE_SEGMENT_SECONDS,
        last_restart_delay_ms: state.last_restart_delay_ms,
        last_error: state.last_error,
        last_exit_status: state.last_exit_status,
        ffmpeg_path: state.ffmpeg_path,
        last_frame_age_ms,
        uptime_ms,
        lavfi_enabled: state.lavfi_enabled,
        transport_mode: if bridge.url.is_some() { "bridge".into() } else { "invoke".into() },
        bridge_url: bridge.url,
        bridge_connected: bridge.connected,
        bridge_frames_received: bridge.frames_received,
        bridge_bytes_received: bridge.bytes_received,
        bridge_last_error: bridge.last_error,
    }).map_err(|e| e.to_string())?);
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
    }).to_string())
}

#[tauri::command]
pub async fn start_replay_buffer(buffer_duration_sec: u32, fps: u32) -> Result<String, String> {
    let capacity = (buffer_duration_sec * fps) as usize;
    if capacity == 0 { return Err("Buffer params must be > 0".into()); }
    let mut rb = replay_buffer().lock().map_err(|e| e.to_string())?;
    rb.frames = Vec::with_capacity(capacity);
    rb.capacity = capacity;
    rb.write_pos = 0;
    rb.count = 0;
    rb.fps = fps;
    rb.active = true;
    Ok(format!("Replay buffer: {}s @{}fps", buffer_duration_sec, fps))
}

#[tauri::command]
pub async fn capture_replay(duration_sec: u32) -> Result<String, String> {
    let (frames_to_save, width, height, fps) = {
        let rb = replay_buffer().lock().map_err(|e| e.to_string())?;
        if !rb.active || rb.count == 0 { return Err("No replay data".into()); }
        let n = ((duration_sec * rb.fps) as usize).min(rb.count);
        let start = if rb.count == rb.capacity { (rb.write_pos + rb.capacity - n) % rb.capacity } else { rb.count - n };
        let frames: Vec<Vec<u8>> = (0..n).filter_map(|i| {
            let idx = (start + i) % rb.capacity;
            rb.frames.get(idx).cloned()
        }).collect();
        (frames, rb.width, rb.height, rb.fps)
    };

    let ts = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap_or_default().as_secs();
    let out = std::env::temp_dir().join(format!("aether_replay_{}.webm", ts));
    let out_str = out.to_string_lossy().to_string();
    let ffmpeg_bin = find_ffmpeg();

    let mut child = Command::new(&ffmpeg_bin)
        .args(["-y", "-f", "rawvideo", "-pixel_format", "rgba", "-video_size", &format!("{}x{}", width, height),
               "-framerate", &fps.to_string(), "-i", "pipe:0", "-c:v", "libvpx-vp9", "-crf", "30", "-b:v", "0", &out_str])
        .stdin(Stdio::piped()).stdout(Stdio::null()).stderr(Stdio::null()).spawn()
        .map_err(|e| format!("FFmpeg spawn failed: {}", e))?;

    if let Some(ref mut stdin) = child.stdin {
        for frame in &frames_to_save { let _ = stdin.write_all(frame); }
    }
    drop(child.stdin.take());

    let status = child.wait().map_err(|e| e.to_string())?;
    if !status.success() { return Err(format!("FFmpeg exited: {}", status)); }
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

