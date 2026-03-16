// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::io::Write;
use std::process::{Child, Command, Stdio};
use std::sync::{Arc, Mutex, OnceLock};

use serde::{Deserialize, Serialize};

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
}

fn default_width() -> u32 { 1920 }
fn default_height() -> u32 { 1080 }
fn default_fps() -> u32 { 30 }
fn default_bitrate() -> u32 { 6000 }

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

// ---------------------------------------------------------------------------
// Tauri Commands
// ---------------------------------------------------------------------------

/// Start GPU-accelerated streaming pipeline
#[tauri::command]
async fn start_stream(config: GPUStreamConfig) -> Result<String, String> {
    let active: Vec<&StreamDestination> = config.destinations.iter().filter(|d| d.enabled).collect();
    if active.is_empty() {
        return Err("No enabled destinations".into());
    }

    // Check no stream is running
    {
        let guard = ffmpeg_process().lock().map_err(|e| e.to_string())?;
        if guard.is_some() {
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
    println!("[aether] Starting stream: {}x{} @{}fps {}kbps encoder={}",
             config.width, config.height, config.fps, config.bitrate, encoder);

    let mut args: Vec<String> = Vec::new();

    // Global flags
    args.extend(["-y".into(), "-hide_banner".into(), "-loglevel".into(), "warning".into()]);

    // Input 0: raw RGBA video from stdin
    args.extend([
        "-f".into(), "rawvideo".into(),
        "-pixel_format".into(), "rgba".into(),
        "-video_size".into(), format!("{}x{}", config.width, config.height),
        "-framerate".into(), config.fps.to_string(),
        "-i".into(), "pipe:0".into(),
    ]);

    // Input 1: silent audio (required by YouTube/Twitch — they won't start without an audio track)
    args.extend([
        "-f".into(), "lavfi".into(),
        "-i".into(), "anullsrc=r=44100:cl=stereo".into(),
    ]);

    // Map both inputs and add AAC audio encoding
    args.extend([
        "-map".into(), "0:v".into(),   // video from stdin
        "-map".into(), "1:a".into(),   // audio from anullsrc
        "-c:a".into(), "aac".into(),
        "-b:a".into(), "128k".into(),
        "-ar".into(), "44100".into(),
        "-shortest".into(),            // stop when video stops
    ]);

    // Encoder-specific options
    if is_gpu {
        args.extend(["-c:v".into(), encoder.clone()]);

        match encoder.as_str() {
            "h264_nvenc" => {
                args.extend([
                    "-preset".into(), "p4".into(),        // balanced quality/speed
                    "-tune".into(), "ll".into(),           // low latency
                    "-rc".into(), "cbr".into(),            // constant bitrate for RTMP
                    "-b:v".into(), format!("{}k", config.bitrate),
                    "-maxrate".into(), format!("{}k", config.bitrate),
                    "-bufsize".into(), format!("{}k", config.bitrate * 2),
                    "-profile:v".into(), "high".into(),
                    "-g".into(), (config.fps * 2).to_string(), // 2-second keyframe
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
                    "-pix_fmt".into(), "yuv420p".into(),
                ]);
            }
            "h264_videotoolbox" => {
                args.extend([
                    "-b:v".into(), format!("{}k", config.bitrate),
                    "-profile:v".into(), "high".into(),
                    "-g".into(), (config.fps * 2).to_string(),
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
        // Software fallback
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
        ]);
    }

    // Output — maps are already set above (0:v for video, 1:a for audio)
    if active.len() == 1 {
        let (fmt, url) = destination_to_output(active[0]);
        args.extend(["-f".into(), fmt, url]);
    } else {
        let tee: Vec<String> = active.iter().map(|d| {
            let (fmt, url) = destination_to_output(d);
            format!("[f={}:onfail=ignore]{}", fmt, url)
        }).collect();
        args.extend(["-f".into(), "tee".into(), tee.join("|")]);
    }

    println!("[aether] FFmpeg command: ffmpeg {}", args.join(" "));

    let mut cmd = Command::new(&ffmpeg_bin);
    cmd.args(&args).stdin(Stdio::piped()).stdout(Stdio::null()).stderr(Stdio::piped());

    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW
    }

    let mut child = cmd.spawn().map_err(|e| format!("Failed to spawn FFmpeg: {}", e))?;
    let stdin_handle = child.stdin.take().ok_or("Failed to capture FFmpeg stdin")?;

    // Reset frame counter
    if let Ok(mut counter) = frame_counter().lock() { *counter = 0; }

    // Store handles
    *ffmpeg_stdin().lock().map_err(|e| e.to_string())? = Some(stdin_handle);
    *ffmpeg_process().lock().map_err(|e| e.to_string())? = Some(child);

    let encoder_label = if is_gpu { format!("GPU ({})", encoder) } else { "Software (libx264)".into() };
    Ok(format!("Streaming via {} to {} destination(s)", encoder_label, active.len()))
}

#[tauri::command]
async fn stop_stream() -> Result<String, String> {
    { *ffmpeg_stdin().lock().map_err(|e| e.to_string())? = None; }
    let mut guard = ffmpeg_process().lock().map_err(|e| e.to_string())?;
    if let Some(mut child) = guard.take() {
        let _ = child.kill();
        let _ = child.wait();
        let frames = frame_counter().lock().map(|c| *c).unwrap_or(0);
        Ok(format!("Stream stopped ({} frames encoded)", frames))
    } else {
        Ok("No active stream".into())
    }
}

/// Receive raw RGBA frame and write to FFmpeg stdin
#[tauri::command]
async fn encode_frame(frame_data: Vec<u8>, width: u32, height: u32) -> Result<(), String> {
    let expected = (width * height * 4) as usize;
    if frame_data.len() != expected {
        return Err(format!("Frame size mismatch: {} vs expected {}", frame_data.len(), expected));
    }

    // Push to replay buffer if active
    {
        if let Ok(mut rb) = replay_buffer().lock() {
            if rb.active && rb.capacity > 0 {
                rb.width = width;
                rb.height = height;
                let pos = rb.write_pos;
                if pos < rb.frames.len() {
                    rb.frames[pos] = frame_data.clone();
                } else {
                    rb.frames.push(frame_data.clone());
                }
                rb.write_pos = (pos + 1) % rb.capacity;
                if rb.count < rb.capacity { rb.count += 1; }
            }
        }
    }

    // Write to FFmpeg
    let mut guard = ffmpeg_stdin().lock().map_err(|e| e.to_string())?;
    if let Some(ref mut stdin) = *guard {
        stdin.write_all(&frame_data).map_err(|e| format!("Write failed: {}", e))?;
        // Don't flush every frame — let the OS buffer handle it for throughput
        if let Ok(mut c) = frame_counter().lock() { *c += 1; }
        Ok(())
    } else {
        Err("No active stream".into())
    }
}

/// Get streaming stats
#[tauri::command]
async fn get_stream_stats() -> Result<String, String> {
    let frames = frame_counter().lock().map(|c| *c).unwrap_or(0);
    let is_active = ffmpeg_process().lock().map(|g| g.is_some()).unwrap_or(false);
    Ok(serde_json::json!({
        "frames": frames,
        "active": is_active,
    }).to_string())
}

/// Detect available GPU encoder
#[tauri::command]
async fn detect_encoder() -> Result<String, String> {
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
async fn start_replay_buffer(buffer_duration_sec: u32, fps: u32) -> Result<String, String> {
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
async fn capture_replay(duration_sec: u32) -> Result<String, String> {
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
async fn stop_replay_buffer() -> Result<String, String> {
    let mut rb = replay_buffer().lock().map_err(|e| e.to_string())?;
    rb.active = false;
    rb.frames.clear();
    rb.capacity = 0;
    Ok("Replay buffer stopped".into())
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

fn main() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            start_stream, stop_stream, encode_frame,
            get_stream_stats, detect_encoder,
            start_replay_buffer, capture_replay, stop_replay_buffer,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
