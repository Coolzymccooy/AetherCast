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
fn default_audio_mode() -> String {
    "auto".into()
}
fn default_audio_sample_rate() -> u32 {
    48_000
}
fn default_audio_channels() -> u32 {
    2
}
fn default_audio_bitrate() -> u32 {
    160
}
fn default_audio_bus_volume() -> f32 {
    1.0
}
fn default_native_source_width() -> u32 {
    1280
}
fn default_native_source_height() -> u32 {
    720
}
fn default_native_source_fps() -> u32 {
    30
}
fn default_native_source_backend() -> String {
    "dshow".into()
}

#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct NativeVideoSourceConfig {
    #[serde(alias = "sourceId")]
    pub source_id: String,
    #[serde(alias = "deviceName")]
    pub device_name: String,
    #[serde(default = "default_native_source_backend")]
    pub backend: String,
    #[serde(default = "default_native_source_width")]
    pub width: u32,
    #[serde(default = "default_native_source_height")]
    pub height: u32,
    #[serde(default = "default_native_source_fps")]
    pub fps: u32,
}

#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct NativeAudioBusConfig {
    #[serde(alias = "busId")]
    pub bus_id: String,
    #[serde(default)]
    pub name: String,
    #[serde(default, alias = "sourceKind")]
    pub source_kind: String,
    #[serde(default = "default_audio_bus_volume")]
    pub volume: f32,
    #[serde(default)]
    pub muted: bool,
    #[serde(default, alias = "delayMs")]
    pub delay_ms: u32,
    #[serde(default, alias = "monitorEnabled")]
    pub monitor_enabled: bool,
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
    #[serde(default = "default_audio_mode", alias = "audioMode")]
    pub audio_mode: String,
    #[serde(default, alias = "audioDevice")]
    pub audio_device: String,
    #[serde(default = "default_audio_sample_rate", alias = "audioSampleRate")]
    pub audio_sample_rate: u32,
    #[serde(default = "default_audio_channels", alias = "audioChannels")]
    pub audio_channels: u32,
    #[serde(default = "default_audio_bitrate", alias = "audioBitrate")]
    pub audio_bitrate: u32,
    #[serde(default = "default_true", alias = "includeMicrophone")]
    pub include_microphone: bool,
    #[serde(default = "default_true", alias = "includeSystemAudio")]
    pub include_system_audio: bool,
    #[serde(default, alias = "audioBuses")]
    pub audio_buses: Vec<NativeAudioBusConfig>,
    #[serde(default, alias = "nativeVideoSources")]
    pub native_video_sources: Vec<NativeVideoSourceConfig>,
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

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum NativeAudioSourceKind {
    Microphone,
    System,
    Virtual,
    Synthetic,
    Unknown,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum NativeSourceKind {
    Camera,
    Screen,
    Remote,
    Browser,
    Media,
    Overlay,
    Background,
    Unknown,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NativeAudioInput {
    pub name: String,
    pub alternative_name: Option<String>,
    pub kind: NativeAudioSourceKind,
    pub backend: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NativeAudioBusStatus {
    pub bus_id: String,
    pub name: String,
    pub source_kind: NativeAudioSourceKind,
    pub input_name: Option<String>,
    pub volume: f32,
    pub muted: bool,
    pub delay_ms: u32,
    pub monitor_enabled: bool,
    pub state: EngineHealthState,
    pub last_error: Option<String>,
    pub last_event: Option<String>,
    pub last_update_ms: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NativeAudioStatus {
    pub state: EngineHealthState,
    pub mode: String,
    pub backend: String,
    pub input_count: u32,
    pub sample_rate: u32,
    pub channels: u32,
    pub bitrate_kbps: u32,
    pub source_summary: String,
    pub inputs: Vec<NativeAudioInput>,
    pub buses: Vec<NativeAudioBusStatus>,
    pub using_synthetic: bool,
    pub last_error: Option<String>,
    pub last_event: Option<String>,
    pub last_update_ms: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NativeSourceStatus {
    pub source_id: String,
    pub label: String,
    pub source_kind: NativeSourceKind,
    pub state: EngineHealthState,
    pub recovery_delay_ms: u64,
    pub restart_count: u32,
    pub last_event: Option<String>,
    pub source_status: Option<String>,
    pub resolution: Option<String>,
    pub fps: Option<u32>,
    pub audio_level: Option<f32>,
    pub browser_owned: bool,
    pub frame_width: u32,
    pub frame_height: u32,
    pub last_frame_ms: u64,
    pub last_inventory_sync_ms: u64,
    pub last_update_ms: u64,
    pub last_error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OutputStatus {
    pub worker_id: String,
    pub name: String,
    pub protocol: String,
    pub muxer: String,
    pub target: String,
    pub recovery_delay_ms: u64,
    pub restart_count: u32,
    pub last_event: Option<String>,
    pub state: EngineHealthState,
    pub last_error: Option<String>,
    pub last_update_ms: u64,
    pub target_width: Option<u32>,
    pub target_height: Option<u32>,
    pub target_fps: Option<u32>,
    pub target_bitrate_kbps: Option<u32>,
    pub measured_fps: Option<f32>,
    pub measured_bitrate_kbps: Option<f32>,
    pub encoder_speed: Option<f32>,
    pub first_progress_ms: Option<u64>,
    pub last_progress_ms: Option<u64>,
    pub performance_warning_since_ms: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ArchiveStatus {
    pub state: EngineHealthState,
    pub path_pattern: Option<String>,
    pub segment_seconds: u32,
    pub recovery_delay_ms: u64,
    pub restart_count: u32,
    pub last_event: Option<String>,
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
    pub watchdog_renders: u64,
    pub last_frame: Option<Vec<u8>>,
    pub audio_status: NativeAudioStatus,
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
            watchdog_renders: 0,
            last_frame: None,
            audio_status: NativeAudioStatus {
                state: EngineHealthState::Inactive,
                mode: "silent".into(),
                backend: "none".into(),
                input_count: 0,
                sample_rate: default_audio_sample_rate(),
                channels: default_audio_channels(),
                bitrate_kbps: default_audio_bitrate(),
                source_summary: "No native audio input".into(),
                inputs: Vec::new(),
                buses: Vec::new(),
                using_synthetic: false,
                last_error: None,
                last_event: None,
                last_update_ms: 0,
            },
            output_statuses: Vec::new(),
            archive_status: ArchiveStatus {
                state: EngineHealthState::Inactive,
                path_pattern: None,
                segment_seconds: 0,
                recovery_delay_ms: 0,
                restart_count: 0,
                last_event: None,
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
    pub session_id: u64,
    pub encoder: String,
    pub is_gpu: bool,
    pub width: u32,
    pub height: u32,
    pub fps: u32,
    pub bitrate_kbps: u32,
    pub bytes_written: u64,
    pub write_failures: u64,
    pub keepalive_frames: u64,
    pub watchdog_renders: u64,
    pub archive_path_pattern: Option<String>,
    pub archive_segment_seconds: u32,
    pub last_restart_delay_ms: u64,
    pub last_error: Option<String>,
    pub last_exit_status: Option<String>,
    pub ffmpeg_path: String,
    pub started_at_ms: u64,
    pub last_frame_age_ms: u64,
    pub uptime_ms: u64,
    pub lavfi_enabled: bool,
    pub transport_mode: String,
    pub frame_transport: String,
    pub bridge_url: Option<String>,
    pub bridge_connected: bool,
    pub bridge_frames_received: u64,
    pub bridge_bytes_received: u64,
    pub bridge_last_error: Option<String>,
    pub source_bridge_url: Option<String>,
    pub source_bridge_connected_sources: u32,
    pub source_bridge_frames_received: u64,
    pub source_bridge_bytes_received: u64,
    pub source_bridge_last_error: Option<String>,
    pub video_status: NativeVideoStatus,
    pub source_statuses: Vec<NativeSourceStatus>,
    pub audio_status: NativeAudioStatus,
    pub output_statuses: Vec<OutputStatus>,
    pub archive_status: ArchiveStatus,
    pub ndi_status: NdiStatus,
    pub ndi_input_status: NdiInputStatus,
}

#[derive(Debug, Clone, Serialize)]
pub struct NativeAudioDiscovery {
    pub ffmpeg_path: String,
    pub supports_dshow: bool,
    pub supports_lavfi: bool,
    pub devices: Vec<NativeAudioInput>,
    pub suggested_status: NativeAudioStatus,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NativeVideoStatus {
    pub state: EngineHealthState,
    pub render_path: String,
    pub scene_revision: u64,
    pub active_scene_id: Option<String>,
    pub active_scene_name: Option<String>,
    pub scene_type: Option<String>,
    pub layout: Option<String>,
    pub node_count: usize,
    pub visible_node_count: usize,
    pub source_frame_count: usize,
    pub last_sync_ms: u64,
    pub last_render_ms: u64,
    pub last_error: Option<String>,
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

#[derive(Debug, Clone)]
pub struct SourceBridgeRuntime {
    pub session_id: u64,
    pub url: Option<String>,
    pub connected_sources: std::collections::HashSet<String>,
    pub frames_received: u64,
    pub bytes_received: u64,
    pub shutdown_tx:
        Option<std::sync::Arc<std::sync::Mutex<Option<tokio::sync::oneshot::Sender<()>>>>>,
    pub last_error: Option<String>,
}

impl Default for SourceBridgeRuntime {
    fn default() -> Self {
        Self {
            session_id: 0,
            url: None,
            connected_sources: std::collections::HashSet::new(),
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
    pub source_bridge_url: Option<String>,
    pub transport: String,
}

#[derive(Debug, Serialize)]
pub struct VirtualCameraStartResponse {
    pub message: String,
    pub bridge_url: String,
}

#[derive(Debug, Serialize, Clone)]
pub struct VirtualCameraStatus {
    pub state: EngineHealthState,
    pub active: bool,
    pub desired_active: bool,
    pub backend: String,
    pub transport: String,
    pub os_device_exposed: bool,
    pub bridge_url: Option<String>,
    pub width: u32,
    pub height: u32,
    pub fps: u32,
    pub consumer_count: u32,
    pub frames_rendered: u64,
    pub frames_served: u64,
    pub uptime_ms: u64,
    pub last_frame_age_ms: u64,
    pub note: String,
    pub last_error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NdiHealth {
    pub ok: bool,
    pub error: Option<String>,
    #[serde(default)]
    pub mock: bool,
}

impl Default for NdiHealth {
    fn default() -> Self {
        Self {
            ok: false,
            error: None,
            mock: false,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NdiSourceStatus {
    pub key: String,
    pub name: String,
    pub state: EngineHealthState,
    pub frames_sent: u64,
    pub dropped_frames: u64,
    pub last_frame_ms: u64,
    pub last_frame_age_ms: u64,
    pub last_error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NdiStatus {
    pub state: EngineHealthState,
    pub health: NdiHealth,
    pub active: bool,
    pub desired_active: bool,
    pub width: u32,
    pub height: u32,
    pub fps: u32,
    pub alpha_enabled: bool,
    pub frames_sent: u64,
    pub dropped_frames: u64,
    pub started_at_ms: u64,
    pub uptime_ms: u64,
    pub last_frame_ms: u64,
    pub last_frame_age_ms: u64,
    pub last_error: Option<String>,
    pub sources: Vec<NdiSourceStatus>,
}

impl Default for NdiStatus {
    fn default() -> Self {
        Self {
            state: EngineHealthState::Inactive,
            health: NdiHealth::default(),
            active: false,
            desired_active: false,
            width: 1920,
            height: 1080,
            fps: 30,
            alpha_enabled: true,
            frames_sent: 0,
            dropped_frames: 0,
            started_at_ms: 0,
            uptime_ms: 0,
            last_frame_ms: 0,
            last_frame_age_ms: 0,
            last_error: None,
            sources: Vec::new(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NdiDiscoveredSource {
    pub name: String,
    pub url_address: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NdiInputStatus {
    pub state: EngineHealthState,
    pub active: bool,
    pub desired_active: bool,
    pub source_name: Option<String>,
    pub routed_source_id: String,
    pub width: u32,
    pub height: u32,
    pub frames_received: u64,
    pub dropped_frames: u64,
    pub started_at_ms: u64,
    pub uptime_ms: u64,
    pub last_frame_ms: u64,
    pub last_frame_age_ms: u64,
    pub last_error: Option<String>,
}

impl Default for NdiInputStatus {
    fn default() -> Self {
        Self {
            state: EngineHealthState::Inactive,
            active: false,
            desired_active: false,
            source_name: None,
            routed_source_id: "camera:local-2".into(),
            width: 0,
            height: 0,
            frames_received: 0,
            dropped_frames: 0,
            started_at_ms: 0,
            uptime_ms: 0,
            last_frame_ms: 0,
            last_frame_age_ms: 0,
            last_error: None,
        }
    }
}

#[derive(Debug, Clone, Deserialize)]
pub struct NdiInputConfig {
    #[serde(alias = "sourceName")]
    pub source_name: String,
    #[serde(default = "default_ndi_input_route", alias = "routedSourceId")]
    pub routed_source_id: String,
}

fn default_ndi_input_route() -> String {
    "camera:local-2".into()
}

#[derive(Debug, Clone, Deserialize)]
pub struct NdiConfig {
    #[serde(default = "default_ndi_resolution")]
    pub resolution: String,
    #[serde(default = "default_fps")]
    pub fps: u32,
    #[serde(default = "default_true", alias = "alphaEnabled")]
    pub alpha_enabled: bool,
}

fn default_ndi_resolution() -> String {
    "1080p".into()
}
