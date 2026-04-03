// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod engine;

use engine::service::{
    capture_replay, detect_encoder, encode_frame, get_stream_stats, list_audio_devices,
    start_replay_buffer, start_stream, stop_replay_buffer, stop_stream, write_frame,
};
use engine::video::{get_scene_snapshot, update_scene_snapshot};

fn main() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            start_stream,
            stop_stream,
            encode_frame,
            write_frame,
            get_stream_stats,
            detect_encoder,
            list_audio_devices,
            update_scene_snapshot,
            get_scene_snapshot,
            start_replay_buffer,
            capture_replay,
            stop_replay_buffer,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
