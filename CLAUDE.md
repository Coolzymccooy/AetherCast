# AetherCast Studio — CLAUDE.md

## Project Overview
AetherCast is a professional live-broadcast studio app. It supports two streaming paths:
- **Browser path**: MediaRecorder (H.264 fMP4) → Socket.io → Node.js server → FFmpeg → RTMP
- **GPU path**: Canvas → JPEG → Tauri IPC → Rust → FFmpeg NVENC → RTMP (desktop only)

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
| `src/hooks/useGPUStreaming.ts` | Canvas → JPEG → Tauri → NVENC path |
| `src-tauri/src/main.rs` | Rust Tauri commands: `start_stream`, `stop_stream`, `write_frame`, `encode_frame` |
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

### GPU streaming path
- Canvas scaled to 640×360 before Tauri IPC (JPEG ~40-80KB vs 921KB raw RGBA)
- Rust `write_frame` clears stdin on pipe failure and returns `STREAM_DEAD`
- JS loop in `useGPUStreaming.ts` cancels `requestAnimationFrame` on `STREAM_DEAD`
- FFmpeg stderr is read on a background thread in Rust and logged with `[ffmpeg]` prefix

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
