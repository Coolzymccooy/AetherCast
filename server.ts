import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";
import { createServer as createViteServer } from "vite";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import { PassThrough, Transform, TransformCallback } from "stream";
import { spawn, ChildProcess } from "child_process";
import crypto from "crypto";
import os from "os";
import dotenv from "dotenv";
import { isValidRoomId, resolveRoomId } from "./src/utils/roomId";
import { createAiRouter } from "./src/server/ai";
import { createLuminaRouter } from "./src/server/lumina";
import { sanitizeText } from "./src/server/sanitize";

dotenv.config();

// ──────────────────────────────────────────────────────────────────────────────
// fMP4 → raw H.264 Annex B demuxer
// ──────────────────────────────────────────────────────────────────────────────
// Chrome's MediaRecorder with video/mp4;codecs=avc1 produces fragmented MP4.
// FFmpeg's MP4 demuxer crashes reading fMP4 from pipe (it tries to seek).
// This Transform parses ISO BMFF boxes, extracts H.264 NAL units from mdat,
// and converts AVCC (length-prefixed) to Annex B (start-code-prefixed).
// Feed the output to FFmpeg with: -f h264 -framerate 30 -i pipe:0

const ANNEXB_START_CODE = Buffer.from([0x00, 0x00, 0x00, 0x01]);

class FMP4Demuxer extends Transform {
  private pending = Buffer.alloc(0);
  private nalLenSize = 4;     // AVCC NAL length field size (from avcC, almost always 4)
  private sps: Buffer | null;
  private pps: Buffer | null;
  private headerSent = false;

  constructor(cachedSPS?: Buffer | null, cachedPPS?: Buffer | null) {
    super();
    this.sps = cachedSPS || null;
    this.pps = cachedPPS || null;
    if (this.sps) this.headerSent = false; // will send cached SPS/PPS before first mdat
  }

  _transform(chunk: Buffer, _: string, done: TransformCallback) {
    this.pending = Buffer.concat([this.pending, chunk]);
    try {
      this.drainBoxes();
    } catch (err) {
      console.error('[fMP4] Parse error, passing raw chunk:', (err as Error).message);
    }
    done();
  }

  private drainBoxes() {
    while (this.pending.length >= 8) {
      const boxSize = this.pending.readUInt32BE(0);
      if (boxSize < 8) { this.pending = this.pending.subarray(8); continue; }
      if (boxSize > this.pending.length) return; // incomplete box, wait for more data

      const boxType = this.pending.toString('ascii', 4, 8);
      const boxPayload = this.pending.subarray(8, boxSize);
      this.pending = this.pending.subarray(boxSize);

      if (boxType === 'moov') {
        console.log(`[fMP4] moov box: ${boxPayload.length}B`);
        this.handleMoov(boxPayload);
      } else if (boxType === 'mdat') {
        this.handleMdat(boxPayload);
      }
      // Skip: ftyp, styp, moof, sidx, free, etc.
    }
  }

  /** Scan moov for avcC box to extract SPS, PPS, and NAL length size */
  private handleMoov(data: Buffer) {
    // Scan for 'avcC' signature anywhere in moov hierarchy
    // (avoids complex recursive box parsing)
    for (let i = 0; i <= data.length - 8; i++) {
      if (data[i+4] === 0x61 && data[i+5] === 0x76 &&
          data[i+6] === 0x63 && data[i+7] === 0x43) { // 'avcC'
        const size = data.readUInt32BE(i);
        if (size >= 15 && i + size <= data.length) {
          this.parseAvcC(data.subarray(i + 8, i + size));
          // Emit codec data for caching (used on watchdog restarts)
          this.emit('codec-data', { sps: this.sps, pps: this.pps });
        }
        break;
      }
    }
  }

  /** Parse avcC box: extract SPS, PPS, NAL length size */
  private parseAvcC(d: Buffer) {
    if (d.length < 7) return;
    this.nalLenSize = (d[4] & 0x03) + 1;

    let off = 5;
    // SPS
    const nSPS = d[off++] & 0x1f;
    for (let i = 0; i < nSPS && off + 2 <= d.length; i++) {
      const len = d.readUInt16BE(off); off += 2;
      if (off + len <= d.length) { this.sps = Buffer.from(d.subarray(off, off + len)); off += len; }
    }
    // PPS
    if (off < d.length) {
      const nPPS = d[off++];
      for (let i = 0; i < nPPS && off + 2 <= d.length; i++) {
        const len = d.readUInt16BE(off); off += 2;
        if (off + len <= d.length) { this.pps = Buffer.from(d.subarray(off, off + len)); off += len; }
      }
    }
    console.log(`[fMP4→H.264] avcC parsed: nalLenSize=${this.nalLenSize}, SPS=${this.sps?.length || 0}B, PPS=${this.pps?.length || 0}B`);
  }

  /** Convert AVCC NAL units in mdat to Annex B format */
  private handleMdat(payload: Buffer) {
    // Emit SPS/PPS before first frame (from moov or cache)
    if (!this.headerSent && this.sps) {
      this.push(ANNEXB_START_CODE); this.push(this.sps);
      if (this.pps) { this.push(ANNEXB_START_CODE); this.push(this.pps); }
      this.headerSent = true;
    }

    // Parse AVCC NAL units: [nalLenSize bytes: length][length bytes: NAL data]
    let off = 0;
    while (off + this.nalLenSize <= payload.length) {
      let nalLen = 0;
      for (let i = 0; i < this.nalLenSize; i++) {
        nalLen = (nalLen << 8) | payload[off + i];
      }
      off += this.nalLenSize;
      if (nalLen <= 0 || off + nalLen > payload.length) break;

      // Replace length prefix with Annex B start code
      this.push(ANNEXB_START_CODE);
      this.push(payload.subarray(off, off + nalLen));
      off += nalLen;
    }
  }
}

// ── Set FFmpeg path explicitly so it works without restarting the terminal ───
const FFMPEG_PATHS = [
  'C:\\ffmpeg\\ffmpeg-8.0.1-essentials_build\\bin\\ffmpeg.exe',
  'C:\\ffmpeg\\bin\\ffmpeg.exe',
  '/usr/local/bin/ffmpeg',
  '/usr/bin/ffmpeg',
];
for (const p of FFMPEG_PATHS) {
  if (fs.existsSync(p)) {
    console.log(`FFmpeg found at: ${p}`);
    break;
  }
}
// Store the resolved FFmpeg path for direct spawn use
let resolvedFFmpegPath = 'ffmpeg';
for (const p of FFMPEG_PATHS) {
  if (fs.existsSync(p)) {
    resolvedFFmpegPath = p;
    break;
  }
}
// Also check PATH as fallback (works if terminal was restarted after install)

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ──────────────────────────────────────────────────────────────────────────────
// Security helpers
// ──────────────────────────────────────────────────────────────────────────────

/** Simple token for Socket.io auth — persisted to disk so server restarts don't disconnect clients */
const TOKEN_FILE = path.join(os.homedir(), '.aethercast_token');

function loadOrCreateToken(): string {
  if (process.env.SOCKET_AUTH_TOKEN) return process.env.SOCKET_AUTH_TOKEN;
  try {
    if (fs.existsSync(TOKEN_FILE)) {
      const saved = fs.readFileSync(TOKEN_FILE, 'utf-8').trim();
      if (saved.length > 16) return saved;
    }
  } catch {
    // Fall through to generate a new token
  }
  const token = crypto.randomUUID();
  try { fs.writeFileSync(TOKEN_FILE, token, { mode: 0o600 }); } catch { /* best effort */ }
  return token;
}

const SOCKET_AUTH_TOKEN = loadOrCreateToken();

/** Allowed origins for CORS */
const ALLOWED_ORIGINS = process.env.NODE_ENV === 'production' && process.env.PUBLIC_URL
  ? [process.env.PUBLIC_URL, 'tauri://localhost', 'https://tauri.localhost']
  : '*';

/** Per-socket rate limiter: max `limit` events per `windowMs` */
class RateLimiter {
  private counts = new Map<string, { count: number; resetAt: number }>();

  constructor(private windowMs: number, private limit: number) {}

  isAllowed(socketId: string): boolean {
    const now = Date.now();
    const entry = this.counts.get(socketId);
    if (!entry || now > entry.resetAt) {
      this.counts.set(socketId, { count: 1, resetAt: now + this.windowMs });
      return true;
    }
    entry.count++;
    return entry.count <= this.limit;
  }

  remove(socketId: string) {
    this.counts.delete(socketId);
  }
}

const messageLimiter = new RateLimiter(60_000, 30); // 30 messages per minute
const chunkLimiter = new RateLimiter(1_000, 240);   // Allow higher chunk cadence for reconnect bursts and future frame-level transports

// ──────────────────────────────────────────────────────────────────────────────
// Stream Session Types
// ──────────────────────────────────────────────────────────────────────────────

interface StreamSession {
  id: string;
  startTime: number;
  endTime?: number;
  duration?: number;
  destinations: string[];
  encodingProfile: string;
  totalFramesSent: number;
  totalBytesReceived: number;
  droppedFrames: number;
  ffmpegRestarts: number;
  errors: Array<{ time: number; message: string }>;
}

interface DestinationHealth {
  url: string;
  status: 'connected' | 'failed' | 'reconnecting';
  error?: string;
}

interface FFmpegStats {
  frame: number;
  fps: number;
  quality: number;
  size: string;
  time: string;
  bitrate: string;
  speed: number;
}

type StartStreamData = {
  destinations: any[];
  encodingProfile: string;
  browserH264?: boolean;
  mimeType?: string;
  transportMode?: 'mediarecorder-h264' | 'mediarecorder-webm';
  disableSyntheticAudio?: boolean;
};

async function startServer() {
  const app = express();
  app.use(express.json({ limit: '1mb' }));

  // ── Global CORS middleware ────────────────────────────────────────────────
  // Required for browser/Electron renderer requests that use custom headers
  // (x-lumina-event, x-lumina-workspace, etc.) — they trigger a preflight.
  app.use((req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader(
      'Access-Control-Allow-Headers',
      'Content-Type, x-lumina-event, x-lumina-workspace, x-lumina-session, x-lumina-token, x-lumina-room, Authorization'
    );
    if (req.method === 'OPTIONS') {
      res.status(204).end();
      return;
    }
    next();
  });
  const httpServer = createServer(app);
  const io = new Server(httpServer, {
    cors: {
      origin: ALLOWED_ORIGINS,
      methods: ["GET", "POST"]
    },
    maxHttpBufferSize: 1e8, // 100MB for video chunks
    pingTimeout: 60000,     // 60s ping timeout (default 20s is too short for streaming)
    pingInterval: 25000,    // 25s ping interval
  });

  const PORT = parseInt(process.env.PORT || '3001', 10);

  // Log the auth token on startup so the client can use it
  console.log(`Socket auth token: ${SOCKET_AUTH_TOKEN}`);

  // ── Socket.io Auth Middleware ────────────────────────────────────────────
  // Allow all connections — the web app serves both frontend and backend
  // from the same origin, so CORS is the security boundary.
  // Token auth is available for external API consumers if needed.
  io.use((socket, next) => {
    return next();
  });

  // Socket.io Signaling & Streaming
  io.on("connection", (socket) => {
    console.log("User connected:", socket.id);
    let ffmpegProcess: ChildProcess | null = null;
    let inputStream: PassThrough | null = null;
    let fmp4Demuxer: FMP4Demuxer | null = null;

    // ── Cached H.264 codec data (SPS/PPS) for watchdog restarts ──────────
    let cachedSPS: Buffer | null = null;
    let cachedPPS: Buffer | null = null;

    // ── Stream Session State ──────────────────────────────────────────────
    let currentSession: StreamSession | null = null;
    let lastStartData: StartStreamData | null = null;
    let destinationHealthMap: Map<string, DestinationHealth> = new Map();

    // ── Backpressure State ────────────────────────────────────────────────
    let backpressureActive = false;

    // ── Heartbeat State ──────────────────────────────────────────────────
    let lastChunkTime = 0;
    let heartbeatInterval: ReturnType<typeof setInterval> | null = null;
    let lastRefreshRequestAt = 0;
    const ignoredExitPids = new Set<number>();

    // ── FFmpeg Watchdog State ─────────────────────────────────────────────
    const RESTART_LIMIT = 10;
    const RESTART_WINDOW_MS = 120_000;
    const COOLDOWN_RESTART_DELAY_MS = 120_000; // 2-min cooldown after limit before one final retry
    let restartTimestamps: number[] = [];
    let intentionallyStopped = false;
    let lastFFmpegStartupIssue: 'missing-lavfi' | null = null;

    // ── FFmpeg Stats Parsing State ────────────────────────────────────────
    let lastStatsEmit = 0;
    const STATS_THROTTLE_MS = 5000; // Emit stats every 5s (was 2s — reduced to prevent UI flooding)
    let slowSpeedCount = 0;
    const SLOW_SPEED_THRESHOLD = 0.9;
    const SLOW_SPEED_WARN_AFTER = 5;

    // ── Helper: finalize and log session ──────────────────────────────────
    function finalizeSession() {
      if (!currentSession) return;
      currentSession.endTime = Date.now();
      currentSession.duration = currentSession.endTime - currentSession.startTime;
      console.log('[StreamSession]', JSON.stringify(currentSession, null, 2));
      socket.emit('session-summary', currentSession);
      currentSession = null;
    }

    function clearHeartbeat() {
      if (heartbeatInterval) {
        clearInterval(heartbeatInterval);
        heartbeatInterval = null;
      }
    }

    function clearCurrentPipelineState() {
      ffmpegProcess = null;

      if (fmp4Demuxer) {
        fmp4Demuxer.destroy();
        fmp4Demuxer = null;
      }

      if (inputStream) {
        inputStream.destroy();
        inputStream = null;
      }

      backpressureActive = false;
    }

    function destroyActivePipeline(markPlannedExit = false) {
      const proc = ffmpegProcess;
      if (proc?.pid && markPlannedExit) {
        ignoredExitPids.add(proc.pid);
      }

      try {
        proc?.stdin?.destroy();
      } catch {
        // Best effort only.
      }

      try {
        proc?.kill('SIGINT');
      } catch {
        // Process may already be gone.
      }

      if (proc) {
        setTimeout(() => {
          try {
            if (proc.exitCode == null && !proc.killed) {
              proc.kill('SIGKILL');
            }
          } catch {
            // Process may already be gone.
          }
        }, 1000);
      }

      clearCurrentPipelineState();
    }

    // ── Helper: parse FFmpeg stderr line ──────────────────────────────────
    function parseStderrLine(line: string) {
      if (!currentSession) return;
      const lower = line.toLowerCase();

      if (lower.includes('input format lavfi is not available') || lower.includes("unknown input format: 'lavfi'")) {
        lastFFmpegStartupIssue = 'missing-lavfi';
      }

      // Parse progress stats: frame=  123 fps= 30 q=25.0 size=    1234kB time=00:00:04.10 bitrate=2465.5kbits/s speed=1.00x
      const statsMatch = line.match(
        /frame=\s*(\d+)\s+fps=\s*([\d.]+)\s+q=\s*([\d.-]+)\s+.*?size=\s*(\S+)\s+time=\s*(\S+)\s+bitrate=\s*(\S+)\s+speed=\s*([\d.]+)x/
      );
      if (statsMatch) {
        const stats: FFmpegStats = {
          frame: parseInt(statsMatch[1], 10),
          fps: parseFloat(statsMatch[2]),
          quality: parseFloat(statsMatch[3]),
          size: statsMatch[4],
          time: statsMatch[5],
          bitrate: statsMatch[6],
          speed: parseFloat(statsMatch[7]),
        };

        currentSession.totalFramesSent = stats.frame;

        // Throttle stats emission to every 2 seconds
        const now = Date.now();
        if (now - lastStatsEmit >= STATS_THROTTLE_MS) {
          lastStatsEmit = now;
          socket.emit('stream-stats', stats);
        }

        // Slow encoder detection
        if (stats.speed < SLOW_SPEED_THRESHOLD) {
          slowSpeedCount++;
          if (slowSpeedCount > SLOW_SPEED_WARN_AFTER) {
            const msg = `Encoder falling behind (speed: ${stats.speed}x) — consider lowering quality`;
            socket.emit('server-log', { message: msg, type: 'warning' });
            if (currentSession) {
              currentSession.errors.push({ time: Date.now(), message: msg });
            }
          }
        } else {
          slowSpeedCount = 0;
        }
      }

      // Per-destination health: detect tee muxer failures
      // FFmpeg logs lines like: "[tee] ... Error ... rtmp://..." when a destination fails
      const errorMatch = line.match(/[Ee]rror.*?((?:rtmps?|srt|rist):\/\/\S+)/);
      if (errorMatch) {
        const failedUrl = errorMatch[1];
        const health: DestinationHealth = {
          url: failedUrl,
          status: 'failed',
          error: line.trim(),
        };
        destinationHealthMap.set(failedUrl, health);
        socket.emit('destination-status', health);
        if (currentSession) {
          currentSession.errors.push({ time: Date.now(), message: `Destination failed: ${failedUrl}` });
        }
      }
    }

    // ── Helper: classify destinations by protocol ───────────────────────
    function classifyDestinations(destinations: any[]) {
      const rtmpDests: any[] = [];
      const srtDests: any[] = [];
      const ristDests: any[] = [];

      for (const dest of destinations) {
        const url = dest.rtmpUrl || dest.url || '';
        if (typeof url !== 'string' || !url) {
          socket.emit('server-log', { message: `Invalid destination: missing URL`, type: 'error' });
          return null;
        }
        if (/^rtmps?:\/\//.test(url)) {
          if (!dest.streamKey || typeof dest.streamKey !== 'string') {
            socket.emit('server-log', { message: `RTMP destination "${dest.name}" missing stream key`, type: 'error' });
            return null;
          }
          rtmpDests.push(dest);
        } else if (/^srt:\/\//.test(url)) {
          srtDests.push(dest);
        } else if (/^rist:\/\//.test(url)) {
          ristDests.push(dest);
        } else {
          socket.emit('server-log', { message: `Unsupported protocol in URL: ${url.substring(0, 30)}`, type: 'error' });
          return null;
        }
      }
      return { rtmpDests, srtDests, ristDests };
    }

    // ── Helper: build output URL(s) for destinations ──────────────────
    function buildOutputArgs(rtmpDests: any[], srtDests: any[], ristDests: any[]): string[] {
      const teeSegments: string[] = [];

      for (const dest of rtmpDests) {
        // Strip librtmp-style "key=" prefix if someone pasted it — FFmpeg's internal RTMP handler rejects it
        const cleanKey = (dest.streamKey || '').replace(/^key=/i, '');
        const url = `${(dest.rtmpUrl || dest.url).replace(/\/$/, '')}/${cleanKey}`;
        teeSegments.push(`[f=flv:onfail=ignore]${url}`);
      }

      for (const dest of srtDests) {
        let srtUrl = dest.url || dest.rtmpUrl;
        if (!srtUrl.includes('mode=')) {
          srtUrl += (srtUrl.includes('?') ? '&' : '?') + 'mode=caller';
        }
        if (dest.streamKey) {
          srtUrl += `&passphrase=${dest.streamKey}`;
        }
        if (!srtUrl.includes('latency=')) {
          srtUrl += '&latency=200000';
        }
        teeSegments.push(`[f=mpegts:onfail=ignore]${srtUrl}`);
      }

      for (const dest of ristDests) {
        const ristUrl = dest.url || dest.rtmpUrl;
        teeSegments.push(`[f=mpegts:onfail=ignore]${ristUrl}`);
      }

      if (teeSegments.length === 1) {
        const segment = teeSegments[0];
        const formatMatch = segment.match(/\[f=(\w+)/);
        const urlMatch = segment.match(/\](.+)$/);
        const format = formatMatch?.[1] || 'flv';
        const url = urlMatch?.[1] || '';
        return ['-f', format, url];
      } else {
        return ['-f', 'tee', teeSegments.join('|')];
      }
    }

    function getReencodeProfile(profile: string) {
      switch (profile) {
        case '1080p60':
        case '1080p30':
        case '720p30':
          return {
            scale: '1280:720',
            fps: 30,
            bitrate: '2500k',
            maxrate: '3000k',
            bufsize: '6000k',
          };
        case '480p30':
        default:
          return {
            scale: '854:480',
            fps: 30,
            bitrate: '1200k',
            maxrate: '1500k',
            bufsize: '3000k',
          };
      }
    }

    // ── Helper: attach process event handlers ─────────────────────────
    function attachFFmpegHandlers(proc: ChildProcess) {
      proc.stderr?.on('data', (data: Buffer) => {
        const lines = data.toString().split('\n');
        for (const line of lines) {
          const trimmed = line.trim();
          if (trimmed) {
            console.log('FFmpeg:', trimmed);
            // Surface stderr to the UI panel so we can see WHY FFmpeg crashes
            // Filter out noisy progress lines (they go through parseStderrLine)
            if (!trimmed.startsWith('frame=') && !trimmed.startsWith('size=')) {
              socket.emit('server-log', { message: `[ffmpeg] ${trimmed}`, type: trimmed.toLowerCase().includes('error') ? 'error' : 'ffmpeg' });
            }
            parseStderrLine(trimmed);
          }
        }
      });

      proc.on('error', (err: Error) => {
        const plannedExit = proc.pid != null && ignoredExitPids.delete(proc.pid);
        const isCurrentProcess = ffmpegProcess?.pid === proc.pid;
        if (plannedExit) {
          if (isCurrentProcess) {
            clearCurrentPipelineState();
          }
          return;
        }

        console.error('FFmpeg process error:', err.message);
        socket.emit('server-log', { message: `FFmpeg Error: ${err.message}`, type: 'error' });
        if (currentSession) {
          currentSession.errors.push({ time: Date.now(), message: err.message });
        }
        if (isCurrentProcess) {
          clearCurrentPipelineState();
        }
        if (!intentionallyStopped && lastStartData) {
          attemptRestart();
        }
      });

      proc.on('exit', (code: number | null) => {
        const plannedExit = proc.pid != null && ignoredExitPids.delete(proc.pid);
        const isCurrentProcess = ffmpegProcess?.pid === proc.pid;
        console.log(`FFmpeg exited with code ${code}`);
        socket.emit('server-log', { message: `FFmpeg exited (code ${code})`, type: code === 0 ? 'info' : 'error' });
        if (isCurrentProcess) {
          clearCurrentPipelineState();
        }
        if (plannedExit) {
          return;
        }
        if (!intentionallyStopped && lastStartData) {
          attemptRestart();
        }
      });
    }

    // ── Helper: spawn FFmpeg with current config ─────────────────────────
    function spawnFFmpeg(data: StartStreamData) {
      const { destinations, encodingProfile } = data;

      const classified = classifyDestinations(destinations);
      if (!classified) return false;
      const { rtmpDests, srtDests, ristDests } = classified;

      const totalDests = rtmpDests.length + srtDests.length + ristDests.length;
      console.log(`Streaming to ${totalDests} destinations (RTMP: ${rtmpDests.length}, SRT: ${srtDests.length}, RIST: ${ristDests.length})`);
      socket.emit('server-log', { message: `Initializing FFmpeg for ${totalDests} destinations...`, type: 'info' });

      inputStream = new PassThrough();
      backpressureActive = false;

      inputStream.on('drain', () => {
        backpressureActive = false;
      });

      // Initialize destination health as connected
      for (const dest of destinations) {
        const url = dest.rtmpUrl || dest.url || '';
        const health: DestinationHealth = { url, status: 'connected' };
        destinationHealthMap.set(url, health);
        socket.emit('destination-status', health);
      }

      // Check if browser is sending MediaRecorder H.264 (can be copied without re-encoding)
      const browserH264 = data.browserH264 === true;
      const transportMode = data.transportMode || (browserH264 ? 'mediarecorder-h264' : 'mediarecorder-webm');
      const disableSyntheticAudio = data.disableSyntheticAudio === true;
      const outputArgs = buildOutputArgs(rtmpDests, srtDests, ristDests);
      lastFFmpegStartupIssue = null;

      if (transportMode === 'mediarecorder-h264') {
        // ═══════════════════════════════════════════════════════════════
        // H.264 CODEC COPY PATH
        //
        // Chrome sends fMP4 (fragmented MP4) from MediaRecorder.
        // FFmpeg's MP4 demuxer crashes reading fMP4 from pipe (it seeks).
        //
        // Fix: Parse fMP4 in Node.js → extract raw H.264 NAL units
        // (Annex B) → feed to FFmpeg as -f h264. The raw H.264 parser
        // is simple and works perfectly with pipes.
        //
        // Pipeline: fMP4 chunks → FMP4Demuxer → Annex B H.264 → FFmpeg
        //           → codec copy to FLV → RTMP (zero CPU encoding)
        // ═══════════════════════════════════════════════════════════════
        console.log('[stream] Browser sent H.264 — using fMP4 demuxer + codec copy (zero CPU)');
        socket.emit('server-log', { message: 'Using codec copy — zero CPU encoding', type: 'success' });

        // Create fMP4 demuxer (with cached SPS/PPS for watchdog restarts)
        fmp4Demuxer = new FMP4Demuxer(cachedSPS, cachedPPS);
        fmp4Demuxer.on('codec-data', (data: { sps: Buffer; pps: Buffer }) => {
          cachedSPS = data.sps;
          cachedPPS = data.pps;
        });

        const args = [
          '-y', '-hide_banner', '-loglevel', 'warning',
          '-fflags', '+genpts+discardcorrupt+nobuffer',
          '-thread_queue_size', '4096',
          '-f', 'h264',
          '-framerate', '30',
          '-i', 'pipe:0',
          ...(disableSyntheticAudio ? [] : ['-f', 'lavfi', '-i', 'anullsrc=r=44100:cl=stereo']),
          '-map', '0:v:0',
          ...(disableSyntheticAudio ? [] : ['-map', '1:a:0']),
          '-c:v', 'copy',
          ...(disableSyntheticAudio ? ['-an'] : ['-c:a', 'aac', '-b:a', '128k', '-ar', '44100', '-shortest']),
          '-max_interleave_delta', '0',
          '-flags', '+global_header',
          '-flvflags', 'no_duration_filesize',
          ...outputArgs,
        ];

        if (disableSyntheticAudio) {
          socket.emit('server-log', { message: 'Streaming without synthetic audio track fallback', type: 'warning' });
        }

        console.log(`FFmpeg command: ${resolvedFFmpegPath} ${args.join(' ')}`);
        socket.emit('server-log', { message: 'FFmpeg started (H.264 codec copy via fMP4 demuxer)', type: 'success' });

        const proc = spawn(resolvedFFmpegPath, args, {
          stdio: ['pipe', 'ignore', 'pipe'],
        });

        // Pipeline: inputStream → fMP4Demuxer → FFmpeg stdin
        // fMP4Demuxer converts fragmented MP4 to raw H.264 Annex B
        inputStream.pipe(fmp4Demuxer).pipe(proc.stdin!);

        proc.stdin!.on('error', (err) => {
          if ((err as any).code !== 'EPIPE') {
            console.error('FFmpeg stdin error:', err.message);
          }
        });

        fmp4Demuxer.on('error', (err) => {
          console.error('[fMP4] Demuxer error:', err.message);
        });

        attachFFmpegHandlers(proc);
        ffmpegProcess = proc;

        if (srtDests.length > 0) socket.emit('server-log', { message: `SRT: ${srtDests.length} destination(s) connected`, type: 'info' });
        if (ristDests.length > 0) socket.emit('server-log', { message: `RIST: ${ristDests.length} destination(s) connected`, type: 'info' });

      } else {
        const profile = getReencodeProfile(encodingProfile);
        console.log(`[stream] Browser transport requires server re-encode (${profile.scale} @ ${profile.fps}fps)`);
        socket.emit('server-log', {
          message: `Re-encoding browser stream to H.264 (${profile.scale} @ ${profile.fps}fps)`,
          type: 'warning',
        });

        const args = [
          '-y', '-hide_banner', '-loglevel', 'warning',
          '-fflags', '+genpts+discardcorrupt+nobuffer',
          '-thread_queue_size', '4096',
          '-f', 'webm',
          '-i', 'pipe:0',
          ...(disableSyntheticAudio ? [] : ['-f', 'lavfi', '-i', 'anullsrc=r=44100:cl=stereo']),
          '-map', '0:v:0',
          ...(disableSyntheticAudio ? [] : ['-map', '1:a:0']),
          '-c:v', 'libx264',
          '-preset', 'superfast',
          '-tune', 'zerolatency',
          '-pix_fmt', 'yuv420p',
          '-vf', `scale=${profile.scale}`,
          '-r', String(profile.fps),
          '-g', String(profile.fps * 2),
          '-keyint_min', String(profile.fps * 2),
          '-sc_threshold', '0',
          '-b:v', profile.bitrate,
          '-maxrate', profile.maxrate,
          '-bufsize', profile.bufsize,
          '-profile:v', 'high',
          ...(disableSyntheticAudio ? ['-an'] : ['-c:a', 'aac', '-b:a', '128k', '-ar', '44100', '-shortest']),
          '-max_interleave_delta', '0',
          '-flags', '+global_header',
          '-flvflags', 'no_duration_filesize',
          ...outputArgs,
        ];

        if (disableSyntheticAudio) {
          socket.emit('server-log', { message: 'Re-encode fallback running without synthetic audio track', type: 'warning' });
        }

        console.log(`FFmpeg command: ${resolvedFFmpegPath} ${args.join(' ')}`);
        socket.emit('server-log', { message: 'FFmpeg started (browser re-encode path)', type: 'success' });

        const proc = spawn(resolvedFFmpegPath, args, {
          stdio: ['pipe', 'ignore', 'pipe'],
        });

        inputStream.pipe(proc.stdin!);
        proc.stdin!.on('error', (err) => {
          if ((err as any).code !== 'EPIPE') {
            console.error('FFmpeg stdin error:', err.message);
          }
        });

        attachFFmpegHandlers(proc);
        ffmpegProcess = proc;

        if (srtDests.length > 0) socket.emit('server-log', { message: `SRT: ${srtDests.length} destination(s) connected`, type: 'info' });
        if (ristDests.length > 0) socket.emit('server-log', { message: `RIST: ${ristDests.length} destination(s) connected`, type: 'info' });
      }

      return true;
    }

    // ── FFmpeg Watchdog: restart logic ────────────────────────────────────
    let lastFFmpegSpawnTime = 0;

    function attemptRestart() {
      if (!lastStartData || intentionallyStopped) return;
      if (ffmpegProcess) return;

      const now = Date.now();

      // Don't restart if FFmpeg ran for less than 5 seconds — indicates a config error, not a transient crash
      if (lastFFmpegSpawnTime > 0 && (now - lastFFmpegSpawnTime) < 5_000) {
        if (lastFFmpegStartupIssue === 'missing-lavfi' && !lastStartData.disableSyntheticAudio) {
          const retryData: StartStreamData = {
            ...lastStartData,
            disableSyntheticAudio: true,
          };
          lastStartData = retryData;
          lastFFmpegStartupIssue = null;
          socket.emit('server-log', {
            message: 'FFmpeg is missing lavfi support — retrying without synthetic audio fallback',
            type: 'warning',
          });
          destroyActivePipeline(true);
          lastFFmpegSpawnTime = Date.now();
          lastChunkTime = Date.now();
          if (spawnFFmpeg(retryData)) {
            socket.emit('stream-recovered', { attempt: 'lavfi-fallback', timestamp: Date.now() });
          } else {
            const failMsg = 'FFmpeg restart failed after disabling synthetic audio fallback';
            socket.emit('server-log', { message: failMsg, type: 'error' });
            socket.emit('stream-failed', { message: failMsg });
            if (currentSession) currentSession.errors.push({ time: Date.now(), message: failMsg });
            finalizeSession();
          }
          return;
        }

        const msg = 'FFmpeg died within 5s of starting — likely a config error, not restarting';
        console.error(msg);
        socket.emit('server-log', { message: msg, type: 'error' });
        socket.emit('stream-failed', { message: msg });
        if (currentSession) currentSession.errors.push({ time: now, message: msg });
        finalizeSession();
        return;
      }

      // Prune restart timestamps outside the window
      restartTimestamps = restartTimestamps.filter(t => now - t < RESTART_WINDOW_MS);

      if (restartTimestamps.length >= RESTART_LIMIT) {
        const cooldownMsg = `FFmpeg restart limit reached (${RESTART_LIMIT} in ${RESTART_WINDOW_MS / 1000}s). Waiting ${COOLDOWN_RESTART_DELAY_MS / 1000}s before one final recovery attempt...`;
        console.warn(cooldownMsg);
        socket.emit('server-log', { message: cooldownMsg, type: 'warning' });
        if (currentSession) currentSession.errors.push({ time: now, message: cooldownMsg });

        // After cooldown, clear the restart window and try once more before giving up
        setTimeout(() => {
          if (intentionallyStopped || !lastStartData) return;
          restartTimestamps = [];
          destroyActivePipeline(true);
          lastFFmpegSpawnTime = Date.now();
          lastChunkTime = Date.now();
          const success = spawnFFmpeg(lastStartData);
          if (success) {
            socket.emit('server-log', { message: 'FFmpeg recovered after cooldown restart', type: 'success' });
            socket.emit('stream-recovered', { attempt: 'cooldown', timestamp: Date.now() });
          } else {
            const failMsg = 'FFmpeg cooldown restart failed — stream stopped';
            console.error(failMsg);
            socket.emit('server-log', { message: failMsg, type: 'error' });
            socket.emit('stream-failed', { message: failMsg });
            if (currentSession) currentSession.errors.push({ time: Date.now(), message: failMsg });
            finalizeSession();
          }
        }, COOLDOWN_RESTART_DELAY_MS);
        return;
      }

      restartTimestamps.push(now);
      const attemptNum = restartTimestamps.length;
      const msg = `FFmpeg crashed after ${Math.round((now - lastFFmpegSpawnTime) / 1000)}s — attempting restart ${attemptNum}/${RESTART_LIMIT}`;
      console.log(msg);
      socket.emit('server-log', { message: msg, type: 'warning' });
      if (currentSession) {
        currentSession.ffmpegRestarts++;
        currentSession.errors.push({ time: now, message: msg });
      }

      // Wait 3 seconds before respawning (gives the system time to release resources)
      setTimeout(() => {
        if (intentionallyStopped || !lastStartData) return;

        destroyActivePipeline(true);
        lastFFmpegSpawnTime = Date.now();
        lastChunkTime = Date.now(); // Reset so heartbeat doesn't trigger immediately
        const success = spawnFFmpeg(lastStartData);
        if (success) {
          console.log('FFmpeg recovered successfully');
          socket.emit('server-log', { message: 'FFmpeg recovered successfully', type: 'success' });
          socket.emit('stream-recovered', { attempt: attemptNum, timestamp: Date.now() });
        } else {
          const failMsg = 'FFmpeg restart failed — could not respawn';
          console.error(failMsg);
          socket.emit('server-log', { message: failMsg, type: 'error' });
          socket.emit('stream-failed', { message: failMsg });
          if (currentSession) currentSession.errors.push({ time: Date.now(), message: failMsg });
          finalizeSession();
        }
      }, 3000);
    }

    socket.on("join-room", (roomId) => {
      // Validate room ID format
      if (!isValidRoomId(roomId)) {
        socket.emit('server-log', { message: 'Invalid room ID', type: 'error' });
        return;
      }
      const normalizedRoomId = resolveRoomId(roomId);
      socket.join(normalizedRoomId);
      console.log(`User ${socket.id} joined room ${normalizedRoomId}`);
      socket.to(normalizedRoomId).emit("user-joined", socket.id);
    });

    socket.on("signal", (data) => {
      if (data.to) {
        io.to(data.to).emit("signal", { from: socket.id, signal: data.signal });
      } else if (isValidRoomId(data.roomId)) {
        const normalizedRoomId = resolveRoomId(data.roomId);
        socket.to(normalizedRoomId).emit("signal", { from: socket.id, signal: data.signal });
      }
    });

    // ── Multi-Protocol Streaming (RTMP + SRT + RIST) ─────────────────────────
    socket.on("start-stream", (data: any) => {
      const { destinations, encodingProfile } = data;
      if (!destinations || !Array.isArray(destinations) || destinations.length === 0) {
        socket.emit('server-log', { message: 'No destinations provided', type: 'error' });
        return;
      }

      // Reset watchdog state for new stream
      intentionallyStopped = false;
      restartTimestamps = [];
      slowSpeedCount = 0;
      lastStatsEmit = 0;
      backpressureActive = false;
      lastRefreshRequestAt = 0;
      destinationHealthMap.clear();

      // Store config for watchdog restarts — include browserH264 and mimeType so
      // restarts use the same codec path
      lastStartData = {
        destinations,
        encodingProfile: encodingProfile || '1080p60',
        browserH264: data.browserH264,
        mimeType: data.mimeType,
        transportMode: data.transportMode,
        disableSyntheticAudio: data.disableSyntheticAudio,
      };

      const replacingActivePipeline = !!ffmpegProcess || !!inputStream || !!fmp4Demuxer;
      if (replacingActivePipeline) {
        socket.emit('server-log', { message: 'Refreshing FFmpeg pipeline for browser transport restart...', type: 'info' });
        if (currentSession) {
          currentSession.destinations = destinations.map((d: any) => d.rtmpUrl || d.url || '');
          currentSession.encodingProfile = encodingProfile || '1080p60';
        }
        destroyActivePipeline(true);
      } else {
        currentSession = {
          id: crypto.randomUUID(),
          startTime: Date.now(),
          destinations: destinations.map((d: any) => d.rtmpUrl || d.url || ''),
          encodingProfile: encodingProfile || '1080p60',
          totalFramesSent: 0,
          totalBytesReceived: 0,
          droppedFrames: 0,
          ffmpegRestarts: 0,
          errors: [],
        };
      }

      lastFFmpegSpawnTime = Date.now();
      if (!spawnFFmpeg(lastStartData)) {
        socket.emit('stream-failed', { message: 'Unable to initialize FFmpeg with the current destinations' });
        finalizeSession();
        return;
      }

      // Start heartbeat monitor — checks for chunk stalls AND FFmpeg process liveness.
      lastChunkTime = Date.now();
      let lastHeartbeatWarn = 0;
      let lastLivenessCheck = Date.now();
      clearHeartbeat();
      heartbeatInterval = setInterval(() => {
        if (intentionallyStopped) return;
        const now = Date.now();

        // ── Chunk stall detection (browser path) ─────────────────────────
        if (ffmpegProcess && lastChunkTime) {
          const elapsed = now - lastChunkTime;
          if (elapsed > 6_000 && (now - lastRefreshRequestAt) > 12_000) {
            lastRefreshRequestAt = now;
            socket.emit('server-log', { message: 'No browser chunks received for 6s — requesting transport refresh', type: 'warning' });
            socket.emit('stream-refresh-request', { reason: 'server-chunk-stall', elapsedMs: elapsed });
          }
          if (elapsed > 10_000 && (now - lastHeartbeatWarn) > 30_000) {
            socket.emit('server-log', { message: 'Warning: No chunks received for 10s — stream may be stalled', type: 'warning' });
            lastHeartbeatWarn = now;
          }
        }

        // ── FFmpeg process liveness check (every 15s) ─────────────────────
        // Catches silent stalls where the process dies but no exit event fires
        if (now - lastLivenessCheck >= 15_000) {
          lastLivenessCheck = now;
          if (ffmpegProcess) {
            const proc = ffmpegProcess;
            const dead = proc.exitCode !== null || proc.killed || proc.stdin?.writable === false;
            if (dead) {
              socket.emit('server-log', { message: 'FFmpeg liveness check: process is dead — triggering recovery', type: 'warning' });
              clearCurrentPipelineState();
              if (!intentionallyStopped && lastStartData) {
                attemptRestart();
              }
            }
          }
        }
      }, 3_000);
    });

    socket.on("audience-message", (data, callback) => {
      try {
        // Rate limit audience messages
        if (!messageLimiter.isAllowed(socket.id)) {
          if (typeof callback === 'function') callback({ ok: false, error: 'Rate limited' });
          return;
        }

        if (isValidRoomId(data.roomId)) {
          const normalizedRoomId = resolveRoomId(data.roomId);
          // Sanitize message fields before relaying
          const sanitizedMessage = {
            ...data.message,
            id: data.message.id,
            author: sanitizeText(data.message.author || 'Anonymous', 50),
            text: sanitizeText(data.message.text || '', 500),
            type: ['Q&A', 'Prayer', 'Testimony', 'Welcome', 'Poll'].includes(data.message.type)
              ? data.message.type
              : 'Q&A',
            timestamp: data.message.timestamp,
            visible: false,
          };
          socket.to(normalizedRoomId).emit("audience-message", sanitizedMessage);
        } else {
          if (typeof callback === 'function') callback({ ok: false, error: 'Invalid room ID' });
          return;
        }
        if (typeof callback === 'function') callback({ ok: true });
      } catch (e) {
        if (typeof callback === 'function') callback({ ok: false });
      }
    });

    let lastBackpressureLog = 0;
    let backpressureDropCount = 0;

    socket.on("stream-chunk", (data) => {
      // Rate limit stream chunks
      if (!chunkLimiter.isAllowed(socket.id)) return;

      // Track last chunk arrival for heartbeat
      lastChunkTime = Date.now();
      lastRefreshRequestAt = 0;

      if (inputStream && data.chunk) {
        // data.chunk can be ArrayBuffer, Buffer, or Blob — normalize to Buffer
        const chunk = Buffer.isBuffer(data.chunk) ? data.chunk : Buffer.from(data.chunk);

        // Track bytes received in session
        if (currentSession) {
          currentSession.totalBytesReceived += chunk.length;
          currentSession.totalFramesSent++;
        }

        // Backpressure check: if drain hasn't fired yet, skip writes
        if (backpressureActive || inputStream.writableLength > 5 * 1024 * 1024) {
          if (currentSession) currentSession.droppedFrames++;
          backpressureDropCount++;
          // Only log backpressure once per 10 seconds to avoid flooding
          const now = Date.now();
          if (now - lastBackpressureLog > 10_000) {
            const bufMB = inputStream.writableLength / (1024 * 1024);
            socket.emit('server-log', {
              message: `Backpressure: dropped ${backpressureDropCount} frames (buffer: ${bufMB.toFixed(1)}MB)`,
              type: 'warning'
            });
            lastBackpressureLog = now;
            backpressureDropCount = 0;
          }
          return;
        }

        // Write and watch for backpressure signal
        const canContinue = inputStream.write(chunk);
        if (!canContinue) {
          backpressureActive = true;
        }
      }
    });

    function killFFmpeg() {
      destroyActivePipeline(true);
    }

    // ── High-bitrate local recording pipeline ──────────────────────────────
    // Separate from the stream pipeline — records to disk at full quality
    // without re-encoding. Uses H.264 codec copy when browser sends H.264.

    let recordingProcess: ChildProcess | null = null;
    let recordingStream: PassThrough | null = null;
    let recordingDemuxer: FMP4Demuxer | null = null;
    let recordingPath: string | null = null;

    type StartRecordingData = {
      outputDir?: string;
      quality?: 'high' | 'medium';
      browserH264?: boolean;
    };

    function stopRecordingPipeline(planned = true) {
      if (recordingProcess?.pid && planned) ignoredExitPids.add(recordingProcess.pid);
      try { recordingProcess?.stdin?.destroy(); } catch { /* best effort */ }
      try { recordingProcess?.kill('SIGINT'); } catch { /* best effort */ }
      if (recordingProcess) {
        setTimeout(() => {
          try {
            if (recordingProcess && recordingProcess.exitCode == null && !recordingProcess.killed) {
              recordingProcess.kill('SIGKILL');
            }
          } catch { /* best effort */ }
        }, 2000);
      }
      recordingDemuxer?.destroy();
      recordingStream?.destroy();
      recordingProcess = null;
      recordingStream = null;
      recordingDemuxer = null;
    }

    socket.on("start-recording", (data: StartRecordingData) => {
      if (recordingProcess) {
        socket.emit('server-log', { message: 'Recording already in progress', type: 'warning' });
        return;
      }

      const outputDir = (typeof data.outputDir === 'string' && data.outputDir)
        ? data.outputDir
        : path.join(os.homedir(), 'Videos', 'AetherCast');

      try { fs.mkdirSync(outputDir, { recursive: true }); } catch { /* exists */ }

      const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
      const filename = `aether-recording-${timestamp}.mp4`;
      recordingPath = path.join(outputDir, filename);

      const browserH264 = data.browserH264 === true;
      recordingStream = new PassThrough();

      let args: string[];

      if (browserH264) {
        // Codec copy: fMP4 → Annex B → H.264 → MP4 file (zero CPU, original quality)
        recordingDemuxer = new FMP4Demuxer(cachedSPS, cachedPPS);
        recordingDemuxer.on('codec-data', (d: { sps: Buffer; pps: Buffer }) => {
          cachedSPS = d.sps; cachedPPS = d.pps;
        });

        args = [
          '-y', '-hide_banner', '-loglevel', 'warning',
          '-fflags', '+genpts+discardcorrupt+nobuffer',
          '-f', 'h264', '-framerate', '30', '-i', 'pipe:0',
          '-c:v', 'copy', '-an',
          '-movflags', '+faststart',
          recordingPath,
        ];
      } else {
        // Re-encode path: high quality libx264 CRF recording
        const crf = data.quality === 'medium' ? '23' : '18';
        args = [
          '-y', '-hide_banner', '-loglevel', 'warning',
          '-fflags', '+genpts+discardcorrupt+nobuffer',
          '-f', 'webm', '-i', 'pipe:0',
          '-c:v', 'libx264', '-crf', crf, '-preset', 'fast',
          '-pix_fmt', 'yuv420p', '-an',
          '-movflags', '+faststart',
          recordingPath,
        ];
      }

      const proc = spawn(resolvedFFmpegPath, args, { stdio: ['pipe', 'ignore', 'pipe'] });

      if (browserH264 && recordingDemuxer) {
        recordingStream.pipe(recordingDemuxer).pipe(proc.stdin!);
      } else {
        recordingStream.pipe(proc.stdin!);
      }

      proc.stdin!.on('error', (err) => {
        if ((err as any).code !== 'EPIPE') console.error('Recording stdin error:', err.message);
      });

      proc.stderr?.on('data', (d: Buffer) => {
        const line = d.toString().trim();
        if (line && !line.startsWith('frame=') && !line.startsWith('size=')) {
          socket.emit('server-log', { message: `[rec] ${line}`, type: 'ffmpeg' });
        }
      });

      proc.on('error', (err) => {
        socket.emit('server-log', { message: `Recording error: ${err.message}`, type: 'error' });
        recordingProcess = null; recordingStream = null; recordingDemuxer = null;
      });

      proc.on('exit', (code) => {
        const planned = proc.pid != null && ignoredExitPids.delete(proc.pid);
        if (!planned) {
          socket.emit('server-log', { message: `Recording ended (code ${code})`, type: code === 0 ? 'info' : 'warning' });
        }
        if (recordingPath) {
          socket.emit('recording-saved', { path: recordingPath, filename });
        }
        recordingProcess = null; recordingStream = null; recordingDemuxer = null; recordingPath = null;
      });

      recordingProcess = proc;
      socket.emit('server-log', { message: `Recording started → ${filename}`, type: 'success' });
      socket.emit('recording-started', { path: recordingPath, filename });
    });

    socket.on("recording-chunk", (data: { chunk: unknown }) => {
      if (!recordingStream || !data.chunk) return;
      const chunk = Buffer.isBuffer(data.chunk) ? data.chunk : Buffer.from(data.chunk as ArrayBuffer);
      recordingStream.write(chunk);
    });

    socket.on("stop-recording", () => {
      if (!recordingProcess) {
        socket.emit('server-log', { message: 'No recording in progress', type: 'warning' });
        return;
      }
      stopRecordingPipeline(true);
      socket.emit('server-log', { message: 'Recording stopped', type: 'info' });
    });

    socket.on("stop-stream", () => {
      intentionallyStopped = true;
      clearHeartbeat();
      killFFmpeg();
      console.log('Streaming stopped');
      finalizeSession();
    });

    socket.on("disconnect", () => {
      console.log("User disconnected:", socket.id);
      messageLimiter.remove(socket.id);
      chunkLimiter.remove(socket.id);
      intentionallyStopped = true;
      clearHeartbeat();
      killFFmpeg();
      stopRecordingPipeline(true);
      finalizeSession();
    });
  });

  // ──────────────────────────────────────────────────────────────────────────────
  // Android App Links verification — allows the AetherCast APK to intercept
  // QR code links directly (no "Open with Chrome/AetherCast" chooser dialog).
  // Android fetches this file when the APK is installed to verify ownership.
  // Replace the sha256_cert_fingerprints value with your APK's release signing
  // certificate fingerprint (Android Studio → Build → Generate Signed APK,
  // then: keytool -list -v -keystore your.keystore | grep SHA256)
  // ──────────────────────────────────────────────────────────────────────────────

  app.get('/.well-known/assetlinks.json', (_req, res) => {
    const fingerprint = process.env.APK_CERT_FINGERPRINT;
    if (!fingerprint || fingerprint === 'REPLACE_WITH_YOUR_SHA256_CERT_FINGERPRINT') {
      console.warn('[assetlinks] APK_CERT_FINGERPRINT env var is not set — Android App Links will not verify correctly in production.');
    }
    res.json([{
      relation: ['delegate_permission/common.handle_all_urls'],
      target: {
        namespace: 'android_app',
        package_name: 'com.selton.studio',
        sha256_cert_fingerprints: fingerprint ? [fingerprint] : [],
      },
    }]);
  });

  app.get('/health', (_req, res) => {
    res.status(200).json({
      ok: true,
      service: 'aethercast',
      timestamp: new Date().toISOString(),
    });
  });

  // ──────────────────────────────────────────────────────────────────────────────
  // Local network IP — used by QR modal so phones can reach this server
  // ──────────────────────────────────────────────────────────────────────────────

  app.get('/api/local-ip', (_req, res) => {
    // Always compute LAN IP so WebRTC camera/screen QR codes always use it.
    // (WebRTC signalling requires phone and Studio on the same Socket.io server —
    //  that server is always the local machine, so camera/screen must use LAN IP.)
    // PUBLIC_URL is only used for the Audience Portal (HTTP, no WebRTC).
    const nets = os.networkInterfaces();
    let localIp = '127.0.0.1';
    for (const iface of Object.values(nets)) {
      for (const alias of iface ?? []) {
        if (alias.family === 'IPv4' && !alias.internal) {
          localIp = alias.address;
          break;
        }
      }
      if (localIp !== '127.0.0.1') break;
    }
    const lanUrl = `http://${localIp}:${PORT}`;
    const publicUrl = process.env.PUBLIC_URL || null;
    res.json({ ip: localIp, port: PORT, lanUrl, publicUrl });
  });

  // ── AI endpoints (Gemini — keeps API key out of browser bundle) ─────────────
  app.use('/api/ai', createAiRouter());

  // ── Lumina Presenter Bridge ───────────────────────────────────────────────────
  const luminaRoomLastPing = new Map<string, number>();
  app.use('/api/lumina', createLuminaRouter(io, luminaRoomLastPing));

  // ──────────────────────────────────────────────────────────────────────────────
  // Vite / static serving
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        hmr: false
      },
      appType: "spa",
    });

    app.use(vite.middlewares);

    // Serve index.html for all non-API routes in dev
    app.use('*', async (req, res, next) => {
      const url = req.originalUrl;
      console.log(`Server: Handling request for ${url}`);
      try {
        const indexPath = path.resolve(__dirname, 'index.html');
        console.log(`Server: Reading index.html from ${indexPath}`);
        let template = fs.readFileSync(indexPath, 'utf-8');
        template = await vite.transformIndexHtml(url, template);
        res.status(200).set({ 'Content-Type': 'text/html' }).end(template);
      } catch (e) {
        console.error(`Server: Error serving index.html:`, e);
        vite.ssrFixStacktrace(e as Error);
        next(e);
      }
    });
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  httpServer.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
