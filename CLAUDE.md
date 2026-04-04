# AetherCast Studio — CLAUDE.md

## Project Overview
AetherCast is a professional live-broadcast studio app. It supports two streaming paths:
- **Browser path**: MediaRecorder (H.264 fMP4) → Socket.io → Node.js server → FFmpeg → RTMP
- **Desktop native path**: shared scene schema + native source/runtime → Rust engine → FFmpeg/NVENC → RTMP (desktop only)

Users can connect phones via QR code as wireless cameras, screen-share sources, or audience portals.

## Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 19, TypeScript, Tailwind CSS v4, Vite |
| Backend | Node.js + Express + Socket.io (server.ts) |
| Desktop | Tauri v2 (Rust) |
| Encoding | FFmpeg (fluent-ffmpeg wrapper + direct spawn) |
| Realtime | WebRTC (SimplePeer), Socket.io |
| AI | Google Gemini (server-side, `/api/ai/*`) |

## Key Files

| File | Purpose |
|------|---------|
| `server.ts` | Express server, Socket.io hub, FFmpeg streaming pipeline, AI endpoints |
| `src/App.tsx` | Top-level router: `?mode=remote` → phone camera, `?mode=screen` → screen share, `?mode=audience` → audience portal |
| `src/hooks/useStreaming.ts` | Browser MediaRecorder → fMP4 → server path |
| `src/hooks/useNativeEngine.ts` | Primary desktop control hook for the native engine |
| `src/hooks/useGPUStreaming.ts` | Transitional compatibility alias for the native desktop hook |
| `src-tauri/src/main.rs` | Thin Rust Tauri command bootstrap into `src-tauri/src/engine/*` |
| `src/components/studio/QrModal.tsx` | QR code modal (fetches local IP from `/api/local-ip`) |
| `src/components/RemoteCameraView.tsx` | Phone camera WebRTC page |
| `src/components/PhoneScreenView.tsx` | Phone screen-share WebRTC page |
| `src/components/AudienceLanding.tsx` | Audience message portal page |

## Deployment Target
- **Desktop**: Windows 11 with NVIDIA GPU (NVENC). Tauri bundles the app.
- **Server**: Node.js 18+ on same machine (or Docker Alpine for cloud).
- **Phone access**: Same LAN WiFi. Server exposes `/api/local-ip` for QR URL generation.

## Conventions

- TypeScript strict mode, no `any` in new code
- Immutable state updates — no in-place mutation
- FFmpeg stderr must always be piped and logged (not swallowed)
- Use `STREAM_DEAD` error string from Rust to signal dead FFmpeg process to JS frame loop
- All Socket.io events from server use `server-log` for UI panel output
- Room IDs are `SLTN-XXXX` format; hardcoded as `SLTN-1234` in dev

## FFmpeg Paths (Windows)
```
C:\ffmpeg\ffmpeg-8.0.1-essentials_build\bin\ffmpeg.exe
C:\ffmpeg\bin\ffmpeg.exe
```

## Known Architecture Notes

### Browser streaming path (fMP4 → H.264 Annex B)
Chrome MediaRecorder produces ISO BMFF fragmented MP4 with AVCC NAL units.
FFmpeg's MP4 demuxer cannot seek on a pipe and crashes. The `FMP4Demuxer` Transform
in `server.ts` parses boxes, extracts SPS/PPS from `avcC`, converts NAL units to
Annex B, and feeds `-f h264` input to FFmpeg directly.

### Desktop native path
- Desktop mode now prefers raw RGBA / native-scene transport through `src/hooks/useNativeEngine.ts`
- Rust owns the stream runtime under `src-tauri/src/engine/`
- Native scene rendering and source inventory live in `src-tauri/src/engine/video.rs` and `src-tauri/src/engine/source.rs`
- Local desktop camera sources can now be acquired natively through `src-tauri/src/engine/capture.rs`
- Screen share, remote phone feeds, and media-loop sources now feed the native source store as source-level frames during desktop native-scene streaming
- FFmpeg stderr is read on background threads in Rust and logged with worker/source prefixes

### Phone QR / WebRTC
- `/api/local-ip` returns `{ ip, port }` for the LAN-accessible URL in the QR code
- WebRTC signalling: phones join room via Socket.io `join-room` event, then SimplePeer handles the rest
- `?mode=remote` — phone camera, `?mode=screen` — phone screen share, `?mode=audience` — message portal

## Environment Variables
```
PORT=3001
SOCKET_AUTH_TOKEN=   # auto-generated if not set
GEMINI_API_KEY=      # for AI background generation
PUBLIC_URL=          # cloud only — set to https://aethercast.tiwaton.co.uk so QR codes point to the public domain instead of LAN IP
```

## How to Run Locally

### Option A — Browser (fastest, no Rust toolchain needed)
```bash
# Terminal 1 — starts Node server + Vite dev server together on port 3001
npm run dev
```
Open http://localhost:3001 in Chrome.
Phone QR: scan from QR modal — phone must be on same Wi-Fi.

### Option B — Tauri Desktop (full GPU path)
```bash
# One command — launches Vite dev server + Rust Tauri window
npm run tauri:dev
```
Requires: Rust toolchain + Visual Studio Build Tools + WebView2 runtime.

### Option C — Production build (test the dist bundle)
```bash
# Step 1 — build the frontend
npm run build

# Step 2 — serve it via the Node server
NODE_ENV=production npm run dev
```
Open http://localhost:3001

### Running tests
```bash
npm test           # run all Vitest unit tests once
npm run test:watch # watch mode
npm run lint       # TypeScript type-check only (no emit)
```

### Prerequisites (Windows)
- Node.js 18+: `node -v`
- FFmpeg at `C:\ffmpeg\ffmpeg-8.0.1-essentials_build\bin\ffmpeg.exe` or `C:\ffmpeg\bin\ffmpeg.exe`
- (Tauri only) Rust: `rustup update stable`

## Android APK Signing — MANDATORY

**STOP before any Android build.** Read this section first.

The release keystore is committed at:
```
android/app/aethercast-release.keystore
  alias:    aethercast
  password: aethercast123
  validity: 10,000 days (generated 2026-04-03)
```

**Every APK release MUST use this exact keystore.** If you sign with a different
keystore, all existing users must manually uninstall the app before they can upgrade.
The keystore in `android/app/build.gradle` is already wired to this file — do not change it.

**Keep a backup** of `aethercast-release.keystore` outside the repo (USB drive, password manager).

**`android/local.properties`** is gitignored (machine-specific). If it is missing, create it:
```
sdk.dir=C\:\\Users\\segun\\AppData\\Local\\Android\\Sdk
```

**Full APK rebuild sequence — run from repo root `C:\Users\segun\source\repos\aether2`:**

> PowerShell does not support `&&`. Run each command separately.

```powershell
npm run build
npx cap sync android
cd android
./gradlew assembleRelease
cd ..
cp android/app/build/outputs/apk/release/app-release.apk public/downloads/aethercast-camera.apk
```

Web/React changes do NOT require a new APK — the APK loads the live production URL and auto-updates.
Only native Java plugin changes, manifest changes, or `capacitor.config.ts` changes require a rebuild.

## OBS-Class Roadmap

Before making major streaming architecture changes, consult:
`docs/obs-parity-roadmap.md`

This is the current repo-specific plan for moving AetherCast toward OBS/vMix/Wirecast-class desktop architecture.
Use it to decide whether a change belongs in:
- browser compatibility mode
- transitional Tauri/native work
- the long-term native media engine
