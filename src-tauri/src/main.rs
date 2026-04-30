// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod engine;

use engine::diagnostics::export_native_diagnostics_artifact;
use engine::ndi::{
    get_ndi_input_status, get_ndi_status, list_ndi_sources, probe_ndi, push_ndi_program_frame,
    start_ndi, start_ndi_input, stop_ndi, stop_ndi_input,
};
use engine::service::{
    capture_replay, cleanup_stale_aether_ffmpeg_processes, detect_encoder, encode_frame,
    get_stream_stats, list_audio_devices, render_native_scene_frame, start_replay_buffer,
    start_stream, stop_replay_buffer, stop_stream, write_frame,
};
use engine::source::{get_source_inventory, update_source_inventory};
use engine::video::{
    clear_scene_source_frame, get_scene_snapshot, update_scene_snapshot, update_scene_source_frame,
};
use engine::virtual_camera::{
    get_virtual_camera_status, start_virtual_camera, stop_virtual_camera,
};

fn main() {
    cleanup_stale_aether_ffmpeg_processes();

    tauri::Builder::default()
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .invoke_handler(tauri::generate_handler![
            start_stream,
            stop_stream,
            encode_frame,
            render_native_scene_frame,
            write_frame,
            get_stream_stats,
            detect_encoder,
            list_audio_devices,
            update_source_inventory,
            get_source_inventory,
            update_scene_snapshot,
            update_scene_source_frame,
            clear_scene_source_frame,
            get_scene_snapshot,
            start_replay_buffer,
            capture_replay,
            stop_replay_buffer,
            start_virtual_camera,
            stop_virtual_camera,
            get_virtual_camera_status,
            probe_ndi,
            start_ndi,
            push_ndi_program_frame,
            stop_ndi,
            get_ndi_status,
            list_ndi_sources,
            start_ndi_input,
            stop_ndi_input,
            get_ndi_input_status,
            export_native_diagnostics_artifact,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
