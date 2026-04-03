use std::sync::{Mutex, OnceLock};

use serde::{Deserialize, Serialize};

use super::state::{EngineHealthState, NativeVideoStatus};
use super::telemetry::now_ms;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NativeSceneNode {
    pub id: String,
    pub node_type: String,
    pub label: String,
    pub source_id: Option<String>,
    pub x: f32,
    pub y: f32,
    pub width: f32,
    pub height: f32,
    pub z_index: i32,
    pub visible: bool,
    pub content_fit: Option<String>,
    pub status: Option<String>,
    pub resolution: Option<String>,
    pub fps: Option<u32>,
    pub audio_level: Option<f32>,
    pub accent_color: Option<String>,
    pub text: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NativeSceneSnapshot {
    pub revision: u64,
    pub render_path: String,
    pub canvas_width: u32,
    pub canvas_height: u32,
    pub active_scene_id: String,
    pub active_scene_name: String,
    pub scene_type: String,
    pub layout: String,
    pub transition_type: String,
    pub background: String,
    pub frame_style: String,
    pub motion_style: String,
    pub brand_color: String,
    pub source_swap: bool,
    pub nodes: Vec<NativeSceneNode>,
}

#[derive(Debug, Clone)]
struct StoredSceneSnapshot {
    snapshot: NativeSceneSnapshot,
    synced_at_ms: u64,
    last_error: Option<String>,
}

fn scene_snapshot_store() -> &'static Mutex<Option<StoredSceneSnapshot>> {
    static INSTANCE: OnceLock<Mutex<Option<StoredSceneSnapshot>>> = OnceLock::new();
    INSTANCE.get_or_init(|| Mutex::new(None))
}

pub fn current_video_status() -> NativeVideoStatus {
    let snapshot = scene_snapshot_store()
        .lock()
        .ok()
        .and_then(|guard| (*guard).clone());

    match snapshot {
        Some(stored) => NativeVideoStatus {
            state: EngineHealthState::Active,
            render_path: stored.snapshot.render_path,
            scene_revision: stored.snapshot.revision,
            active_scene_id: Some(stored.snapshot.active_scene_id),
            active_scene_name: Some(stored.snapshot.active_scene_name),
            scene_type: Some(stored.snapshot.scene_type),
            layout: Some(stored.snapshot.layout),
            node_count: stored.snapshot.nodes.len(),
            visible_node_count: stored.snapshot.nodes.iter().filter(|node| node.visible).count(),
            last_sync_ms: stored.synced_at_ms,
            last_error: stored.last_error,
        },
        None => NativeVideoStatus {
            state: EngineHealthState::Inactive,
            render_path: "unsynced".into(),
            scene_revision: 0,
            active_scene_id: None,
            active_scene_name: None,
            scene_type: None,
            layout: None,
            node_count: 0,
            visible_node_count: 0,
            last_sync_ms: 0,
            last_error: None,
        },
    }
}

#[tauri::command]
pub async fn update_scene_snapshot(snapshot: NativeSceneSnapshot) -> Result<String, String> {
    let scene_name = snapshot.active_scene_name.clone();
    let revision = snapshot.revision;
    let visible_nodes = snapshot.nodes.iter().filter(|node| node.visible).count();
    let layout = snapshot.layout.clone();

    let mut guard = scene_snapshot_store().lock().map_err(|e| e.to_string())?;
    *guard = Some(StoredSceneSnapshot {
        snapshot,
        synced_at_ms: now_ms(),
        last_error: None,
    });

    Ok(format!(
        "Native scene synced: {} rev {} ({} visible nodes, layout {})",
        scene_name, revision, visible_nodes, layout
    ))
}

#[tauri::command]
pub async fn get_scene_snapshot() -> Result<String, String> {
    let snapshot = scene_snapshot_store().lock().map_err(|e| e.to_string())?;
    serde_json::to_string(&snapshot.as_ref().map(|stored| &stored.snapshot)).map_err(|e| e.to_string())
}
