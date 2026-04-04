use std::process::{Command, Stdio};

use super::state::{
    EngineHealthState, GPUStreamConfig, NativeAudioDiscovery, NativeAudioInput,
    NativeAudioSourceKind, NativeAudioStatus,
};
use super::telemetry::now_ms;

const DEFAULT_AUDIO_BUFFER_MS: u32 = 50;

#[derive(Debug, Clone)]
pub struct NativeAudioInputSpec {
    pub name: String,
    pub alternative_name: Option<String>,
    pub kind: NativeAudioSourceKind,
    pub backend: String,
}

#[derive(Debug, Clone)]
pub struct NativeAudioPlan {
    pub mode: String,
    pub backend: String,
    pub sample_rate: u32,
    pub channels: u32,
    pub bitrate_kbps: u32,
    pub inputs: Vec<NativeAudioInputSpec>,
    pub using_synthetic: bool,
    pub selection_note: Option<String>,
}

pub fn supports_dshow(ffmpeg_bin: &str) -> bool {
    Command::new(ffmpeg_bin)
        .args(["-hide_banner", "-devices"])
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .output()
        .map(|output| {
            let stdout = String::from_utf8_lossy(&output.stdout).to_ascii_lowercase();
            stdout.contains(" d  dshow") || stdout.contains(" d dshow")
        })
        .unwrap_or(false)
}

pub fn list_audio_devices(ffmpeg_bin: &str) -> Vec<NativeAudioInput> {
    if !supports_dshow(ffmpeg_bin) {
        return Vec::new();
    }

    let output = match Command::new(ffmpeg_bin)
        .args(["-hide_banner", "-list_devices", "true", "-f", "dshow", "-i", "dummy"])
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .output()
    {
        Ok(output) => output,
        Err(_) => return Vec::new(),
    };

    parse_dshow_audio_devices(&format!(
        "{}\n{}",
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr)
    ))
}

pub fn build_audio_plan(
    ffmpeg_bin: &str,
    config: &GPUStreamConfig,
    lavfi_enabled: bool,
) -> NativeAudioPlan {
    let sample_rate = config.audio_sample_rate.max(8_000);
    let channels = config.audio_channels.clamp(1, 2);
    let bitrate_kbps = config.audio_bitrate.max(64);
    let mode = normalize_audio_mode(&config.audio_mode);
    let devices = list_audio_devices(ffmpeg_bin);

    if mode == "silent" || (!config.include_microphone && !config.include_system_audio) {
        return fallback_silence_plan(
            mode,
            sample_rate,
            channels,
            bitrate_kbps,
            lavfi_enabled,
            Some("Native audio capture disabled by configuration".into()),
        );
    }

    let mut inputs: Vec<NativeAudioInputSpec> = Vec::new();
    let explicit = config.audio_device.trim();
    let mut selection_note: Option<String> = None;

    if mode == "device" && !explicit.is_empty() {
        match find_device_by_name(&devices, explicit) {
            Some(device) => inputs.push(to_audio_input_spec(device)),
            None => {
                selection_note = Some(format!(
                    "Requested audio device '{}' was not found, using fallback audio mode",
                    explicit
                ));
            }
        }
    }

    if inputs.is_empty() {
        let want_system = config.include_system_audio && matches!(mode, "auto" | "hybrid" | "system");
        let want_microphone =
            config.include_microphone && matches!(mode, "auto" | "hybrid" | "microphone");

        if want_system {
            if let Some(device) = select_preferred_device(&devices, DevicePreference::System, &inputs)
            {
                inputs.push(to_audio_input_spec(device));
            }
        }

        if want_microphone {
            if let Some(device) =
                select_preferred_device(&devices, DevicePreference::Microphone, &inputs)
            {
                inputs.push(to_audio_input_spec(device));
            }
        }

        if inputs.is_empty() && mode == "microphone" {
            if let Some(device) = select_preferred_device(&devices, DevicePreference::Any, &inputs) {
                inputs.push(to_audio_input_spec(device));
            }
        }

        if inputs.is_empty() && matches!(mode, "system" | "auto" | "hybrid") {
            if let Some(device) = select_preferred_device(&devices, DevicePreference::Any, &inputs) {
                inputs.push(to_audio_input_spec(device));
            }
        }
    }

    if inputs.is_empty() {
        return fallback_silence_plan(
            mode,
            sample_rate,
            channels,
            bitrate_kbps,
            lavfi_enabled,
            selection_note.or_else(|| {
                Some("No native DirectShow audio device was available, using synthetic audio".into())
            }),
        );
    }

    NativeAudioPlan {
        mode: mode.into(),
        backend: "dshow".into(),
        sample_rate,
        channels,
        bitrate_kbps,
        inputs,
        using_synthetic: false,
        selection_note,
    }
}

pub fn build_audio_status(plan: &NativeAudioPlan, state: EngineHealthState) -> NativeAudioStatus {
    NativeAudioStatus {
        state,
        mode: plan.mode.clone(),
        backend: plan.backend.clone(),
        input_count: plan.inputs.len() as u32,
        sample_rate: plan.sample_rate,
        channels: plan.channels,
        bitrate_kbps: plan.bitrate_kbps,
        source_summary: describe_audio_plan(plan),
        inputs: plan
            .inputs
            .iter()
            .map(|input| NativeAudioInput {
                name: input.name.clone(),
                alternative_name: input.alternative_name.clone(),
                kind: input.kind.clone(),
                backend: input.backend.clone(),
            })
            .collect(),
        using_synthetic: plan.using_synthetic,
        last_error: None,
        last_event: plan.selection_note.clone(),
        last_update_ms: now_ms(),
    }
}

pub fn detect_audio_engine(ffmpeg_bin: &str, lavfi_enabled: bool) -> NativeAudioDiscovery {
    let config = GPUStreamConfig {
        destinations: Vec::new(),
        width: 1920,
        height: 1080,
        fps: 30,
        bitrate: 6000,
        encoder: "auto".into(),
        mode: "jpeg".into(),
        audio_mode: "auto".into(),
        audio_device: String::new(),
        audio_sample_rate: 48_000,
        audio_channels: 2,
        audio_bitrate: 160,
        include_microphone: true,
        include_system_audio: true,
        native_video_sources: Vec::new(),
    };
    let devices = list_audio_devices(ffmpeg_bin);
    let suggested_plan = build_audio_plan(ffmpeg_bin, &config, lavfi_enabled);
    NativeAudioDiscovery {
        ffmpeg_path: ffmpeg_bin.into(),
        supports_dshow: supports_dshow(ffmpeg_bin),
        supports_lavfi: lavfi_enabled,
        devices,
        suggested_status: build_audio_status(&suggested_plan, EngineHealthState::Inactive),
    }
}

pub fn append_audio_input_args(args: &mut Vec<String>, plan: &NativeAudioPlan) {
    if plan.inputs.is_empty() {
        return;
    }

    if plan.using_synthetic {
        args.extend([
            "-f".into(),
            "lavfi".into(),
            "-i".into(),
            format!(
                "anullsrc=r={}:cl={}",
                plan.sample_rate,
                channel_layout(plan.channels)
            ),
        ]);
        return;
    }

    for input in &plan.inputs {
        args.extend([
            "-thread_queue_size".into(),
            "4096".into(),
            "-f".into(),
            input.backend.clone(),
            "-audio_buffer_size".into(),
            DEFAULT_AUDIO_BUFFER_MS.to_string(),
            "-i".into(),
            format!("audio={}", input.name),
        ]);
    }
}

pub fn append_audio_output_args(args: &mut Vec<String>, plan: &NativeAudioPlan) {
    args.extend(["-map".into(), "0:v".into()]);

    if plan.inputs.is_empty() {
        args.push("-an".into());
        return;
    }

    if plan.inputs.len() == 1 {
        args.extend(["-map".into(), "1:a".into()]);
    } else {
        let mut filter = String::new();
        for idx in 0..plan.inputs.len() {
            filter.push_str(&format!("[{}:a]", idx + 1));
        }
        filter.push_str(&format!(
            "amix=inputs={}:duration=longest:normalize=0,aresample=async=1:min_hard_comp=0.100:first_pts=0[a_mix]",
            plan.inputs.len()
        ));
        args.extend([
            "-filter_complex".into(),
            filter,
            "-map".into(),
            "[a_mix]".into(),
        ]);
    }

    args.extend([
        "-c:a".into(),
        "aac".into(),
        "-b:a".into(),
        format!("{}k", plan.bitrate_kbps),
        "-ar".into(),
        plan.sample_rate.to_string(),
        "-ac".into(),
        plan.channels.to_string(),
    ]);

    if plan.inputs.len() == 1 {
        args.extend([
            "-af".into(),
            "aresample=async=1:min_hard_comp=0.100:first_pts=0".into(),
        ]);
    }
}

pub fn set_audio_state(
    status: &mut NativeAudioStatus,
    next: EngineHealthState,
    error: Option<String>,
    event: Option<String>,
) {
    let clear_event = matches!(
        next,
        EngineHealthState::Inactive
            | EngineHealthState::Starting
            | EngineHealthState::Active
            | EngineHealthState::Stopped
    );
    status.state = next;
    status.last_error = error;
    if let Some(event) = event {
        status.last_event = Some(event);
    } else if clear_event {
        status.last_event = None;
    }
    status.last_update_ms = now_ms();
}

pub fn apply_audio_runtime_signal(line: &str, status: &mut NativeAudioStatus) {
    if status.state == EngineHealthState::Inactive && status.input_count == 0 {
        return;
    }

    let lowered = line.to_ascii_lowercase();
    let audio_marker = lowered.contains("audio")
        || lowered.contains("dshow")
        || lowered.contains("anullsrc")
        || status.inputs.iter().any(|input| {
            lowered.contains(&input.name.to_ascii_lowercase())
                || input
                    .alternative_name
                    .as_ref()
                    .map(|alt| lowered.contains(&alt.to_ascii_lowercase()))
                    .unwrap_or(false)
        });

    if !audio_marker {
        return;
    }

    let next = if lowered.contains("timed out")
        || lowered.contains("buffer underflow")
        || lowered.contains("connection reset")
        || lowered.contains("reconnect")
    {
        Some(EngineHealthState::Recovering)
    } else if lowered.contains("error")
        || lowered.contains("failed")
        || lowered.contains("invalid")
        || lowered.contains("could not")
    {
        Some(EngineHealthState::Error)
    } else if lowered.contains("drop") || lowered.contains("warning") {
        Some(EngineHealthState::Degraded)
    } else {
        None
    };

    if let Some(next) = next {
        set_audio_state(status, next, Some(line.to_string()), Some(line.to_string()));
    }
}

pub fn describe_audio_plan(plan: &NativeAudioPlan) -> String {
    if plan.inputs.is_empty() {
        return if plan.using_synthetic {
            format!("Synthetic silence @ {}Hz", plan.sample_rate)
        } else {
            "No native audio input".into()
        };
    }

    let joined = plan
        .inputs
        .iter()
        .map(|input| input.name.clone())
        .collect::<Vec<_>>()
        .join(" + ");

    format!(
        "{} via {} @ {}Hz",
        joined,
        plan.backend.to_ascii_uppercase(),
        plan.sample_rate
    )
}

#[derive(Copy, Clone)]
enum DevicePreference {
    System,
    Microphone,
    Any,
}

fn normalize_audio_mode(mode: &str) -> &'static str {
    match mode.trim().to_ascii_lowercase().as_str() {
        "system" => "system",
        "microphone" | "mic" => "microphone",
        "device" => "device",
        "silent" | "disabled" | "off" => "silent",
        "hybrid" | "mix" | "mixed" => "hybrid",
        _ => "auto",
    }
}

fn fallback_silence_plan(
    mode: &str,
    sample_rate: u32,
    channels: u32,
    bitrate_kbps: u32,
    lavfi_enabled: bool,
    selection_note: Option<String>,
) -> NativeAudioPlan {
    NativeAudioPlan {
        mode: mode.into(),
        backend: if lavfi_enabled { "lavfi".into() } else { "none".into() },
        sample_rate,
        channels,
        bitrate_kbps,
        inputs: if lavfi_enabled {
            vec![NativeAudioInputSpec {
                name: "anullsrc".into(),
                alternative_name: None,
                kind: NativeAudioSourceKind::Synthetic,
                backend: "lavfi".into(),
            }]
        } else {
            Vec::new()
        },
        using_synthetic: lavfi_enabled,
        selection_note,
    }
}

fn parse_dshow_audio_devices(output: &str) -> Vec<NativeAudioInput> {
    let mut devices: Vec<NativeAudioInput> = Vec::new();

    for raw_line in output.lines() {
        let line = raw_line.trim();
        if let Some(name) = extract_audio_device_name(line) {
            devices.push(NativeAudioInput {
                name: name.clone(),
                alternative_name: None,
                kind: infer_audio_source_kind(&name),
                backend: "dshow".into(),
            });
            continue;
        }

        if line.contains("Alternative name") {
            if let Some(last) = devices.last_mut() {
                if last.alternative_name.is_none() {
                    last.alternative_name = extract_quoted_value(line);
                }
            }
        }
    }

    devices
}

fn extract_audio_device_name(line: &str) -> Option<String> {
    if !line.contains("(audio)") {
        return None;
    }
    extract_quoted_value(line)
}

fn extract_quoted_value(line: &str) -> Option<String> {
    let start = line.find('"')?;
    let rest = &line[start + 1..];
    let end = rest.find('"')?;
    Some(rest[..end].to_string())
}

fn infer_audio_source_kind(name: &str) -> NativeAudioSourceKind {
    let lowered = name.to_ascii_lowercase();
    if matches_any(
        &lowered,
        &[
            "cable output",
            "stereo mix",
            "what u hear",
            "wave out",
            "loopback",
            "monitor of",
            "vb-audio",
            "voicemeeter",
        ],
    ) {
        if lowered.contains("cable") || lowered.contains("voicemeeter") || lowered.contains("vb-audio")
        {
            NativeAudioSourceKind::Virtual
        } else {
            NativeAudioSourceKind::System
        }
    } else if matches_any(
        &lowered,
        &["microphone", "mic", "headset", "line in", "input"],
    ) {
        NativeAudioSourceKind::Microphone
    } else {
        NativeAudioSourceKind::Unknown
    }
}

fn find_device_by_name<'a>(
    devices: &'a [NativeAudioInput],
    requested: &str,
) -> Option<&'a NativeAudioInput> {
    let lowered = requested.to_ascii_lowercase();
    devices.iter().find(|device| {
        device.name.eq_ignore_ascii_case(requested)
            || device
                .alternative_name
                .as_ref()
                .map(|alt| alt.eq_ignore_ascii_case(requested))
                .unwrap_or(false)
            || device.name.to_ascii_lowercase() == lowered
            || device
                .alternative_name
                .as_ref()
                .map(|alt| alt.to_ascii_lowercase() == lowered)
                .unwrap_or(false)
    })
}

fn select_preferred_device<'a>(
    devices: &'a [NativeAudioInput],
    preference: DevicePreference,
    selected: &[NativeAudioInputSpec],
) -> Option<&'a NativeAudioInput> {
    devices
        .iter()
        .filter(|device| {
            !selected.iter().any(|input| {
                input.name.eq_ignore_ascii_case(&device.name)
                    || input
                        .alternative_name
                        .as_ref()
                        .zip(device.alternative_name.as_ref())
                        .map(|(left, right)| left.eq_ignore_ascii_case(right))
                        .unwrap_or(false)
            })
        })
        .max_by_key(|device| score_audio_device(device, preference))
}

fn score_audio_device(device: &NativeAudioInput, preference: DevicePreference) -> u32 {
    let lowered = device.name.to_ascii_lowercase();
    let base = match device.kind {
        NativeAudioSourceKind::Virtual => 170,
        NativeAudioSourceKind::System => 150,
        NativeAudioSourceKind::Microphone => 130,
        NativeAudioSourceKind::Unknown => 50,
        NativeAudioSourceKind::Synthetic => 0,
    };

    let preference_bonus = match preference {
        DevicePreference::System => match device.kind {
            NativeAudioSourceKind::Virtual => 100,
            NativeAudioSourceKind::System => 80,
            _ => 0,
        },
        DevicePreference::Microphone => match device.kind {
            NativeAudioSourceKind::Microphone => 100,
            _ => 0,
        },
        DevicePreference::Any => 25,
    };

    let name_bonus = if lowered.contains("default") {
        10
    } else if lowered.contains("array") {
        5
    } else {
        0
    };

    base + preference_bonus + name_bonus
}

fn to_audio_input_spec(device: &NativeAudioInput) -> NativeAudioInputSpec {
    NativeAudioInputSpec {
        name: device.name.clone(),
        alternative_name: device.alternative_name.clone(),
        kind: device.kind.clone(),
        backend: device.backend.clone(),
    }
}

fn channel_layout(channels: u32) -> &'static str {
    if channels <= 1 {
        "mono"
    } else {
        "stereo"
    }
}

fn matches_any(input: &str, candidates: &[&str]) -> bool {
    candidates.iter().any(|candidate| input.contains(candidate))
}
