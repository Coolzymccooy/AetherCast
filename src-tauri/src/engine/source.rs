use std::collections::{HashMap, HashSet};
use std::sync::{Mutex, OnceLock};

use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use tokio::net::TcpListener;
use tokio::sync::oneshot;
use tokio_tungstenite::accept_async;
use tokio_tungstenite::tungstenite::Message;

use super::state::{EngineHealthState, NativeSourceKind, NativeSourceStatus, SourceBridgeRuntime};
use super::telemetry::now_ms;
use super::video::store_source_frame;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NativeSourceDescriptor {
    pub source_id: String,
    pub label: String,
    pub source_kind: NativeSourceKind,
    pub browser_owned: bool,
    pub available: bool,
    pub source_status: Option<String>,
    pub resolution: Option<String>,
    pub fps: Option<u32>,
    pub audio_level: Option<f32>,
}

#[derive(Debug, Clone)]
struct StoredSourceInventoryEntry {
    descriptor: NativeSourceDescriptor,
    recovery_delay_ms: u64,
    restart_count: u32,
    last_event: Option<String>,
    last_inventory_sync_ms: u64,
    frame_width: u32,
    frame_height: u32,
    last_frame_ms: u64,
    last_update_ms: u64,
    last_error: Option<String>,
}

fn source_inventory_store() -> &'static Mutex<HashMap<String, StoredSourceInventoryEntry>> {
    static INSTANCE: OnceLock<Mutex<HashMap<String, StoredSourceInventoryEntry>>> = OnceLock::new();
    INSTANCE.get_or_init(|| Mutex::new(HashMap::new()))
}

fn source_bridge_runtime() -> &'static Mutex<SourceBridgeRuntime> {
    static INSTANCE: OnceLock<Mutex<SourceBridgeRuntime>> = OnceLock::new();
    INSTANCE.get_or_init(|| Mutex::new(SourceBridgeRuntime::default()))
}

#[derive(Debug, Deserialize)]
struct SourceBridgeRegisterMessage {
    source_id: String,
}

pub fn current_source_bridge_runtime() -> SourceBridgeRuntime {
    source_bridge_runtime()
        .lock()
        .map(|guard| guard.clone())
        .unwrap_or_default()
}

fn mark_source_bridge_connection(session_id: u64, source_id: &str, connected: bool) {
    if let Ok(mut bridge) = source_bridge_runtime().lock() {
        if bridge.session_id != session_id {
            return;
        }
        if connected {
            bridge.connected_sources.insert(source_id.to_string());
        } else {
            bridge.connected_sources.remove(source_id);
        }
    }
}

pub fn stop_source_bridge() {
    let shutdown = {
        let mut bridge = match source_bridge_runtime().lock() {
            Ok(guard) => guard,
            Err(_) => return,
        };
        bridge.url = None;
        bridge.connected_sources.clear();
        bridge.frames_received = 0;
        bridge.bytes_received = 0;
        bridge.last_error = None;
        bridge.shutdown_tx.take()
    };

    if let Some(shutdown) = shutdown {
        if let Ok(mut tx_guard) = shutdown.lock() {
            if let Some(tx) = tx_guard.take() {
                let _ = tx.send(());
            }
        }
    }
}

pub async fn start_source_bridge(session_id: u64) -> Result<String, String> {
    stop_source_bridge();

    let listener = TcpListener::bind("127.0.0.1:0")
        .await
        .map_err(|e| format!("Failed to bind local source bridge: {}", e))?;
    let address = listener
        .local_addr()
        .map_err(|e| format!("Failed to read source bridge address: {}", e))?;
    let bridge_url = format!("ws://127.0.0.1:{}/source", address.port());
    let (shutdown_tx, mut shutdown_rx) = oneshot::channel::<()>();
    let shutdown_tx = std::sync::Arc::new(std::sync::Mutex::new(Some(shutdown_tx)));

    {
        let mut bridge = source_bridge_runtime().lock().map_err(|e| e.to_string())?;
        bridge.session_id = session_id;
        bridge.url = Some(bridge_url.clone());
        bridge.connected_sources.clear();
        bridge.frames_received = 0;
        bridge.bytes_received = 0;
        bridge.shutdown_tx = Some(shutdown_tx.clone());
        bridge.last_error = None;
    }

    tauri::async_runtime::spawn(async move {
        loop {
            tokio::select! {
                _ = &mut shutdown_rx => {
                    break;
                }
                accept_result = listener.accept() => {
                    let (stream, _) = match accept_result {
                        Ok(parts) => parts,
                        Err(err) => {
                            if let Ok(mut bridge) = source_bridge_runtime().lock() {
                                if bridge.session_id == session_id {
                                    bridge.last_error = Some(format!("Source bridge accept failed: {}", err));
                                }
                            }
                            continue;
                        }
                    };

                    let mut websocket = match accept_async(stream).await {
                        Ok(ws) => ws,
                        Err(err) => {
                            if let Ok(mut bridge) = source_bridge_runtime().lock() {
                                if bridge.session_id == session_id {
                                    bridge.last_error = Some(format!("Source bridge handshake failed: {}", err));
                                }
                            }
                            continue;
                        }
                    };

                    let mut registered_source_id: Option<String> = None;

                    while let Some(message_result) = websocket.next().await {
                        match message_result {
                            Ok(Message::Text(text)) => {
                                if registered_source_id.is_some() {
                                    continue;
                                }

                                match serde_json::from_str::<SourceBridgeRegisterMessage>(text.as_ref()) {
                                    Ok(payload) if !payload.source_id.trim().is_empty() => {
                                        mark_source_bridge_connection(session_id, &payload.source_id, true);
                                        registered_source_id = Some(payload.source_id);
                                        if let Ok(mut bridge) = source_bridge_runtime().lock() {
                                            if bridge.session_id == session_id {
                                                bridge.last_error = None;
                                            }
                                        }
                                    }
                                    Ok(_) | Err(_) => {
                                        if let Ok(mut bridge) = source_bridge_runtime().lock() {
                                            if bridge.session_id == session_id {
                                                bridge.last_error = Some("Source bridge register payload was invalid".into());
                                            }
                                        }
                                        break;
                                    }
                                }
                            }
                            Ok(Message::Binary(bytes)) => {
                                let Some(source_id) = registered_source_id.as_ref() else {
                                    if let Ok(mut bridge) = source_bridge_runtime().lock() {
                                        if bridge.session_id == session_id {
                                            bridge.last_error = Some("Source bridge frame arrived before registration".into());
                                        }
                                    }
                                    break;
                                };

                                if bytes.len() < 8 {
                                    let error = "SOURCE_BRIDGE_FRAME_TOO_SMALL".to_string();
                                    note_source_error(source_id, error.clone());
                                    if let Ok(mut bridge) = source_bridge_runtime().lock() {
                                        if bridge.session_id == session_id {
                                            bridge.last_error = Some(error);
                                        }
                                    }
                                    continue;
                                }

                                let width = u32::from_le_bytes([bytes[0], bytes[1], bytes[2], bytes[3]]);
                                let height = u32::from_le_bytes([bytes[4], bytes[5], bytes[6], bytes[7]]);
                                let payload = bytes[8..].to_vec();

                                if let Ok(mut bridge) = source_bridge_runtime().lock() {
                                    if bridge.session_id == session_id {
                                        bridge.frames_received += 1;
                                        bridge.bytes_received += payload.len() as u64;
                                    }
                                }

                                if let Err(err) =
                                    store_source_frame(source_id, width, height, payload, false)
                                {
                                    note_source_error(source_id, err.clone());
                                    if let Ok(mut bridge) = source_bridge_runtime().lock() {
                                        if bridge.session_id == session_id {
                                            bridge.last_error = Some(err);
                                        }
                                    }
                                }
                            }
                            Ok(Message::Close(_)) => break,
                            Ok(Message::Ping(_))
                            | Ok(Message::Pong(_))
                            | Ok(Message::Frame(_)) => {}
                            Err(err) => {
                                if let Some(source_id) = registered_source_id.as_ref() {
                                    note_source_error(
                                        source_id,
                                        format!("Source bridge read failed: {}", err),
                                    );
                                }
                                if let Ok(mut bridge) = source_bridge_runtime().lock() {
                                    if bridge.session_id == session_id {
                                        bridge.last_error = Some(format!("Source bridge read failed: {}", err));
                                    }
                                }
                                break;
                            }
                        }
                    }

                    if let Some(source_id) = registered_source_id.as_ref() {
                        mark_source_bridge_connection(session_id, source_id, false);
                    }
                }
            }
        }

        if let Ok(mut bridge) = source_bridge_runtime().lock() {
            if bridge.session_id == session_id {
                bridge.connected_sources.clear();
                bridge.shutdown_tx = None;
            }
        }
    });

    Ok(bridge_url)
}

pub fn current_source_statuses() -> Vec<NativeSourceStatus> {
    let now = now_ms();
    let mut entries = source_inventory_store()
        .lock()
        .map(|guard| guard.values().cloned().collect::<Vec<_>>())
        .unwrap_or_default();

    entries.sort_by(|a, b| a.descriptor.label.cmp(&b.descriptor.label));

    entries
        .into_iter()
        .map(|entry| {
            let state = if !entry.descriptor.available {
                EngineHealthState::Inactive
            } else if entry.last_error.is_some() && entry.last_frame_ms == 0 {
                EngineHealthState::Error
            } else if entry.last_frame_ms > 0 {
                let age = now.saturating_sub(entry.last_frame_ms);
                if age <= 1_500 {
                    EngineHealthState::Active
                } else if age <= 5_000 {
                    EngineHealthState::Degraded
                } else {
                    EngineHealthState::Recovering
                }
            } else {
                EngineHealthState::Starting
            };

            NativeSourceStatus {
                source_id: entry.descriptor.source_id,
                label: entry.descriptor.label,
                source_kind: entry.descriptor.source_kind,
                state,
                recovery_delay_ms: entry.recovery_delay_ms,
                restart_count: entry.restart_count,
                last_event: entry.last_event,
                source_status: entry.descriptor.source_status,
                resolution: entry.descriptor.resolution,
                fps: entry.descriptor.fps,
                audio_level: entry.descriptor.audio_level,
                browser_owned: entry.descriptor.browser_owned,
                frame_width: entry.frame_width,
                frame_height: entry.frame_height,
                last_frame_ms: entry.last_frame_ms,
                last_inventory_sync_ms: entry.last_inventory_sync_ms,
                last_update_ms: entry.last_update_ms,
                last_error: entry.last_error,
            }
        })
        .collect()
}

/// Called by the source bridge (browser/JS path). Updates timing but does NOT clear
/// last_error so JS can still detect that the native dshow capture failed.
pub fn note_source_frame(source_id: &str, width: u32, height: u32) {
    if let Ok(mut guard) = source_inventory_store().lock() {
        if let Some(entry) = guard.get_mut(source_id) {
            entry.frame_width = width;
            entry.frame_height = height;
            entry.last_frame_ms = now_ms();
            entry.last_update_ms = entry.last_frame_ms;
            entry.last_event = Some("Browser bridge frame received".into());
        }
    }
}

/// Called by native dshow capture. Updates timing AND clears last_error because
/// a native frame arriving means the capture process is genuinely working.
pub fn note_native_source_frame(source_id: &str, width: u32, height: u32) {
    if let Ok(mut guard) = source_inventory_store().lock() {
        if let Some(entry) = guard.get_mut(source_id) {
            entry.frame_width = width;
            entry.frame_height = height;
            entry.last_frame_ms = now_ms();
            entry.last_update_ms = entry.last_frame_ms;
            entry.last_error = None;
            entry.last_event = Some("Native capture frame received".into());
            entry.recovery_delay_ms = 0;
        }
    }
}

pub fn note_source_error(source_id: &str, error: String) {
    if let Ok(mut guard) = source_inventory_store().lock() {
        if let Some(entry) = guard.get_mut(source_id) {
            if entry.last_error.is_none() {
                entry.restart_count += 1;
            }
            entry.last_event = Some(error.clone());
            entry.last_error = Some(error);
            entry.last_update_ms = now_ms();
        }
    }
}

pub fn latest_source_frame_count() -> usize {
    source_inventory_store()
        .lock()
        .map(|guard| {
            let now = now_ms();
            guard
                .values()
                .filter(|entry| {
                    entry.descriptor.available && now.saturating_sub(entry.last_frame_ms) <= 10_000
                })
                .count()
        })
        .unwrap_or(0)
}

#[tauri::command]
pub async fn update_source_inventory(
    sources: Vec<NativeSourceDescriptor>,
) -> Result<String, String> {
    let sync_time = now_ms();
    let mut guard = source_inventory_store().lock().map_err(|e| e.to_string())?;
    let incoming_ids = sources
        .iter()
        .map(|source| source.source_id.clone())
        .collect::<HashSet<_>>();

    guard.retain(|source_id, _| incoming_ids.contains(source_id));

    for source in sources {
        let source_id = source.source_id.clone();
        if let Some(existing) = guard.get_mut(&source_id) {
            existing.descriptor = source;
            existing.last_inventory_sync_ms = sync_time;
            existing.last_update_ms = sync_time;
            existing.last_event = Some("Source inventory synced".into());
        } else {
            guard.insert(
                source_id,
                StoredSourceInventoryEntry {
                    descriptor: source,
                    recovery_delay_ms: 0,
                    restart_count: 0,
                    last_event: Some("Source inventory synced".into()),
                    last_inventory_sync_ms: sync_time,
                    frame_width: 0,
                    frame_height: 0,
                    last_frame_ms: 0,
                    last_update_ms: sync_time,
                    last_error: None,
                },
            );
        }
    }

    Ok(format!(
        "Native source inventory synced: {} source(s)",
        guard.len()
    ))
}

#[tauri::command]
pub async fn get_source_inventory() -> Result<String, String> {
    serde_json::to_string(&current_source_statuses()).map_err(|e| e.to_string())
}
