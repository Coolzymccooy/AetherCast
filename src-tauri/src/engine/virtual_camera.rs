use std::sync::{Arc, Mutex, OnceLock};
use std::time::Duration;

use futures_util::{SinkExt, StreamExt};
use serde::Deserialize;
use tokio::net::TcpListener;
use tokio::sync::{broadcast, oneshot};
use tokio::time;
use tokio_tungstenite::accept_async;
use tokio_tungstenite::tungstenite::Message;

use super::state::{EngineHealthState, VirtualCameraStartResponse, VirtualCameraStatus};
use super::telemetry::now_ms;
use super::video::render_native_scene_rgba;

fn default_virtual_camera_width() -> u32 {
    1280
}

fn default_virtual_camera_height() -> u32 {
    720
}

fn default_virtual_camera_fps() -> u32 {
    30
}

#[derive(Debug, Clone, Deserialize)]
pub struct VirtualCameraConfig {
    #[serde(default = "default_virtual_camera_width")]
    pub width: u32,
    #[serde(default = "default_virtual_camera_height")]
    pub height: u32,
    #[serde(default = "default_virtual_camera_fps")]
    pub fps: u32,
}

impl Default for VirtualCameraConfig {
    fn default() -> Self {
        Self {
            width: default_virtual_camera_width(),
            height: default_virtual_camera_height(),
            fps: default_virtual_camera_fps(),
        }
    }
}

#[derive(Debug, Clone)]
struct VirtualCameraRuntime {
    desired_active: bool,
    active: bool,
    state: EngineHealthState,
    session_id: u64,
    width: u32,
    height: u32,
    fps: u32,
    bridge_url: Option<String>,
    consumer_count: u32,
    frames_rendered: u64,
    frames_served: u64,
    started_at_ms: u64,
    last_frame_ms: u64,
    last_error: Option<String>,
    note: String,
    shutdown_tx: Option<Arc<Mutex<Option<oneshot::Sender<()>>>>>,
}

impl Default for VirtualCameraRuntime {
    fn default() -> Self {
        Self {
            desired_active: false,
            active: false,
            state: EngineHealthState::Inactive,
            session_id: 0,
            width: default_virtual_camera_width(),
            height: default_virtual_camera_height(),
            fps: default_virtual_camera_fps(),
            bridge_url: None,
            consumer_count: 0,
            frames_rendered: 0,
            frames_served: 0,
            started_at_ms: 0,
            last_frame_ms: 0,
            last_error: None,
            note: "Native virtual camera backend is inactive".into(),
            shutdown_tx: None,
        }
    }
}

fn virtual_camera_runtime() -> &'static Mutex<VirtualCameraRuntime> {
    static INSTANCE: OnceLock<Mutex<VirtualCameraRuntime>> = OnceLock::new();
    INSTANCE.get_or_init(|| Mutex::new(VirtualCameraRuntime::default()))
}

fn set_virtual_camera_error(session_id: u64, message: String) {
    if let Ok(mut runtime) = virtual_camera_runtime().lock() {
        if runtime.session_id != session_id {
            return;
        }
        runtime.state = if runtime.last_frame_ms > 0 {
            EngineHealthState::Degraded
        } else {
            EngineHealthState::Error
        };
        runtime.last_error = Some(message);
    }
}

fn adjust_consumer_count(session_id: u64, delta: i32) {
    if let Ok(mut runtime) = virtual_camera_runtime().lock() {
        if runtime.session_id != session_id {
            return;
        }
        let next = (runtime.consumer_count as i32 + delta).max(0) as u32;
        runtime.consumer_count = next;
    }
}

pub fn current_virtual_camera_status() -> VirtualCameraStatus {
    let runtime = virtual_camera_runtime()
        .lock()
        .map(|guard| guard.clone())
        .unwrap_or_default();
    let now = now_ms();

    VirtualCameraStatus {
        state: runtime.state,
        active: runtime.active,
        desired_active: runtime.desired_active,
        backend: "native-scene-ws".into(),
        transport: "raw-rgba-ws".into(),
        os_device_exposed: false,
        bridge_url: runtime.bridge_url,
        width: runtime.width,
        height: runtime.height,
        fps: runtime.fps,
        consumer_count: runtime.consumer_count,
        frames_rendered: runtime.frames_rendered,
        frames_served: runtime.frames_served,
        uptime_ms: if runtime.started_at_ms > 0 {
            now.saturating_sub(runtime.started_at_ms)
        } else {
            0
        },
        last_frame_age_ms: if runtime.last_frame_ms > 0 {
            now.saturating_sub(runtime.last_frame_ms)
        } else {
            0
        },
        note: runtime.note,
        last_error: runtime.last_error,
    }
}

fn stop_virtual_camera_runtime() {
    let shutdown = {
        let mut runtime = match virtual_camera_runtime().lock() {
            Ok(guard) => guard,
            Err(_) => return,
        };
        runtime.desired_active = false;
        runtime.active = false;
        runtime.state = EngineHealthState::Stopped;
        runtime.bridge_url = None;
        runtime.consumer_count = 0;
        runtime.note = "Native virtual camera backend stopped".into();
        runtime.shutdown_tx.take()
    };

    if let Some(shutdown) = shutdown {
        if let Ok(mut tx_guard) = shutdown.lock() {
            if let Some(tx) = tx_guard.take() {
                let _ = tx.send(());
            }
        }
    }
}

#[tauri::command]
pub async fn start_virtual_camera(config: Option<VirtualCameraConfig>) -> Result<String, String> {
    stop_virtual_camera_runtime();

    let config = config.unwrap_or_default();
    let width = config.width.max(320);
    let height = config.height.max(180);
    let fps = config.fps.clamp(1, 60);

    let listener = TcpListener::bind("127.0.0.1:0")
        .await
        .map_err(|e| format!("Failed to bind local virtual camera bridge: {}", e))?;
    let address = listener
        .local_addr()
        .map_err(|e| format!("Failed to read virtual camera bridge address: {}", e))?;
    let bridge_url = format!("ws://127.0.0.1:{}/virtual-camera", address.port());
    let session_id = now_ms();
    let (shutdown_tx, mut shutdown_rx) = oneshot::channel::<()>();
    let shutdown_tx = Arc::new(Mutex::new(Some(shutdown_tx)));
    let (frame_tx, _) = broadcast::channel::<Vec<u8>>(4);

    {
        let mut runtime = virtual_camera_runtime().lock().map_err(|e| e.to_string())?;
        runtime.desired_active = true;
        runtime.active = false;
        runtime.state = EngineHealthState::Starting;
        runtime.session_id = session_id;
        runtime.width = width;
        runtime.height = height;
        runtime.fps = fps;
        runtime.bridge_url = Some(bridge_url.clone());
        runtime.consumer_count = 0;
        runtime.frames_rendered = 0;
        runtime.frames_served = 0;
        runtime.started_at_ms = now_ms();
        runtime.last_frame_ms = 0;
        runtime.last_error = None;
        runtime.note =
            "Native virtual camera backend is ready. Windows webcam-device registration is still pending.".into();
        runtime.shutdown_tx = Some(shutdown_tx.clone());
    }

    tauri::async_runtime::spawn(async move {
        let frame_interval_ms = (1000 / fps.max(1)) as u64;
        let mut ticker = time::interval(Duration::from_millis(frame_interval_ms.max(1)));

        loop {
            tokio::select! {
                _ = &mut shutdown_rx => {
                    break;
                }
                accept_result = listener.accept() => {
                    let (stream, _) = match accept_result {
                        Ok(parts) => parts,
                        Err(err) => {
                            set_virtual_camera_error(session_id, format!("Virtual camera bridge accept failed: {}", err));
                            continue;
                        }
                    };

                    let frame_tx = frame_tx.clone();
                    tauri::async_runtime::spawn(async move {
                        let mut websocket = match accept_async(stream).await {
                            Ok(ws) => ws,
                            Err(err) => {
                                set_virtual_camera_error(session_id, format!("Virtual camera bridge handshake failed: {}", err));
                                return;
                            }
                        };

                        adjust_consumer_count(session_id, 1);
                        let mut receiver = frame_tx.subscribe();

                        loop {
                            tokio::select! {
                                outbound = receiver.recv() => {
                                    match outbound {
                                        Ok(bytes) => {
                                            if let Err(err) = websocket.send(Message::Binary(bytes.into())).await {
                                                set_virtual_camera_error(session_id, format!("Virtual camera bridge write failed: {}", err));
                                                break;
                                            }
                                        }
                                        Err(tokio::sync::broadcast::error::RecvError::Lagged(_)) => {
                                            set_virtual_camera_error(session_id, "Virtual camera bridge lagged behind frame delivery".into());
                                        }
                                        Err(tokio::sync::broadcast::error::RecvError::Closed) => break,
                                    }
                                }
                                inbound = websocket.next() => {
                                    match inbound {
                                        Some(Ok(Message::Ping(payload))) => {
                                            let _ = websocket.send(Message::Pong(payload)).await;
                                        }
                                        Some(Ok(Message::Close(_))) | None => break,
                                        Some(Ok(_)) => {}
                                        Some(Err(err)) => {
                                            set_virtual_camera_error(session_id, format!("Virtual camera bridge read failed: {}", err));
                                            break;
                                        }
                                    }
                                }
                            }
                        }

                        adjust_consumer_count(session_id, -1);
                    });
                }
                _ = ticker.tick() => {
                    match render_native_scene_rgba(width, height) {
                        Ok(frame) => {
                            let mut packet = Vec::with_capacity(8 + frame.len());
                            packet.extend_from_slice(&width.to_le_bytes());
                            packet.extend_from_slice(&height.to_le_bytes());
                            packet.extend_from_slice(&frame);

                            let rendered_at = now_ms();
                            let sent_to = frame_tx.send(packet).unwrap_or(0) as u64;

                            if let Ok(mut runtime) = virtual_camera_runtime().lock() {
                                if runtime.session_id != session_id {
                                    break;
                                }
                                runtime.active = true;
                                runtime.state = if runtime.consumer_count > 0 {
                                    EngineHealthState::Active
                                } else {
                                    EngineHealthState::Degraded
                                };
                                runtime.frames_rendered += 1;
                                runtime.frames_served += sent_to;
                                runtime.last_frame_ms = rendered_at;
                                runtime.last_error = None;
                            }
                        }
                        Err(err) => {
                            set_virtual_camera_error(session_id, err);
                        }
                    }
                }
            }
        }

        if let Ok(mut runtime) = virtual_camera_runtime().lock() {
            if runtime.session_id == session_id {
                runtime.active = false;
                runtime.desired_active = false;
                runtime.consumer_count = 0;
                runtime.bridge_url = None;
                runtime.shutdown_tx = None;
                if runtime.state != EngineHealthState::Error {
                    runtime.state = EngineHealthState::Stopped;
                }
            }
        }
    });

    let response = VirtualCameraStartResponse {
        message: format!(
            "Native virtual camera backend started at {}x{} {}fps",
            width, height, fps
        ),
        bridge_url,
    };

    serde_json::to_string(&response).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn stop_virtual_camera() -> Result<String, String> {
    stop_virtual_camera_runtime();
    Ok("Native virtual camera backend stopped".into())
}

#[tauri::command]
pub async fn get_virtual_camera_status() -> Result<String, String> {
    serde_json::to_string(&current_virtual_camera_status()).map_err(|e| e.to_string())
}
