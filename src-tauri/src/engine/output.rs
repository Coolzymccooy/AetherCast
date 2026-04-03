use std::path::PathBuf;

use super::state::{
    ArchiveStatus, EngineHealthState, GPUStreamConfig, OutputStatus, StreamDestination,
};

pub const DEFAULT_ARCHIVE_SEGMENT_SECONDS: u32 = 300;
#[allow(dead_code)]
pub const DEFAULT_FIFO_QUEUE_SIZE: i32 = 180;

#[derive(Debug, Clone)]
pub struct OutputSessionPlan {
    pub worker_id: String,
    pub name: String,
    pub protocol: String,
    pub muxer: String,
    pub target: String,
    pub ffmpeg_target: String,
    pub recovery_delay_ms: u64,
}

#[derive(Debug, Clone)]
pub struct ArchiveSessionPlan {
    pub worker_id: String,
    pub path_pattern: String,
    pub segment_seconds: u32,
    pub recovery_delay_ms: u64,
}

#[derive(Debug, Clone)]
pub struct OutputManagerPlan {
    pub outputs: Vec<OutputSessionPlan>,
    pub archive: Option<ArchiveSessionPlan>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum OutputWorkerKind {
    Destination,
    Archive,
}

#[derive(Debug, Clone)]
pub struct OutputWorkerPlan {
    pub worker_id: String,
    pub name: String,
    pub protocol: String,
    pub muxer: String,
    pub target: String,
    pub ffmpeg_target: String,
    pub recovery_delay_ms: u64,
    pub kind: OutputWorkerKind,
}

impl OutputManagerPlan {
    pub fn destination_count(&self) -> usize {
        self.outputs.len()
    }

    pub fn archive_path_pattern(&self) -> Option<&str> {
        self.archive
            .as_ref()
            .map(|archive| archive.path_pattern.as_str())
    }

    pub fn archive_segment_seconds(&self) -> u32 {
        self.archive
            .as_ref()
            .map(|archive| archive.segment_seconds)
            .unwrap_or(DEFAULT_ARCHIVE_SEGMENT_SECONDS)
    }

    pub fn worker_plans(&self) -> Vec<OutputWorkerPlan> {
        let mut workers: Vec<OutputWorkerPlan> = self
            .outputs
            .iter()
            .map(|output| OutputWorkerPlan {
                worker_id: output.worker_id.clone(),
                name: output.name.clone(),
                protocol: output.protocol.clone(),
                muxer: output.muxer.clone(),
                target: output.target.clone(),
                ffmpeg_target: output.ffmpeg_target.clone(),
                recovery_delay_ms: output.recovery_delay_ms,
                kind: OutputWorkerKind::Destination,
            })
            .collect();

        if let Some(archive) = &self.archive {
            workers.push(OutputWorkerPlan {
                worker_id: archive.worker_id.clone(),
                name: "Local Archive".into(),
                protocol: "archive".into(),
                muxer: "segment".into(),
                target: archive.path_pattern.clone(),
                ffmpeg_target: archive.path_pattern.clone(),
                recovery_delay_ms: archive.recovery_delay_ms,
                kind: OutputWorkerKind::Archive,
            });
        }

        workers
    }
}

pub fn build_archive_pattern(session_id: u64) -> Result<String, String> {
    let root = archive_root_dir();
    std::fs::create_dir_all(&root).map_err(|e| {
        format!(
            "Failed to create archive directory {}: {}",
            root.display(),
            e
        )
    })?;

    let pattern = root.join(format!(
        "aethercast-session-{}-%Y%m%d-%H%M%S.mkv",
        session_id
    ));
    Ok(pattern.to_string_lossy().replace('\\', "/"))
}

pub fn build_output_manager_plan(
    config: &GPUStreamConfig,
    archive_path_pattern: Option<&str>,
) -> Result<OutputManagerPlan, String> {
    let outputs = config
        .destinations
        .iter()
        .filter(|destination| destination.enabled)
        .map(build_output_session)
        .collect::<Result<Vec<_>, _>>()?;

    if outputs.is_empty() {
        return Err("No enabled destinations".into());
    }

    let archive = archive_path_pattern.map(build_archive_session);

    Ok(OutputManagerPlan { outputs, archive })
}

pub fn append_worker_output_args(args: &mut Vec<String>, worker: &OutputWorkerPlan) {
    match worker.kind {
        OutputWorkerKind::Destination => {
            args.extend([
                "-f".into(),
                worker.muxer.clone(),
                worker.ffmpeg_target.clone(),
            ]);
        }
        OutputWorkerKind::Archive => {
            args.extend([
                "-f".into(),
                "segment".into(),
                "-segment_format".into(),
                "matroska".into(),
                "-segment_time".into(),
                DEFAULT_ARCHIVE_SEGMENT_SECONDS.to_string(),
                "-reset_timestamps".into(),
                "1".into(),
                "-strftime".into(),
                "1".into(),
                worker.ffmpeg_target.clone(),
            ]);
        }
    }
}

#[allow(dead_code)]
pub fn append_output_args(args: &mut Vec<String>, plan: &OutputManagerPlan) {
    let mut tee_targets: Vec<String> = plan
        .outputs
        .iter()
        .map(|output| format!("[f={}:onfail=ignore]{}", output.muxer, output.ffmpeg_target))
        .collect();

    if let Some(archive) = &plan.archive {
        tee_targets.push(format!(
            "[f=segment:onfail=ignore:segment_format=matroska:segment_time={}:reset_timestamps=1:strftime=1]{}",
            archive.segment_seconds, archive.path_pattern
        ));
    }

    let fifo_options = format!(
        "attempt_recovery=1:recover_any_error=1:drop_pkts_on_overflow=1:queue_size={}:max_recovery_attempts=0:recovery_wait_time=1:restart_with_keyframe=1",
        DEFAULT_FIFO_QUEUE_SIZE
    );

    args.extend([
        "-f".into(),
        "tee".into(),
        "-use_fifo".into(),
        "1".into(),
        "-fifo_options".into(),
        fifo_options,
        tee_targets.join("|"),
    ]);
}

pub fn build_output_statuses(plan: &OutputManagerPlan) -> Vec<OutputStatus> {
    plan.outputs.iter().map(build_output_status).collect()
}

pub fn set_output_states(
    outputs: &mut [OutputStatus],
    next: EngineHealthState,
    error: Option<String>,
) {
    let indexes: Vec<usize> = (0..outputs.len()).collect();
    set_output_states_for_indexes(outputs, &indexes, next, error);
}

pub fn set_output_state_by_worker_id(
    outputs: &mut [OutputStatus],
    worker_id: &str,
    next: EngineHealthState,
    error: Option<String>,
) {
    if let Some(index) = outputs
        .iter()
        .position(|output| output.worker_id == worker_id)
    {
        set_output_states_for_indexes(outputs, &[index], next, error);
    }
}

pub fn apply_output_runtime_signal(
    worker_id: &str,
    kind: OutputWorkerKind,
    line: &str,
    outputs: &mut [OutputStatus],
    archive: &mut ArchiveStatus,
) {
    let lowered = line.to_ascii_lowercase();
    let line_message = Some(line.to_string());

    let next = if lowered.contains("reconnect")
        || lowered.contains("timed out")
        || lowered.contains("broken pipe")
        || lowered.contains("connection reset")
    {
        Some(EngineHealthState::Recovering)
    } else if lowered.contains("error")
        || lowered.contains("failed")
        || lowered.contains("invalid")
        || lowered.contains("denied")
    {
        Some(EngineHealthState::Error)
    } else if lowered.contains("warning") || lowered.contains("drop") {
        Some(EngineHealthState::Degraded)
    } else {
        None
    };

    let Some(next) = next else {
        return;
    };

    match kind {
        OutputWorkerKind::Destination => {
            set_output_state_by_worker_id(outputs, worker_id, next, line_message);
        }
        OutputWorkerKind::Archive => {
            archive.state = next;
            archive.last_error = line_message;
            archive.last_update_ms = now_ms();
        }
    }
}

fn archive_root_dir() -> PathBuf {
    if cfg!(target_os = "windows") {
        if let Some(profile) = std::env::var_os("USERPROFILE") {
            return PathBuf::from(profile)
                .join("Videos")
                .join("AetherCast")
                .join("Archive");
        }
    }

    if cfg!(target_os = "macos") {
        if let Some(home) = std::env::var_os("HOME") {
            return PathBuf::from(home)
                .join("Movies")
                .join("AetherCast")
                .join("Archive");
        }
    }

    if let Some(home) = std::env::var_os("HOME") {
        return PathBuf::from(home)
            .join("Videos")
            .join("AetherCast")
            .join("Archive");
    }

    std::env::current_dir()
        .unwrap_or_else(|_| std::env::temp_dir())
        .join("aether-archive")
}

fn build_output_session(destination: &StreamDestination) -> Result<OutputSessionPlan, String> {
    let url = resolved_destination_url(destination);
    let protocol = resolved_protocol(destination, &url);
    let (muxer, resolved_target) = match protocol {
        "srt" => {
            let sep = if url.contains('?') { "&" } else { "?" };
            (
                "mpegts".to_string(),
                format!("{}{}mode=caller&latency=200000", url, sep),
            )
        }
        "rist" => ("mpegts".to_string(), url),
        _ => {
            let target = if !destination.stream_key.is_empty() {
                format!("{}/{}", url.trim_end_matches('/'), destination.stream_key)
            } else {
                url
            };
            ("flv".to_string(), target)
        }
    };

    if resolved_target.trim().is_empty() {
        return Err("Enabled destination is missing a target URL".into());
    }

    let display_target = display_target(protocol, &resolved_target);
    let name = if destination.name.trim().is_empty() {
        display_target.clone()
    } else {
        destination.name.trim().to_string()
    };
    let worker_id = build_worker_id(protocol, &name);

    Ok(OutputSessionPlan {
        worker_id,
        name,
        protocol: protocol.to_string(),
        muxer,
        target: display_target,
        ffmpeg_target: resolved_target,
        recovery_delay_ms: protocol_recovery_delay_ms(protocol),
    })
}

fn build_archive_session(path_pattern: &str) -> ArchiveSessionPlan {
    ArchiveSessionPlan {
        worker_id: "archive:local".into(),
        path_pattern: path_pattern.to_string(),
        segment_seconds: DEFAULT_ARCHIVE_SEGMENT_SECONDS,
        recovery_delay_ms: 1_000,
    }
}

fn resolved_destination_url(destination: &StreamDestination) -> String {
    if let Some(rtmp_url) = destination.rtmp_url.as_deref() {
        if !rtmp_url.is_empty() {
            return rtmp_url.to_string();
        }
    }

    destination.url.clone()
}

fn resolved_protocol(destination: &StreamDestination, url: &str) -> &'static str {
    if destination.protocol.trim().is_empty() {
        infer_protocol(url)
    } else {
        match destination.protocol.trim().to_ascii_lowercase().as_str() {
            "srt" => "srt",
            "rist" => "rist",
            _ => "rtmp",
        }
    }
}

fn infer_protocol(url: &str) -> &'static str {
    if url.starts_with("srt://") {
        "srt"
    } else if url.starts_with("rist://") {
        "rist"
    } else {
        "rtmp"
    }
}

fn protocol_recovery_delay_ms(protocol: &str) -> u64 {
    match protocol {
        "srt" => 2_000,
        "rist" => 3_000,
        _ => 1_000,
    }
}

fn sanitize_target(target: &str) -> String {
    target
        .split('?')
        .next()
        .unwrap_or(target)
        .trim_end_matches('/')
        .to_string()
}

fn display_target(protocol: &str, resolved_target: &str) -> String {
    let sanitized = sanitize_target(resolved_target);
    if protocol == "rtmp" {
        if let Some((base, _)) = sanitized.rsplit_once('/') {
            return format!("{}/***", base);
        }
    }
    sanitized
}

fn build_worker_id(protocol: &str, name: &str) -> String {
    let normalized = name
        .chars()
        .map(|char| {
            if char.is_ascii_alphanumeric() {
                char.to_ascii_lowercase()
            } else {
                '-'
            }
        })
        .collect::<String>()
        .trim_matches('-')
        .to_string();
    format!("{}:{}", protocol, normalized)
}

fn build_output_status(output: &OutputSessionPlan) -> OutputStatus {
    OutputStatus {
        worker_id: output.worker_id.clone(),
        name: output.name.clone(),
        protocol: output.protocol.clone(),
        muxer: output.muxer.clone(),
        target: output.target.clone(),
        recovery_delay_ms: output.recovery_delay_ms,
        restart_count: 0,
        last_event: None,
        state: EngineHealthState::Starting,
        last_error: None,
        last_update_ms: now_ms(),
    }
}

fn set_output_states_for_indexes(
    outputs: &mut [OutputStatus],
    indexes: &[usize],
    next: EngineHealthState,
    error: Option<String>,
) {
    let update_at = now_ms();
    for index in indexes {
        let Some(output) = outputs.get_mut(*index) else {
            continue;
        };

        if next == EngineHealthState::Recovering && output.state != EngineHealthState::Recovering {
            output.restart_count += 1;
        }

        output.state = next.clone();
        output.last_event = error.clone();
        output.last_update_ms = update_at;
        output.last_error = match next {
            EngineHealthState::Error
            | EngineHealthState::Recovering
            | EngineHealthState::Degraded => error.clone(),
            _ => None,
        };
    }
}

fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}
