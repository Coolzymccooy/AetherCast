// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod engine;

use engine::service::{
    capture_replay,
    detect_encoder,
    encode_frame,
    get_stream_stats,
    start_replay_buffer,
    start_stream,
    stop_replay_buffer,
    stop_stream,
    write_frame,
};

fn main() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            start_stream,
            stop_stream,
            encode_frame,
            write_frame,
            get_stream_stats,
            detect_encoder,
            start_replay_buffer,
            capture_replay,
            stop_replay_buffer,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
