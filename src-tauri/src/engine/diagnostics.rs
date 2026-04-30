use std::path::{Path, PathBuf};
use std::process::Command;

use serde::Serialize;
use serde_json::Value;

fn sanitize_file_component(value: &str) -> String {
    let sanitized = value
        .chars()
        .map(|ch| match ch {
            'a'..='z' | 'A'..='Z' | '0'..='9' => ch,
            _ => '-',
        })
        .collect::<String>();

    sanitized.trim_matches('-').to_string()
}

fn is_repo_root(path: &Path) -> bool {
    path.join("package.json").is_file()
        && path
            .join("scripts")
            .join("analyze-native-diagnostics.mjs")
            .is_file()
}

fn find_repo_root_from(start: &Path) -> Option<PathBuf> {
    start
        .ancestors()
        .find(|path| is_repo_root(path))
        .map(Path::to_path_buf)
}

fn resolve_repo_root() -> Result<PathBuf, String> {
    if let Ok(current_dir) = std::env::current_dir() {
        if let Some(root) = find_repo_root_from(&current_dir) {
            return Ok(root);
        }
    }

    let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    if let Some(root) = manifest_dir.parent().and_then(find_repo_root_from) {
        return Ok(root);
    }

    Err("Could not locate the repository root for diagnostics export".into())
}

#[derive(Debug, Serialize)]
struct NativeDiagnosticsArtifactResult {
    file_path: String,
    check_command: String,
    check_passed: bool,
    check_exit_code: i32,
    stdout: String,
    stderr: String,
}

#[tauri::command]
pub async fn export_native_diagnostics_artifact(payload_json: String) -> Result<String, String> {
    let payload: Value = serde_json::from_str(&payload_json)
        .map_err(|err| format!("Invalid diagnostics payload: {err}"))?;
    let repo_root = resolve_repo_root()?;
    let artifact_dir = repo_root.join("artifacts").join("native-soaks");
    std::fs::create_dir_all(&artifact_dir)
        .map_err(|err| format!("Failed to create diagnostics artifact directory: {err}"))?;

    let session_id = payload
        .pointer("/session/sessionId")
        .and_then(Value::as_u64);
    let exported_at = payload
        .get("exportedAt")
        .and_then(Value::as_str)
        .map(sanitize_file_component)
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| "export".into());
    let file_name = match session_id {
        Some(session_id) if session_id > 0 => {
            format!("aether-native-diagnostics-session-{session_id}-{exported_at}.json")
        }
        _ => format!("aether-native-diagnostics-{exported_at}.json"),
    };
    let file_path = artifact_dir.join(file_name);
    let pretty_payload = serde_json::to_string_pretty(&payload)
        .map_err(|err| format!("Failed to format diagnostics payload: {err}"))?;
    std::fs::write(&file_path, pretty_payload)
        .map_err(|err| format!("Failed to write diagnostics artifact: {err}"))?;

    let file_path_string = file_path.to_string_lossy().to_string();
    let npm_bin = if cfg!(target_os = "windows") {
        "npm.cmd"
    } else {
        "npm"
    };
    let check_command = format!("npm run diagnostics:check -- {file_path_string}");
    let output = Command::new(npm_bin)
        .args(["run", "diagnostics:check", "--", file_path_string.as_str()])
        .current_dir(&repo_root)
        .output()
        .map_err(|err| format!("Failed to run diagnostics checker: {err}"))?;

    let result = NativeDiagnosticsArtifactResult {
        file_path: file_path_string,
        check_command,
        check_passed: output.status.success(),
        check_exit_code: output.status.code().unwrap_or(-1),
        stdout: String::from_utf8_lossy(&output.stdout).to_string(),
        stderr: String::from_utf8_lossy(&output.stderr).to_string(),
    };

    serde_json::to_string(&result)
        .map_err(|err| format!("Failed to serialize diagnostics result: {err}"))
}
