// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::process::{Command, Stdio};
use tauri::State;
use std::sync::Mutex;

// State to hold the FFmpeg process handle if we need to kill it later
struct AppState {
    ffmpeg_process: Mutex<Option<std::process::Child>>,
}

use serde::{Deserialize, Serialize};

#[derive(Debug, Deserialize, Serialize)]
pub struct StreamDestination {
    pub id: String,
    pub name: String,
    pub rtmpUrl: String,
    pub streamKey: String,
    pub enabled: bool,
}

#[tauri::command]
async fn start_stream(
    destinations: Vec<StreamDestination>, 
    state: State<'_, AppState>
) -> Result<String, String> {
    let active_destinations: Vec<&StreamDestination> = destinations.iter().filter(|d| d.enabled).collect();
    
    if active_destinations.is_empty() {
        return Err("No active destinations provided".into());
    }

    println!("Starting multi-stream to {} destinations", active_destinations.len());
    
    // In a real application, you would spawn FFmpeg here and pipe the canvas stream to it.
    // Using the tee muxer to stream to multiple destinations efficiently:
    let mut ffmpeg_cmd = Command::new("ffmpeg");
    
    // Input configuration (reading from stdin, assuming raw video/audio or a specific format)
    // For this example, we assume we're receiving a raw video stream or something ffmpeg can auto-detect from stdin
    ffmpeg_cmd.arg("-y")
        .arg("-f").arg("image2pipe") // Assuming we are piping jpeg frames from canvas
        .arg("-vcodec").arg("mjpeg")
        .arg("-r").arg("30")
        .arg("-i").arg("-"); // Read from stdin

    // Video encoding configuration
    ffmpeg_cmd.arg("-c:v").arg("libx264")
        .arg("-preset").arg("veryfast")
        .arg("-maxrate").arg("5000k")
        .arg("-bufsize").arg("10000k")
        .arg("-pix_fmt").arg("yuv420p")
        .arg("-g").arg("60");

    // Audio encoding configuration (assuming we are also piping audio, or generating silence if none)
    // For simplicity, we might just copy audio or encode if provided. Let's assume we encode.
    // ffmpeg_cmd.arg("-c:a").arg("aac").arg("-b:a").arg("128k").arg("-ar").arg("44100");

    // Construct the tee muxer output string
    let mut tee_outputs = String::new();
    for dest in active_destinations.iter() {
        // Format: [f=flv]rtmp://server/app/streamkey
        let url = format!("{}/{}", dest.rtmpUrl.trim_end_matches('/'), dest.streamKey);
        tee_outputs.push_str(&format!("[f=flv]{}|", url));
    }
    
    // Remove the trailing pipe character
    if tee_outputs.ends_with('|') {
        tee_outputs.pop();
    }
    
    // Apply the tee muxer
    ffmpeg_cmd.arg("-f").arg("tee")
        .arg("-map").arg("0:v") // Map video stream
        // .arg("-map").arg("0:a") // Map audio stream if available
        .arg(tee_outputs);
    
    println!("Executing FFmpeg command: {:?}", ffmpeg_cmd);

    match ffmpeg_cmd.stdin(Stdio::piped()).spawn() {
        Ok(child) => {
            let mut process_guard = state.ffmpeg_process.lock().unwrap();
            *process_guard = Some(child);
            Ok(format!("Successfully connected to {} destinations", active_destinations.len()))
        },
        Err(e) => {
            eprintln!("Failed to start FFmpeg: {}", e);
            Err(format!("Failed to start FFmpeg: {}", e))
        }
    }
}

#[tauri::command]
async fn stop_stream(state: State<'_, AppState>) -> Result<String, String> {
    println!("Stopping stream");
    
    // Kill the FFmpeg process if it exists
    let mut process_guard = state.ffmpeg_process.lock().unwrap();
    if let Some(mut child) = process_guard.take() {
        let _ = child.kill();
        let _ = child.wait();
        return Ok("Stream stopped successfully".into());
    }

    Ok("No active stream found".into())
}

fn main() {
    tauri::Builder::default()
        .manage(AppState {
            ffmpeg_process: Mutex::new(None),
        })
        .invoke_handler(tauri::generate_handler![start_stream, stop_stream])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
