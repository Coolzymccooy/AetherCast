use std::time::{SystemTime, UNIX_EPOCH};

use super::output::OutputManagerPlan;
use super::state::{ArchiveStatus, EngineHealthState, OutputStatus};

pub fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

pub fn build_output_statuses(plan: &OutputManagerPlan) -> Vec<OutputStatus> {
    plan.outputs.iter().map(build_output_status).collect()
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

fn build_output_status(output: &super::output::OutputSessionPlan) -> OutputStatus {
    OutputStatus {
        name: output.name.clone(),
        protocol: output.protocol.clone(),
        muxer: output.muxer.clone(),
        target: output.target.clone(),
        recovery_delay_ms: output.recovery_delay_ms,
        state: EngineHealthState::Starting,
        last_error: None,
        last_update_ms: now_ms(),
    }
}
