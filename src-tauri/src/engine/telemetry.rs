use std::time::{SystemTime, UNIX_EPOCH};

use super::state::{
    ArchiveStatus, EngineHealthState, GPUStreamConfig, OutputStatus, StreamDestination,
};

pub fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

pub fn build_output_statuses(config: &GPUStreamConfig) -> Vec<OutputStatus> {
    config
        .destinations
        .iter()
        .filter(|destination| destination.enabled)
        .map(build_output_status)
        .collect()
}

pub fn build_archive_status(
    path_pattern: Option<String>,
    segment_seconds: u32,
    state: EngineHealthState,
) -> ArchiveStatus {
    ArchiveStatus {
        state,
        path_pattern,
        segment_seconds,
        last_error: None,
        last_update_ms: now_ms(),
    }
}

pub fn set_output_states(
    outputs: &mut [OutputStatus],
    next: EngineHealthState,
    error: Option<String>,
) {
    let update_at = now_ms();
    for output in outputs.iter_mut() {
        output.state = next.clone();
        output.last_update_ms = update_at;
        output.last_error = error.clone();
    }
}

pub fn set_archive_state(
    archive: &mut ArchiveStatus,
    next: EngineHealthState,
    error: Option<String>,
) {
    archive.state = next;
    archive.last_error = error;
    archive.last_update_ms = now_ms();
}

pub fn apply_ffmpeg_signal(line: &str, outputs: &mut [OutputStatus], archive: &mut ArchiveStatus) {
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
        set_archive_state(archive, next, line_message);
        return;
    }

    if lowered.contains("reconnect")
        || lowered.contains("timed out")
        || lowered.contains("broken pipe")
        || lowered.contains("connection reset")
    {
        set_output_states(outputs, EngineHealthState::Recovering, line_message);
        return;
    }

    if lowered.contains("error")
        || lowered.contains("failed")
        || lowered.contains("invalid")
        || lowered.contains("denied")
    {
        set_output_states(outputs, EngineHealthState::Error, line_message);
        return;
    }

    if lowered.contains("warning") || lowered.contains("drop") {
        set_output_states(outputs, EngineHealthState::Degraded, line_message);
    }
}

fn build_output_status(destination: &StreamDestination) -> OutputStatus {
    let url = destination
        .rtmp_url
        .as_deref()
        .filter(|value| !value.is_empty())
        .unwrap_or(destination.url.as_str());
    let target = url
        .split('?')
        .next()
        .unwrap_or(url)
        .trim_end_matches('/')
        .to_string();

    OutputStatus {
        name: if destination.name.trim().is_empty() {
            target.clone()
        } else {
            destination.name.trim().to_string()
        },
        protocol: if destination.protocol.trim().is_empty() {
            infer_protocol(url).to_string()
        } else {
            destination.protocol.trim().to_string()
        },
        target,
        state: EngineHealthState::Starting,
        last_error: None,
        last_update_ms: now_ms(),
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
