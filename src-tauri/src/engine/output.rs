use std::path::PathBuf;

use super::state::{
    ArchiveStatus, EngineHealthState, GPUStreamConfig, OutputStatus, StreamDestination,
};

pub const DEFAULT_ARCHIVE_SEGMENT_SECONDS: u32 = 300;
pub const DEFAULT_FIFO_QUEUE_SIZE: i32 = 180;

#[derive(Debug, Clone)]
pub struct OutputSessionPlan {
    pub worker_id: String,
    pub name: String,
    pub protocol: String,
    pub muxer: String,
    pub target: String,
    pub tee_spec: String,
    pub recovery_delay_ms: u64,
    pub match_tokens: Vec<String>,
}

#[derive(Debug, Clone)]
pub struct ArchiveSessionPlan {
    pub path_pattern: String,
    pub segment_seconds: u32,
    pub tee_spec: String,
}

#[derive(Debug, Clone)]
pub struct OutputManagerPlan {
    pub outputs: Vec<OutputSessionPlan>,
    pub archive: Option<ArchiveSessionPlan>,
    pub fifo_options: String,
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

    pub fn tee_targets(&self) -> Vec<String> {
        let mut tee_targets: Vec<String> = self
            .outputs
            .iter()
            .map(|output| output.tee_spec.clone())
            .collect();

        if let Some(archive) = &self.archive {
            tee_targets.push(archive.tee_spec.clone());
        }

        tee_targets
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

    Ok(OutputManagerPlan {
        outputs,
        archive,
        fifo_options: build_fifo_options(DEFAULT_FIFO_QUEUE_SIZE),
    })
}

pub fn append_output_args(args: &mut Vec<String>, plan: &OutputManagerPlan) {
    args.extend([
        "-f".into(),
        "tee".into(),
        "-use_fifo".into(),
        "1".into(),
        "-fifo_options".into(),
        plan.fifo_options.clone(),
        plan.tee_targets().join("|"),
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

pub fn apply_output_runtime_signal(
    line: &str,
    outputs: &mut [OutputStatus],
    archive: &mut ArchiveStatus,
) {
    let lowered = line.to_ascii_lowercase();
    let line_message = Some(line.to_string());

    if lowered.contains("segment")
        || lowered.contains("matroska")
        || lowered.contains("archive")
        || lowered.contains("muxer")
    {
        let next = if lowered.contains("error") || lowered.contains("failed") {
            EngineHealthState::Error
        } else {
            EngineHealthState::Degraded
        };
        archive.state = next;
        archive.last_error = line_message;
        archive.last_update_ms = now_ms();
        return;
    }

    let matched_indexes = match_output_indexes(outputs, &lowered);
    let target_indexes = if matched_indexes.is_empty() {
        (0..outputs.len()).collect::<Vec<_>>()
    } else {
        matched_indexes
    };

    if lowered.contains("reconnect")
        || lowered.contains("timed out")
        || lowered.contains("broken pipe")
        || lowered.contains("connection reset")
    {
        set_output_states_for_indexes(
            outputs,
            &target_indexes,
            EngineHealthState::Recovering,
            line_message,
        );
        return;
    }

    if lowered.contains("error")
        || lowered.contains("failed")
        || lowered.contains("invalid")
        || lowered.contains("denied")
    {
        set_output_states_for_indexes(
            outputs,
            &target_indexes,
            EngineHealthState::Error,
            line_message,
        );
        return;
    }

    if lowered.contains("warning") || lowered.contains("drop") {
        set_output_states_for_indexes(
            outputs,
            &target_indexes,
            EngineHealthState::Degraded,
            line_message,
        );
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
    let match_tokens = build_match_tokens(&name, protocol, &resolved_target);

    Ok(OutputSessionPlan {
        worker_id,
        name,
        protocol: protocol.to_string(),
        muxer: muxer.clone(),
        target: display_target,
        tee_spec: format!("[f={}:onfail=ignore]{}", muxer, resolved_target),
        recovery_delay_ms: protocol_recovery_delay_ms(protocol),
        match_tokens,
    })
}

fn build_archive_session(path_pattern: &str) -> ArchiveSessionPlan {
    ArchiveSessionPlan {
        path_pattern: path_pattern.to_string(),
        segment_seconds: DEFAULT_ARCHIVE_SEGMENT_SECONDS,
        tee_spec: format!(
            "[f=segment:onfail=ignore:segment_format=matroska:segment_time={}:reset_timestamps=1:strftime=1]{}",
            DEFAULT_ARCHIVE_SEGMENT_SECONDS, path_pattern
        ),
    }
}

fn build_fifo_options(queue_size: i32) -> String {
    format!(
        "attempt_recovery=1:recover_any_error=1:drop_pkts_on_overflow=1:queue_size={}:max_recovery_attempts=0:recovery_wait_time=1:restart_with_keyframe=1",
        queue_size
    )
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

fn build_match_tokens(name: &str, protocol: &str, resolved_target: &str) -> Vec<String> {
    let sanitized = sanitize_target(resolved_target).to_ascii_lowercase();
    let host = extract_host_token(&sanitized);
    let tail = sanitized
        .split('/')
        .filter(|segment| !segment.is_empty())
        .next_back()
        .unwrap_or_default()
        .to_string();
    let name_token = name.trim().to_ascii_lowercase();

    let mut tokens = Vec::new();
    if !name_token.is_empty() && name_token.len() >= 4 {
        tokens.push(name_token);
    }
    if !host.is_empty() && host.len() >= 4 {
        tokens.push(host);
    }
    if protocol != "rtmp" && !tail.is_empty() && tail.len() >= 4 {
        tokens.push(tail);
    }
    tokens.sort();
    tokens.dedup();
    tokens
}

fn extract_host_token(target: &str) -> String {
    let without_scheme = target.split("://").nth(1).unwrap_or(target);
    without_scheme
        .split(['/', '?'])
        .next()
        .unwrap_or_default()
        .trim()
        .to_string()
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
        match_tokens: output.match_tokens.clone(),
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

fn match_output_indexes(outputs: &[OutputStatus], lowered_line: &str) -> Vec<usize> {
    outputs
        .iter()
        .enumerate()
        .filter_map(|(index, output)| {
            if output
                .match_tokens
                .iter()
                .any(|token| !token.is_empty() && lowered_line.contains(token))
            {
                Some(index)
            } else {
                None
            }
        })
        .collect()
}

fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}
