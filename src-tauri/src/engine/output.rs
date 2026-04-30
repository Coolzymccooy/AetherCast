use std::{
    collections::{HashMap, HashSet},
    path::PathBuf,
};

use super::state::{
    ArchiveStatus, EngineHealthState, GPUStreamConfig, OutputStatus, StreamDestination,
};

pub const DEFAULT_ARCHIVE_SEGMENT_SECONDS: u32 = 300;
#[allow(dead_code)]
pub const DEFAULT_FIFO_QUEUE_SIZE: i32 = 180;
const OUTPUT_DEGRADE_AFTER_MS: u64 = 10_000;
const OUTPUT_MIN_REALTIME_SPEED: f32 = 0.95;
const OUTPUT_MIN_FPS_RATIO: f32 = 0.95;
const TWITCH_LEGACY_HOST: &str = "live.twitch.tv";
const TWITCH_INGEST_HOST: &str = "ingest.global-contribute.live-video.net";

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
    let mut outputs = Vec::new();
    let mut seen_targets = HashSet::new();
    let mut worker_id_counts = HashMap::new();

    for destination in config
        .destinations
        .iter()
        .filter(|destination| destination.enabled)
    {
        let output = build_output_session(destination, &mut worker_id_counts)?;
        let target_key = format!("{}|{}", output.protocol, output.ffmpeg_target);
        if !seen_targets.insert(target_key) {
            return Err(format!(
                "Multiple enabled destinations resolve to the same output target: {}",
                output.target
            ));
        }
        outputs.push(output);
    }

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
    if plan.outputs.len() == 1 && plan.archive.is_none() {
        let output = &plan.outputs[0];
        args.extend([
            "-f".into(),
            output.muxer.clone(),
            output.ffmpeg_target.clone(),
        ]);
        return;
    }

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

pub fn build_output_statuses(
    plan: &OutputManagerPlan,
    config: &GPUStreamConfig,
) -> Vec<OutputStatus> {
    plan.outputs
        .iter()
        .map(|output| build_output_status(output, config))
        .collect()
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

pub fn set_output_recovery_delay_by_worker_id(
    outputs: &mut [OutputStatus],
    worker_id: &str,
    recovery_delay_ms: u64,
) {
    if let Some(output) = outputs
        .iter_mut()
        .find(|output| output.worker_id == worker_id)
    {
        output.recovery_delay_ms = recovery_delay_ms;
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
    match kind {
        OutputWorkerKind::Destination => {
            apply_destination_runtime_signal(worker_id, line, &lowered, outputs);
        }
        OutputWorkerKind::Archive => {
            let next = if lowered.contains("frame=")
                || lowered.contains("fps=")
                || lowered.contains("bitrate=")
                || lowered.contains("speed=")
            {
                archive.last_update_ms = now_ms();
                Some(EngineHealthState::Active)
            } else if lowered.contains("reconnect")
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

            let was_recovering = archive.state == EngineHealthState::Recovering;
            archive.state = next;
            archive.last_event = Some(line.to_string());
            archive.last_error = match archive.state {
                EngineHealthState::Error
                | EngineHealthState::Recovering
                | EngineHealthState::Degraded => Some(line.to_string()),
                _ => None,
            };
            archive.last_update_ms = now_ms();
            if archive.state == EngineHealthState::Recovering && !was_recovering {
                archive.restart_count += 1;
            }
        }
    }
}

#[derive(Debug, Clone, Copy, Default, PartialEq)]
struct OutputProgressMetrics {
    measured_fps: Option<f32>,
    measured_bitrate_kbps: Option<f32>,
    encoder_speed: Option<f32>,
}

fn parse_progress_metric(line: &str, key: &str) -> Option<f32> {
    let index = line.to_ascii_lowercase().rfind(&key.to_ascii_lowercase())?;
    let mut cursor = index + key.len();
    let bytes = line.as_bytes();

    while cursor < bytes.len() && bytes[cursor].is_ascii_whitespace() {
        cursor += 1;
    }

    let start = cursor;
    while cursor < bytes.len() && (bytes[cursor].is_ascii_digit() || bytes[cursor] == b'.') {
        cursor += 1;
    }

    if start == cursor {
        return None;
    }

    line[start..cursor].parse::<f32>().ok()
}

fn parse_output_progress_metrics(line: &str) -> OutputProgressMetrics {
    OutputProgressMetrics {
        measured_fps: parse_progress_metric(line, "fps="),
        measured_bitrate_kbps: parse_progress_metric(line, "bitrate="),
        encoder_speed: parse_progress_metric(line, "speed="),
    }
}

fn format_degraded_message(output: &OutputStatus, metrics: OutputProgressMetrics) -> String {
    let speed = metrics
        .encoder_speed
        .or(output.encoder_speed)
        .unwrap_or_default();
    let measured_fps = metrics
        .measured_fps
        .or(output.measured_fps)
        .unwrap_or_default();
    let target_fps = output.target_fps.unwrap_or_default();
    let width = output.target_width.unwrap_or_default();
    let height = output.target_height.unwrap_or_default();
    let bitrate = metrics
        .measured_bitrate_kbps
        .or(output.measured_bitrate_kbps)
        .unwrap_or(output.target_bitrate_kbps.unwrap_or_default() as f32);

    format!(
        "Output below real-time for 10s: {speed:.2}x encoder speed, {measured_fps:.1}/{target_fps} fps, {bitrate:.1} kbps at {width}x{height}"
    )
}

fn apply_destination_runtime_signal(
    worker_id: &str,
    line: &str,
    lowered: &str,
    outputs: &mut [OutputStatus],
) {
    let Some(index) = outputs
        .iter()
        .position(|output| output.worker_id == worker_id)
    else {
        return;
    };

    let mut next: Option<(EngineHealthState, Option<String>)> = None;
    let now = now_ms();
    let metrics = parse_output_progress_metrics(line);

    {
        let output = &mut outputs[index];

        if metrics.measured_fps.is_some() {
            output.measured_fps = metrics.measured_fps;
        }
        if metrics.measured_bitrate_kbps.is_some() {
            output.measured_bitrate_kbps = metrics.measured_bitrate_kbps;
        }
        if metrics.encoder_speed.is_some() {
            output.encoder_speed = metrics.encoder_speed;
        }

        let has_progress_metrics = metrics.measured_fps.is_some()
            || metrics.measured_bitrate_kbps.is_some()
            || metrics.encoder_speed.is_some();

        if has_progress_metrics {
            output.first_progress_ms.get_or_insert(now);
            output.last_progress_ms = Some(now);
            let target_fps = output.target_fps.unwrap_or_default() as f32;
            let low_speed = metrics
                .encoder_speed
                .map(|speed| speed < OUTPUT_MIN_REALTIME_SPEED)
                .unwrap_or(false);
            let low_fps = metrics
                .measured_fps
                .map(|fps| target_fps > 0.0 && fps < target_fps * OUTPUT_MIN_FPS_RATIO)
                .unwrap_or(false);

            if low_speed || low_fps {
                let warning_since = output.performance_warning_since_ms.get_or_insert(now);
                if now.saturating_sub(*warning_since) >= OUTPUT_DEGRADE_AFTER_MS
                    && output.state != EngineHealthState::Degraded
                {
                    next = Some((
                        EngineHealthState::Degraded,
                        Some(format_degraded_message(output, metrics)),
                    ));
                }
            } else {
                output.performance_warning_since_ms = None;
                next = Some((EngineHealthState::Active, Some(line.to_string())));
            }

            if next.is_none() && output.state != EngineHealthState::Degraded {
                next = Some((EngineHealthState::Active, Some(line.to_string())));
            }
        } else {
            output.performance_warning_since_ms = None;
            next = if lowered.contains("reconnect")
                || lowered.contains("timed out")
                || lowered.contains("broken pipe")
                || lowered.contains("connection reset")
            {
                Some((EngineHealthState::Recovering, Some(line.to_string())))
            } else if lowered.contains("error")
                || lowered.contains("failed")
                || lowered.contains("invalid")
                || lowered.contains("denied")
            {
                Some((EngineHealthState::Error, Some(line.to_string())))
            } else if lowered.contains("warning") || lowered.contains("drop") {
                Some((EngineHealthState::Degraded, Some(line.to_string())))
            } else {
                None
            };
        }
    }

    if let Some((state, message)) = next {
        set_output_states_for_indexes(outputs, &[index], state, message);
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

fn build_output_session(
    destination: &StreamDestination,
    worker_id_counts: &mut HashMap<String, usize>,
) -> Result<OutputSessionPlan, String> {
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
            let stream_key = normalized_stream_key(&destination.stream_key);
            let target = if !stream_key.is_empty() {
                format!("{}/{}", url.trim_end_matches('/'), stream_key)
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
    let worker_id = build_worker_id(protocol, &name, worker_id_counts);

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
            return normalize_destination_url(rtmp_url);
        }
    }

    normalize_destination_url(&destination.url)
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

fn normalize_destination_url(url: &str) -> String {
    let trimmed = url.trim().trim_end_matches('/');
    if let Some((scheme, remainder)) = trimmed.split_once("://") {
        if let Some((host_port, path)) = remainder.split_once('/') {
            let host_port_lower = host_port.to_ascii_lowercase();
            let is_legacy_twitch_host = host_port_lower == TWITCH_LEGACY_HOST
                || host_port_lower.starts_with(&format!("{TWITCH_LEGACY_HOST}:"));
            let is_legacy_twitch_path =
                path.eq_ignore_ascii_case("live") || path.eq_ignore_ascii_case("app");

            if is_legacy_twitch_host && is_legacy_twitch_path {
                let port_suffix = host_port
                    .strip_prefix(TWITCH_LEGACY_HOST)
                    .unwrap_or_default();
                return format!("{scheme}://{TWITCH_INGEST_HOST}{port_suffix}/app");
            }
        }
    }
    trimmed.to_string()
}

fn normalized_stream_key(stream_key: &str) -> String {
    let trimmed = stream_key.trim();
    if trimmed.len() >= 4 && trimmed[..4].eq_ignore_ascii_case("key=") {
        trimmed[4..].to_string()
    } else {
        trimmed.to_string()
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

fn normalized_worker_component(name: &str) -> String {
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

    if normalized.is_empty() {
        "destination".into()
    } else {
        normalized
    }
}

fn build_worker_id(
    protocol: &str,
    name: &str,
    worker_id_counts: &mut HashMap<String, usize>,
) -> String {
    let normalized = normalized_worker_component(name);
    let worker_key = format!("{}:{}", protocol, normalized);
    let sequence = worker_id_counts
        .entry(worker_key.clone())
        .and_modify(|count| *count += 1)
        .or_insert(1);

    if *sequence == 1 {
        worker_key
    } else {
        format!("{}-{}", worker_key, *sequence)
    }
}

fn build_output_status(output: &OutputSessionPlan, config: &GPUStreamConfig) -> OutputStatus {
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
        target_width: Some(config.width),
        target_height: Some(config.height),
        target_fps: Some(config.fps),
        target_bitrate_kbps: Some(config.bitrate),
        measured_fps: None,
        measured_bitrate_kbps: None,
        encoder_speed: None,
        first_progress_ms: None,
        last_progress_ms: None,
        performance_warning_since_ms: None,
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

#[cfg(test)]
mod tests {
    use super::*;

    fn enabled_rtmp_destination(name: &str, url: &str, stream_key: &str) -> StreamDestination {
        StreamDestination {
            url: url.into(),
            stream_key: stream_key.into(),
            protocol: "rtmp".into(),
            name: name.into(),
            enabled: true,
            rtmp_url: None,
        }
    }

    fn sample_config(destinations: Vec<StreamDestination>) -> GPUStreamConfig {
        GPUStreamConfig {
            destinations,
            width: 1280,
            height: 720,
            fps: 30,
            bitrate: 4500,
            encoder: "libx264".into(),
            mode: "raw".into(),
            audio_mode: "auto".into(),
            audio_device: String::new(),
            audio_sample_rate: 48_000,
            audio_channels: 2,
            audio_bitrate: 160,
            include_microphone: true,
            include_system_audio: true,
            audio_buses: Vec::new(),
            native_video_sources: Vec::new(),
        }
    }

    #[test]
    fn output_plan_assigns_unique_worker_ids_for_similar_destinations() {
        let config = sample_config(vec![
            enabled_rtmp_destination("", "rtmps://a.rtmp.youtube.com:443/live2", "stream-key-a"),
            enabled_rtmp_destination("", "rtmps://a.rtmp.youtube.com:443/live2", "stream-key-b"),
        ]);

        let plan = build_output_manager_plan(&config, None).expect("plan should build");

        assert_eq!(plan.outputs.len(), 2);
        assert_ne!(plan.outputs[0].worker_id, plan.outputs[1].worker_id);
        assert_eq!(
            plan.outputs[0].target,
            "rtmps://a.rtmp.youtube.com:443/live2/***"
        );
        assert_eq!(
            plan.outputs[1].target,
            "rtmps://a.rtmp.youtube.com:443/live2/***"
        );
    }

    #[test]
    fn output_plan_rejects_duplicate_enabled_targets() {
        let config = sample_config(vec![
            enabled_rtmp_destination(
                "YouTube A",
                "rtmps://a.rtmp.youtube.com:443/live2",
                "same-key",
            ),
            enabled_rtmp_destination(
                "YouTube B",
                "rtmps://a.rtmp.youtube.com:443/live2",
                "same-key",
            ),
        ]);

        let error = build_output_manager_plan(&config, None).expect_err("duplicate target");

        assert!(
            error.contains("same output target"),
            "unexpected error: {error}"
        );
    }

    #[test]
    fn output_plan_normalizes_twitch_legacy_ingest() {
        let config = sample_config(vec![enabled_rtmp_destination(
            "Twitch",
            "rtmps://live.twitch.tv/app",
            "abc123",
        )]);

        let plan = build_output_manager_plan(&config, None).expect("plan should build");

        assert_eq!(
            plan.outputs[0].ffmpeg_target,
            "rtmps://ingest.global-contribute.live-video.net/app/abc123"
        );
    }

    #[test]
    fn output_plan_keeps_archive_enabled_for_twitch_destinations() {
        let config = sample_config(vec![enabled_rtmp_destination(
            "Twitch",
            "rtmps://live.twitch.tv/app",
            "abc123",
        )]);
        let archive_pattern = "C:/captures/aethercast-session-%Y%m%d-%H%M%S.mkv";

        let plan =
            build_output_manager_plan(&config, Some(archive_pattern)).expect("plan should build");

        assert_eq!(plan.outputs.len(), 1);
        assert_eq!(
            plan.archive
                .as_ref()
                .map(|archive| archive.path_pattern.as_str()),
            Some(archive_pattern)
        );
    }

    #[test]
    fn parse_output_progress_metrics_extracts_runtime_fields() {
        let metrics = parse_output_progress_metrics(
            "frame= 2720 fps= 17 q=-0.0 size=   51474KiB time=00:01:30.66 bitrate=4650.8kbits/s speed=0.565x elapsed=0:02:40.49",
        );

        assert_eq!(
            metrics,
            OutputProgressMetrics {
                measured_fps: Some(17.0),
                measured_bitrate_kbps: Some(4650.8),
                encoder_speed: Some(0.565),
            }
        );
    }

    #[test]
    fn destination_progress_marks_output_degraded_after_sustained_low_realtime() {
        let config = sample_config(vec![enabled_rtmp_destination(
            "Twitch",
            "rtmps://live.twitch.tv/app",
            "abc123",
        )]);
        let plan = build_output_manager_plan(&config, None).expect("plan should build");
        let mut outputs = build_output_statuses(&plan, &config);
        let worker_id = outputs[0].worker_id.clone();
        outputs[0].performance_warning_since_ms = Some(now_ms() - OUTPUT_DEGRADE_AFTER_MS - 1);
        let mut archive = ArchiveStatus {
            state: EngineHealthState::Inactive,
            path_pattern: None,
            segment_seconds: DEFAULT_ARCHIVE_SEGMENT_SECONDS,
            recovery_delay_ms: 0,
            restart_count: 0,
            last_event: None,
            last_error: None,
            last_update_ms: 0,
        };

        apply_output_runtime_signal(
            &worker_id,
            OutputWorkerKind::Destination,
            "frame= 2720 fps= 17 q=-0.0 size=   51474KiB time=00:01:30.66 bitrate=4650.8kbits/s speed=0.565x elapsed=0:02:40.49",
            &mut outputs,
            &mut archive,
        );

        assert_eq!(outputs[0].state, EngineHealthState::Degraded);
        assert_eq!(outputs[0].measured_fps, Some(17.0));
        assert_eq!(outputs[0].measured_bitrate_kbps, Some(4650.8));
        assert_eq!(outputs[0].encoder_speed, Some(0.565));
        assert!(outputs[0].first_progress_ms.is_some());
        assert!(outputs[0].last_progress_ms.is_some());
        assert!(
            outputs[0]
                .last_error
                .as_deref()
                .unwrap_or_default()
                .contains("Output below real-time"),
            "unexpected error message: {:?}",
            outputs[0].last_error
        );
    }

    #[test]
    fn archive_runtime_signal_tracks_event_and_recovery_state() {
        let mut archive = ArchiveStatus {
            state: EngineHealthState::Starting,
            path_pattern: Some("C:/captures/archive-%Y%m%d-%H%M%S.mkv".into()),
            segment_seconds: DEFAULT_ARCHIVE_SEGMENT_SECONDS,
            recovery_delay_ms: 1000,
            restart_count: 0,
            last_event: None,
            last_error: None,
            last_update_ms: 0,
        };

        apply_output_runtime_signal(
            "archive",
            OutputWorkerKind::Archive,
            "frame= 2720 fps= 29 q=-0.0 size=   51474KiB time=00:01:30.66 bitrate=4650.8kbits/s speed=0.998x",
            &mut [],
            &mut archive,
        );

        assert_eq!(archive.state, EngineHealthState::Active);
        assert!(archive.last_error.is_none());
        assert!(archive
            .last_event
            .as_deref()
            .unwrap_or_default()
            .contains("frame="));

        apply_output_runtime_signal(
            "archive",
            OutputWorkerKind::Archive,
            "Broken pipe",
            &mut [],
            &mut archive,
        );

        assert_eq!(archive.state, EngineHealthState::Recovering);
        assert_eq!(archive.restart_count, 1);
        assert!(archive
            .last_error
            .as_deref()
            .unwrap_or_default()
            .contains("Broken pipe"));
    }
}
