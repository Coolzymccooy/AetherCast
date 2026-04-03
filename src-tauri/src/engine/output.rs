use std::path::PathBuf;

use super::state::{GPUStreamConfig, StreamDestination};

pub const DEFAULT_ARCHIVE_SEGMENT_SECONDS: u32 = 300;
pub const DEFAULT_FIFO_QUEUE_SIZE: i32 = 180;

#[derive(Debug, Clone)]
pub struct OutputSessionPlan {
    pub name: String,
    pub protocol: String,
    pub muxer: String,
    pub target: String,
    pub tee_spec: String,
    pub recovery_delay_ms: u64,
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
    let (muxer, target) = match protocol {
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

    if target.trim().is_empty() {
        return Err("Enabled destination is missing a target URL".into());
    }

    let name = if destination.name.trim().is_empty() {
        sanitize_target(&target)
    } else {
        destination.name.trim().to_string()
    };

    Ok(OutputSessionPlan {
        name,
        protocol: protocol.to_string(),
        muxer: muxer.clone(),
        target: sanitize_target(&target),
        tee_spec: format!("[f={}:onfail=ignore]{}", muxer, target),
        recovery_delay_ms: protocol_recovery_delay_ms(protocol),
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
