use serde::{Deserialize, Serialize};

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
    #[serde(alias = "rtmpUrl", default)]
    pub rtmp_url: Option<String>,
}

fn default_protocol() -> String {
    "rtmp".into()
}
fn default_true() -> bool {
    true
}
fn default_width() -> u32 {
    1920
}
fn default_height() -> u32 {
    1080
}
fn default_fps() -> u32 {
    30
}
fn default_bitrate() -> u32 {
    6000
}

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
    pub bitrate: u32,
    #[serde(default)]
    pub encoder: String,
    #[serde(default)]
    pub mode: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum EngineHealthState {
    Inactive,
    Starting,
    Active,
    Recovering,
    Degraded,
    Error,
    Stopped,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OutputStatus {
    pub name: String,
    pub protocol: String,
    pub muxer: String,
    pub target: String,
    pub recovery_delay_ms: u64,
    pub state: EngineHealthState,
    pub last_error: Option<String>,
    pub last_update_ms: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ArchiveStatus {
    pub state: EngineHealthState,
    pub path_pattern: Option<String>,
    pub segment_seconds: u32,
    pub last_error: Option<String>,
    pub last_update_ms: u64,
}

#[derive(Debug, Clone)]
pub struct NativeStreamRuntime {
    pub desired_active: bool,
    pub active: bool,
    pub restarting: bool,
    pub restart_count: u32,
    pub max_restarts: u32,
    pub session_id: u64,
    pub last_spawn_at_ms: u64,
    pub last_restart_delay_ms: u64,
    pub ffmpeg_path: String,
    pub encoder: String,
    pub is_gpu: bool,
    pub config: Option<GPUStreamConfig>,
    pub lavfi_enabled: bool,
    pub archive_path_pattern: Option<String>,
    pub last_error: Option<String>,
    pub last_exit_status: Option<String>,
    pub started_at_ms: u64,
    pub last_restart_at_ms: u64,
    pub last_frame_at_ms: u64,
    pub bytes_written: u64,
    pub write_failures: u64,
    pub keepalive_frames: u64,
    pub last_frame: Option<Vec<u8>>,
    pub output_statuses: Vec<OutputStatus>,
    pub archive_status: ArchiveStatus,
}

impl Default for NativeStreamRuntime {
    fn default() -> Self {
        Self {
            desired_active: false,
            active: false,
            restarting: false,
            restart_count: 0,
            max_restarts: 0,
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
            output_statuses: Vec::new(),
            archive_status: ArchiveStatus {
                state: EngineHealthState::Inactive,
                path_pattern: None,
                segment_seconds: 0,
                last_error: None,
                last_update_ms: 0,
            },
        }
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct NativeStreamStats {
    pub frames: u64,
    pub active: bool,
    pub desired_active: bool,
    pub restarting: bool,
    pub restart_count: u32,
    pub max_restarts: u32,
    pub encoder: String,
    pub is_gpu: bool,
    pub width: u32,
    pub height: u32,
    pub fps: u32,
    pub bitrate_kbps: u32,
    pub bytes_written: u64,
    pub write_failures: u64,
    pub keepalive_frames: u64,
    pub archive_path_pattern: Option<String>,
    pub archive_segment_seconds: u32,
    pub last_restart_delay_ms: u64,
    pub last_error: Option<String>,
    pub last_exit_status: Option<String>,
    pub ffmpeg_path: String,
    pub last_frame_age_ms: u64,
    pub uptime_ms: u64,
    pub lavfi_enabled: bool,
    pub transport_mode: String,
    pub bridge_url: Option<String>,
    pub bridge_connected: bool,
    pub bridge_frames_received: u64,
    pub bridge_bytes_received: u64,
    pub bridge_last_error: Option<String>,
    pub output_statuses: Vec<OutputStatus>,
    pub archive_status: ArchiveStatus,
}

#[derive(Debug, Clone)]
pub struct FrameBridgeRuntime {
    pub session_id: u64,
    pub url: Option<String>,
    pub token: Option<String>,
    pub connected: bool,
    pub frames_received: u64,
    pub bytes_received: u64,
    pub shutdown_tx:
        Option<std::sync::Arc<std::sync::Mutex<Option<tokio::sync::oneshot::Sender<()>>>>>,
    pub last_error: Option<String>,
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
pub struct StartStreamResponse {
    pub message: String,
    pub bridge_url: Option<String>,
    pub bridge_token: Option<String>,
    pub transport: String,
}
