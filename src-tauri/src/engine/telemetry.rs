use std::time::{SystemTime, UNIX_EPOCH};

use super::state::{ArchiveStatus, EngineHealthState};

pub fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

pub fn build_archive_status(
    path_pattern: Option<String>,
    segment_seconds: u32,
    recovery_delay_ms: u64,
    state: EngineHealthState,
) -> ArchiveStatus {
    ArchiveStatus {
        state,
        path_pattern,
        segment_seconds,
        recovery_delay_ms,
        restart_count: 0,
        last_event: None,
        last_error: None,
        last_update_ms: now_ms(),
    }
}

pub fn set_archive_state(
    archive: &mut ArchiveStatus,
    next: EngineHealthState,
    error: Option<String>,
) {
    let was_recovering = archive.state == EngineHealthState::Recovering;
    archive.state = next.clone();
    archive.last_event = error.clone();
    archive.last_error = match next {
        EngineHealthState::Error | EngineHealthState::Recovering | EngineHealthState::Degraded => {
            error
        }
        _ => None,
    };
    archive.last_update_ms = now_ms();
    if next == EngineHealthState::Recovering && !was_recovering {
        archive.restart_count += 1;
    }
}
