use std::collections::HashMap;
use std::sync::{Mutex, OnceLock};

use serde::{Deserialize, Serialize};

use super::source::{latest_source_frame_count, note_source_error, note_source_frame};
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
    last_render_ms: u64,
    last_error: Option<String>,
}

#[derive(Debug, Clone)]
struct StoredSourceFrame {
    width: u32,
    height: u32,
    rgba: Vec<u8>,
}

fn scene_snapshot_store() -> &'static Mutex<Option<StoredSceneSnapshot>> {
    static INSTANCE: OnceLock<Mutex<Option<StoredSceneSnapshot>>> = OnceLock::new();
    INSTANCE.get_or_init(|| Mutex::new(None))
}

fn source_frame_store() -> &'static Mutex<HashMap<String, StoredSourceFrame>> {
    static INSTANCE: OnceLock<Mutex<HashMap<String, StoredSourceFrame>>> = OnceLock::new();
    INSTANCE.get_or_init(|| Mutex::new(HashMap::new()))
}

pub fn current_video_status() -> NativeVideoStatus {
    let snapshot = scene_snapshot_store()
        .lock()
        .ok()
        .and_then(|guard| (*guard).clone());
    let source_frame_count = latest_source_frame_count();

    match snapshot {
        Some(stored) => NativeVideoStatus {
            state: if stored.last_error.is_some() && stored.last_render_ms == 0 {
                EngineHealthState::Error
            } else if stored.last_render_ms > 0 {
                EngineHealthState::Active
            } else {
                EngineHealthState::Starting
            },
            render_path: if stored.last_render_ms > 0 {
                "native-scene-rgba".into()
            } else {
                stored.snapshot.render_path
            },
            scene_revision: stored.snapshot.revision,
            active_scene_id: Some(stored.snapshot.active_scene_id),
            active_scene_name: Some(stored.snapshot.active_scene_name),
            scene_type: Some(stored.snapshot.scene_type),
            layout: Some(stored.snapshot.layout),
            node_count: stored.snapshot.nodes.len(),
            visible_node_count: stored.snapshot.nodes.iter().filter(|node| node.visible).count(),
            source_frame_count,
            last_sync_ms: stored.synced_at_ms,
            last_render_ms: stored.last_render_ms,
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
            source_frame_count,
            last_sync_ms: 0,
            last_render_ms: 0,
            last_error: None,
        },
    }
}

fn parse_hex_color(input: &str) -> [u8; 4] {
    let trimmed = input.trim().trim_start_matches('#');
    match trimmed.len() {
        3 => {
            let r = u8::from_str_radix(&trimmed[0..1].repeat(2), 16).unwrap_or(0);
            let g = u8::from_str_radix(&trimmed[1..2].repeat(2), 16).unwrap_or(0);
            let b = u8::from_str_radix(&trimmed[2..3].repeat(2), 16).unwrap_or(0);
            [r, g, b, 255]
        }
        6 => {
            let r = u8::from_str_radix(&trimmed[0..2], 16).unwrap_or(0);
            let g = u8::from_str_radix(&trimmed[2..4], 16).unwrap_or(0);
            let b = u8::from_str_radix(&trimmed[4..6], 16).unwrap_or(0);
            [r, g, b, 255]
        }
        _ => [93, 40, 217, 255],
    }
}

fn blend_pixel(dest: &mut [u8], src: [u8; 4]) {
    let alpha = src[3] as f32 / 255.0;
    if alpha <= 0.0 {
        return;
    }
    if alpha >= 1.0 {
        dest[0] = src[0];
        dest[1] = src[1];
        dest[2] = src[2];
        dest[3] = 255;
        return;
    }

    dest[0] = ((src[0] as f32 * alpha) + (dest[0] as f32 * (1.0 - alpha))).round() as u8;
    dest[1] = ((src[1] as f32 * alpha) + (dest[1] as f32 * (1.0 - alpha))).round() as u8;
    dest[2] = ((src[2] as f32 * alpha) + (dest[2] as f32 * (1.0 - alpha))).round() as u8;
    dest[3] = 255;
}

fn set_pixel(buffer: &mut [u8], width: u32, x: i32, y: i32, color: [u8; 4]) {
    if x < 0 || y < 0 {
        return;
    }

    let x = x as u32;
    let y = y as u32;
    if x >= width {
        return;
    }

    let idx = ((y * width + x) * 4) as usize;
    if idx + 4 > buffer.len() {
        return;
    }
    blend_pixel(&mut buffer[idx..idx + 4], color);
}

fn fill_rect(
    buffer: &mut [u8],
    width: u32,
    height: u32,
    x: i32,
    y: i32,
    rect_width: i32,
    rect_height: i32,
    color: [u8; 4],
) {
    if rect_width <= 0 || rect_height <= 0 {
        return;
    }

    let start_x = x.max(0) as u32;
    let start_y = y.max(0) as u32;
    let end_x = (x + rect_width).min(width as i32).max(0) as u32;
    let end_y = (y + rect_height).min(height as i32).max(0) as u32;

    for row in start_y..end_y {
        for col in start_x..end_x {
            let idx = ((row * width + col) * 4) as usize;
            blend_pixel(&mut buffer[idx..idx + 4], color);
        }
    }
}

fn fill_circle(
    buffer: &mut [u8],
    width: u32,
    height: u32,
    center_x: i32,
    center_y: i32,
    radius: i32,
    color: [u8; 4],
) {
    if radius <= 0 {
        return;
    }

    let min_x = (center_x - radius).max(0);
    let max_x = (center_x + radius).min(width as i32);
    let min_y = (center_y - radius).max(0);
    let max_y = (center_y + radius).min(height as i32);
    let radius_sq = radius * radius;

    for y in min_y..max_y {
        for x in min_x..max_x {
            let dx = x - center_x;
            let dy = y - center_y;
            if dx * dx + dy * dy <= radius_sq {
                set_pixel(buffer, width, x, y, color);
            }
        }
    }
}

fn lerp_color(a: [u8; 4], b: [u8; 4], t: f32) -> [u8; 4] {
    [
        (a[0] as f32 + (b[0] as f32 - a[0] as f32) * t).round() as u8,
        (a[1] as f32 + (b[1] as f32 - a[1] as f32) * t).round() as u8,
        (a[2] as f32 + (b[2] as f32 - a[2] as f32) * t).round() as u8,
        255,
    ]
}

fn fill_background(
    buffer: &mut [u8],
    width: u32,
    height: u32,
    background: &str,
    brand_color: &str,
) {
    let brand = parse_hex_color(brand_color);
    let dark = [8, 12, 20, 255];
    let light = [245, 247, 250, 255];
    let soft = [225, 232, 240, 255];

    for y in 0..height {
        let vertical_t = if height > 1 {
            y as f32 / (height - 1) as f32
        } else {
            0.0
        };
        for x in 0..width {
            let diagonal_t = if width > 1 {
                ((x as f32 / width as f32) + vertical_t) * 0.5
            } else {
                vertical_t
            };

            let color = match background {
                "Brand Theme" => brand,
                "Light Studio" => lerp_color(light, soft, vertical_t),
                "Gradient Motion" => lerp_color(brand, dark, diagonal_t.clamp(0.0, 1.0)),
                "Minimalist" => lerp_color(light, [235, 235, 235, 255], diagonal_t),
                _ => lerp_color([15, 23, 42, 255], [0, 0, 0, 255], diagonal_t),
            };

            let idx = ((y * width + x) * 4) as usize;
            buffer[idx] = color[0];
            buffer[idx + 1] = color[1];
            buffer[idx + 2] = color[2];
            buffer[idx + 3] = 255;
        }
    }
}

fn draw_placeholder(
    buffer: &mut [u8],
    width: u32,
    height: u32,
    node: &NativeSceneNode,
    color: [u8; 4],
) {
    let x = node.x.round() as i32;
    let y = node.y.round() as i32;
    let rect_width = node.width.round() as i32;
    let rect_height = node.height.round() as i32;

    fill_rect(
        buffer,
        width,
        height,
        x,
        y,
        rect_width,
        rect_height,
        [color[0] / 5, color[1] / 5, color[2] / 5, 255],
    );

    let stripe_color = [color[0], color[1], color[2], 48];
    let mut offset = 0;
    while offset < rect_width + rect_height {
        for step in 0..24 {
            let px = x + offset - step;
            let py = y + step;
            if px >= x && px < x + rect_width && py >= y && py < y + rect_height {
                set_pixel(buffer, width, px, py, stripe_color);
            }
        }
        offset += 28;
    }

    fill_rect(buffer, width, height, x, y, rect_width, 4, color);
    fill_rect(
        buffer,
        width,
        height,
        x,
        y + rect_height - 4,
        rect_width,
        4,
        color,
    );
    fill_rect(buffer, width, height, x, y, 4, rect_height, color);
    fill_rect(
        buffer,
        width,
        height,
        x + rect_width - 4,
        y,
        4,
        rect_height,
        color,
    );
}

fn draw_overlay(
    buffer: &mut [u8],
    width: u32,
    height: u32,
    node: &NativeSceneNode,
    brand_color: &str,
) {
    let accent = node
        .accent_color
        .as_deref()
        .map(parse_hex_color)
        .unwrap_or_else(|| parse_hex_color(brand_color));
    let x = node.x.round() as i32;
    let y = node.y.round() as i32;
    let rect_width = node.width.round() as i32;
    let rect_height = node.height.round() as i32;

    if node.source_id.as_deref() == Some("overlay:bug") {
        let radius = (rect_width.min(rect_height) / 2).max(8);
        fill_circle(
            buffer,
            width,
            height,
            x + rect_width / 2,
            y + rect_height / 2,
            radius,
            [accent[0], accent[1], accent[2], 80],
        );
        fill_circle(
            buffer,
            width,
            height,
            x + rect_width / 2,
            y + rect_height / 2,
            radius - 6,
            [accent[0], accent[1], accent[2], 180],
        );
        return;
    }

    fill_rect(
        buffer,
        width,
        height,
        x,
        y,
        rect_width,
        rect_height,
        [10, 14, 23, 210],
    );

    if node.source_id.as_deref() == Some("overlay:socials") {
        fill_rect(
            buffer,
            width,
            height,
            x,
            y,
            rect_width,
            rect_height,
            [18, 24, 38, 180],
        );
    } else {
        fill_rect(buffer, width, height, x, y, 8, rect_height, accent);
    }

    fill_rect(buffer, width, height, x, y, rect_width, 2, [255, 255, 255, 42]);
    fill_rect(
        buffer,
        width,
        height,
        x,
        y + rect_height - 2,
        rect_width,
        2,
        [255, 255, 255, 26],
    );
}

fn draw_source_frame(
    buffer: &mut [u8],
    target_width: u32,
    target_height: u32,
    node: &NativeSceneNode,
    source: &StoredSourceFrame,
) {
    let dest_x = node.x.max(0.0);
    let dest_y = node.y.max(0.0);
    let dest_width = node.width.max(1.0);
    let dest_height = node.height.max(1.0);
    let fill_mode = matches!(node.content_fit.as_deref(), Some("Fill"));
    let scale = if fill_mode {
        (dest_width / source.width as f32).max(dest_height / source.height as f32)
    } else {
        (dest_width / source.width as f32).min(dest_height / source.height as f32)
    };

    let draw_width = (source.width as f32 * scale).max(1.0);
    let draw_height = (source.height as f32 * scale).max(1.0);
    let draw_x = dest_x + ((dest_width - draw_width) * 0.5);
    let draw_y = dest_y + ((dest_height - draw_height) * 0.5);

    let clip_left = dest_x.floor().max(0.0) as i32;
    let clip_top = dest_y.floor().max(0.0) as i32;
    let clip_right = (dest_x + dest_width).ceil().min(target_width as f32) as i32;
    let clip_bottom = (dest_y + dest_height).ceil().min(target_height as f32) as i32;

    for y in clip_top..clip_bottom {
        let draw_local_y = (y as f32 + 0.5 - draw_y) / draw_height;
        if !(0.0..=1.0).contains(&draw_local_y) {
            continue;
        }

        let src_y = ((draw_local_y * source.height as f32).floor() as i32)
            .clamp(0, source.height as i32 - 1) as u32;
        for x in clip_left..clip_right {
            let draw_local_x = (x as f32 + 0.5 - draw_x) / draw_width;
            if !(0.0..=1.0).contains(&draw_local_x) {
                continue;
            }

            let src_x = ((draw_local_x * source.width as f32).floor() as i32)
                .clamp(0, source.width as i32 - 1) as u32;

            let src_idx = ((src_y * source.width + src_x) * 4) as usize;
            if src_idx + 4 > source.rgba.len() {
                continue;
            }
            let dst_idx = (((y as u32) * target_width + x as u32) * 4) as usize;
            blend_pixel(
                &mut buffer[dst_idx..dst_idx + 4],
                [
                    source.rgba[src_idx],
                    source.rgba[src_idx + 1],
                    source.rgba[src_idx + 2],
                    source.rgba[src_idx + 3],
                ],
            );
        }
    }
}

fn set_last_error(error: Option<String>) {
    if let Ok(mut guard) = scene_snapshot_store().lock() {
        if let Some(stored) = guard.as_mut() {
            stored.last_error = error;
        }
    }
}

pub fn store_source_frame(
    source_id: &str,
    width: u32,
    height: u32,
    frame_data: Vec<u8>,
) -> Result<(), String> {
    let expected = (width as usize)
        .saturating_mul(height as usize)
        .saturating_mul(4);
    if frame_data.len() != expected {
        let message = format!(
            "SOURCE_FRAME_SIZE_MISMATCH: got {}, expected {} for {}x{} RGBA",
            frame_data.len(),
            expected,
            width,
            height
        );
        set_last_error(Some(message.clone()));
        note_source_error(source_id, message.clone());
        return Err(message);
    }

    let mut guard = source_frame_store().lock().map_err(|e| e.to_string())?;
    guard.insert(
        source_id.to_string(),
        StoredSourceFrame {
            width,
            height,
            rgba: frame_data,
        },
    );
    drop(guard);
    note_source_frame(source_id, width, height);
    Ok(())
}

pub fn clear_source_frame(source_id: &str) {
    if let Ok(mut guard) = source_frame_store().lock() {
        guard.remove(source_id);
    }
}

pub fn render_native_scene_rgba(target_width: u32, target_height: u32) -> Result<Vec<u8>, String> {
    let stored_snapshot = scene_snapshot_store()
        .lock()
        .map_err(|e| e.to_string())?
        .clone()
        .ok_or_else(|| "NATIVE_SCENE_UNSYNCED".to_string())?;

    let mut buffer = vec![0u8; (target_width * target_height * 4) as usize];
    let snapshot = stored_snapshot.snapshot;
    fill_background(
        &mut buffer,
        target_width,
        target_height,
        &snapshot.background,
        &snapshot.brand_color,
    );

    let source_frames = source_frame_store().lock().map_err(|e| e.to_string())?;
    let mut nodes = snapshot
        .nodes
        .iter()
        .filter(|node| node.visible)
        .cloned()
        .collect::<Vec<_>>();
    nodes.sort_by_key(|node| node.z_index);

    for node in &nodes {
        match node.node_type.as_str() {
            "background" => {}
            "overlay" => draw_overlay(
                &mut buffer,
                target_width,
                target_height,
                node,
                &snapshot.brand_color,
            ),
            _ => {
                let accent = node
                    .accent_color
                    .as_deref()
                    .map(parse_hex_color)
                    .unwrap_or_else(|| match node.node_type.as_str() {
                        "camera" => [255, 76, 76, 255],
                        "screen" => [0, 229, 255, 255],
                        "remote" => [0, 229, 255, 255],
                        _ => parse_hex_color(&snapshot.brand_color),
                    });

                if let Some(source_id) = node.source_id.as_ref() {
                    if let Some(source) = source_frames.get(source_id) {
                        draw_source_frame(&mut buffer, target_width, target_height, node, source);
                    } else {
                        draw_placeholder(&mut buffer, target_width, target_height, node, accent);
                    }
                } else {
                    draw_placeholder(&mut buffer, target_width, target_height, node, accent);
                }
            }
        }
    }
    drop(source_frames);

    if let Ok(mut guard) = scene_snapshot_store().lock() {
        if let Some(stored) = guard.as_mut() {
            stored.last_render_ms = now_ms();
            stored.last_error = None;
        }
    }

    Ok(buffer)
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
        last_render_ms: 0,
        last_error: None,
    });

    Ok(format!(
        "Native scene synced: {} rev {} ({} visible nodes, layout {})",
        scene_name, revision, visible_nodes, layout
    ))
}

#[tauri::command]
pub async fn update_scene_source_frame(
    source_id: String,
    width: u32,
    height: u32,
    frame_data: Vec<u8>,
) -> Result<(), String> {
    store_source_frame(&source_id, width, height, frame_data)
}

#[tauri::command]
pub async fn clear_scene_source_frame(source_id: String) -> Result<(), String> {
    clear_source_frame(&source_id);
    Ok(())
}

#[tauri::command]
pub async fn get_scene_snapshot() -> Result<String, String> {
    let snapshot = scene_snapshot_store().lock().map_err(|e| e.to_string())?;
    serde_json::to_string(&snapshot.as_ref().map(|stored| &stored.snapshot)).map_err(|e| e.to_string())
}
