# Bundle FFmpeg for Tauri desktop build
# Run this before `npx tauri build` to include FFmpeg in the installer

$TargetDir = "$PSScriptRoot\..\src-tauri\binaries"
$FFmpegSource = "C:\ffmpeg\ffmpeg-8.0.1-essentials_build\bin\ffmpeg.exe"

# Create binaries directory
New-Item -ItemType Directory -Force -Path $TargetDir | Out-Null

# Tauri expects: ffmpeg-{target_triple}.exe
# For Windows x64: ffmpeg-x86_64-pc-windows-msvc.exe
$TargetFile = Join-Path $TargetDir "ffmpeg-x86_64-pc-windows-msvc.exe"

if (Test-Path $FFmpegSource) {
    Copy-Item $FFmpegSource $TargetFile -Force
    Write-Host "FFmpeg bundled: $TargetFile ($(((Get-Item $TargetFile).Length / 1MB).ToString('F1')) MB)"
} else {
    Write-Host "ERROR: FFmpeg not found at $FFmpegSource"
    Write-Host "Install FFmpeg first or update the path in this script"
    exit 1
}
