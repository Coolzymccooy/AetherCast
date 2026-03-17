import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";
import { createServer as createViteServer } from "vite";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import ffmpeg from "fluent-ffmpeg";
import { PassThrough } from "stream";
import crypto from "crypto";
import dotenv from "dotenv";

dotenv.config();

// ── Set FFmpeg path explicitly so it works without restarting the terminal ───
const FFMPEG_PATHS = [
  'C:\\ffmpeg\\ffmpeg-8.0.1-essentials_build\\bin\\ffmpeg.exe',
  'C:\\ffmpeg\\bin\\ffmpeg.exe',
  '/usr/local/bin/ffmpeg',
  '/usr/bin/ffmpeg',
];
for (const p of FFMPEG_PATHS) {
  if (fs.existsSync(p)) {
    ffmpeg.setFfmpegPath(p);
    console.log(`FFmpeg found at: ${p}`);
    break;
  }
}
// Also check PATH as fallback (works if terminal was restarted after install)

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ──────────────────────────────────────────────────────────────────────────────
// Security helpers
// ──────────────────────────────────────────────────────────────────────────────

/** Simple token for Socket.io auth — set SOCKET_AUTH_TOKEN in .env or auto-generate */
const SOCKET_AUTH_TOKEN = process.env.SOCKET_AUTH_TOKEN || crypto.randomUUID();

/** Allowed origins for CORS — allow all origins to support Tauri desktop + web */
const ALLOWED_ORIGINS = "*";

/** Sanitize user-supplied strings to prevent injection */
function sanitizeText(input: string, maxLength = 500): string {
  if (typeof input !== 'string') return '';
  return input
    .slice(0, maxLength)
    .replace(/[<>&"']/g, (c) => {
      const map: Record<string, string> = { '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&#x27;' };
      return map[c] || c;
    });
}

// Note: sanitize logic is also available as a shared module at src/lib/sanitize.ts for client-side use

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
const chunkLimiter = new RateLimiter(1_000, 10);    // 10 chunks per second

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

async function startServer() {
  const app = express();
  app.use(express.json({ limit: '1mb' }));
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
    let ffmpegProcess: any = null;
    let inputStream: PassThrough | null = null;

    // ── Stream Session State ──────────────────────────────────────────────
    let currentSession: StreamSession | null = null;
    let lastStartData: { destinations: any[]; encodingProfile: string } | null = null;
    let destinationHealthMap: Map<string, DestinationHealth> = new Map();

    // ── Backpressure State ────────────────────────────────────────────────
    let backpressureActive = false;

    // ── Heartbeat State ──────────────────────────────────────────────────
    let lastChunkTime = 0;
    let heartbeatInterval: ReturnType<typeof setInterval> | null = null;

    // ── FFmpeg Watchdog State ─────────────────────────────────────────────
    const RESTART_LIMIT = 5;
    const RESTART_WINDOW_MS = 60_000;
    let restartTimestamps: number[] = [];
    let intentionallyStopped = false;

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

    // ── Helper: parse FFmpeg stderr line ──────────────────────────────────
    function parseStderrLine(line: string) {
      if (!currentSession) return;

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

    // ── Helper: spawn FFmpeg with current config ─────────────────────────
    function spawnFFmpeg(data: { destinations: any[]; encodingProfile: string }) {
      const { destinations, encodingProfile } = data;

      // Validate and classify destinations by protocol
      const rtmpDests: any[] = [];
      const srtDests: any[] = [];
      const ristDests: any[] = [];

      for (const dest of destinations) {
        const url = dest.rtmpUrl || dest.url || '';
        if (typeof url !== 'string' || !url) {
          socket.emit('server-log', { message: `Invalid destination: missing URL`, type: 'error' });
          return false;
        }
        if (/^rtmps?:\/\//.test(url)) {
          if (!dest.streamKey || typeof dest.streamKey !== 'string') {
            socket.emit('server-log', { message: `RTMP destination "${dest.name}" missing stream key`, type: 'error' });
            return false;
          }
          rtmpDests.push(dest);
        } else if (/^srt:\/\//.test(url)) {
          srtDests.push(dest);
        } else if (/^rist:\/\//.test(url)) {
          ristDests.push(dest);
        } else {
          socket.emit('server-log', { message: `Unsupported protocol in URL: ${url.substring(0, 30)}`, type: 'error' });
          return false;
        }
      }

      const totalDests = rtmpDests.length + srtDests.length + ristDests.length;
      console.log(`Streaming to ${totalDests} destinations (RTMP: ${rtmpDests.length}, SRT: ${srtDests.length}, RIST: ${ristDests.length})`);
      socket.emit('server-log', { message: `Initializing FFmpeg for ${totalDests} destinations...`, type: 'info' });

      inputStream = new PassThrough();
      backpressureActive = false;

      // Wire up drain event for backpressure release
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

      // Select encoding profile
      const profile = encodingProfile || '1080p60';
      const profiles: Record<string, string[]> = {
        '1080p60': [
          '-preset veryfast', '-tune zerolatency', '-threads 0',
          '-g 120', '-keyint_min 120', '-sc_threshold 0',
          '-b:v 6000k', '-maxrate 6000k', '-bufsize 12000k',
          '-pix_fmt yuv420p', '-profile:v high', '-level 4.2',
          '-r 60', '-b:a 160k', '-ar 44100'
        ],
        '1080p30': [
          '-preset veryfast', '-tune zerolatency', '-threads 0',
          '-g 60', '-keyint_min 60', '-sc_threshold 0',
          '-b:v 4500k', '-maxrate 4500k', '-bufsize 9000k',
          '-pix_fmt yuv420p', '-profile:v high', '-level 4.1',
          '-r 30', '-b:a 160k', '-ar 44100'
        ],
        '720p30': [
          '-preset veryfast', '-tune zerolatency', '-threads 0',
          '-g 60', '-keyint_min 60', '-sc_threshold 0',
          '-b:v 2500k', '-maxrate 2500k', '-bufsize 5000k',
          '-pix_fmt yuv420p', '-profile:v main', '-level 3.1',
          '-vf scale=1280:720', '-r 30', '-b:a 128k', '-ar 44100'
        ],
        '480p30': [
          '-preset veryfast', '-tune zerolatency', '-threads 0',
          '-g 60', '-keyint_min 60', '-sc_threshold 0',
          '-b:v 1000k', '-maxrate 1000k', '-bufsize 2000k',
          '-pix_fmt yuv420p', '-profile:v baseline', '-level 3.0',
          '-vf scale=854:480', '-r 30', '-b:a 96k', '-ar 44100'
        ],
      };
      const encOpts = profiles[profile] || profiles['1080p60'];

      // Check if browser is sending H.264 (can be copied without re-encoding)
      const browserH264 = (data as any).browserH264 === true;
      const inputMime = (data as any).mimeType || 'video/webm';
      const inputFormat = inputMime.startsWith('video/mp4') ? 'mp4' : 'webm';

      let command;

      if (browserH264) {
        // H.264 from browser — COPY the video codec (zero CPU cost!)
        console.log('[stream] Browser sent H.264 — using codec copy (zero CPU)');
        socket.emit('server-log', { message: 'Using codec copy — zero CPU encoding', type: 'success' });

        command = ffmpeg(inputStream)
          .inputFormat(inputFormat)
          .videoCodec('copy')  // No re-encoding! Just remux to FLV
          .noAudio()
          .outputOptions(['-flvflags no_duration_filesize']);
      } else {
        // VP8 from browser — must re-encode to H.264 for RTMP
        // Use absolute minimum settings to prevent server CPU overload
        console.log('[stream] Browser sent VP8 — re-encoding to H.264 (CPU intensive)');
        socket.emit('server-log', { message: 'Re-encoding VP8→H.264 (CPU intensive)', type: 'warning' });

        command = ffmpeg(inputStream)
          .inputFormat('webm')
          .videoCodec('libx264')
          .noAudio()
          .outputOptions([
            '-preset ultrafast',
            '-tune zerolatency',
            '-pix_fmt yuv420p',
            '-vf scale=854:480',    // 480p — the only resolution this server can encode in realtime
            '-r 15',                // 15fps — half the frames
            '-g 30',                // Keyframe every 2s at 15fps
            '-b:v 1000k',           // 1 Mbps at 480p
            '-maxrate 1200k',
            '-bufsize 2000k',
            '-threads 1',
            '-profile:v baseline',
          ]);
      }

      // Build tee output string for multi-destination
      const teeSegments: string[] = [];

      // RTMP destinations
      for (const dest of rtmpDests) {
        const url = `${(dest.rtmpUrl || dest.url).replace(/\/$/, '')}/${dest.streamKey}`;
        teeSegments.push(`[f=flv:onfail=ignore]${url}`);
      }

      // SRT destinations — uses MPEG-TS over SRT
      for (const dest of srtDests) {
        let srtUrl = dest.url || dest.rtmpUrl;
        // Append SRT options if not already present
        if (!srtUrl.includes('mode=')) {
          srtUrl += (srtUrl.includes('?') ? '&' : '?') + 'mode=caller';
        }
        if (dest.streamKey) {
          srtUrl += `&passphrase=${dest.streamKey}`;
        }
        if (!srtUrl.includes('latency=')) {
          srtUrl += '&latency=200000'; // 200ms default latency
        }
        teeSegments.push(`[f=mpegts:onfail=ignore]${srtUrl}`);
      }

      // RIST destinations — uses MPEG-TS over RIST
      for (const dest of ristDests) {
        const ristUrl = dest.url || dest.rtmpUrl;
        teeSegments.push(`[f=mpegts:onfail=ignore]${ristUrl}`);
      }

      // For single destination: output directly (more reliable than tee muxer)
      // For multiple destinations: use tee muxer with failure isolation
      if (teeSegments.length === 1) {
        // Single destination — direct output
        const segment = teeSegments[0];
        // Parse format and URL from tee segment: [f=flv:onfail=ignore]rtmp://...
        const formatMatch = segment.match(/\[f=(\w+)/);
        const urlMatch = segment.match(/\](.+)$/);
        const format = formatMatch?.[1] || 'flv';
        const url = urlMatch?.[1] || '';

        command = command
          .format(format)
          .outputOptions(['-map 0:v', '-map 0:a?', '-flags +global_header'])
          .output(url);

        socket.emit('server-log', { message: `Direct output: ${format} → ${url.substring(0, 40)}...`, type: 'info' });
      } else {
        // Multiple destinations — use tee muxer
        const teeOutputs = teeSegments.join('|');
        command = command
          .format('tee')
          .outputOptions(['-map 0:v', '-map 0:a?', '-flags +global_header'])
          .output(teeOutputs);
      }

      ffmpegProcess = command
        .on('start', (commandLine) => {
          console.log('FFmpeg started with command: ' + commandLine);
          socket.emit('server-log', { message: 'FFmpeg started successfully', type: 'success' });
          // Log protocol breakdown
          if (srtDests.length > 0) socket.emit('server-log', { message: `SRT: ${srtDests.length} destination(s) connected`, type: 'info' });
          if (ristDests.length > 0) socket.emit('server-log', { message: `RIST: ${ristDests.length} destination(s) connected`, type: 'info' });
        })
        .on('stderr', (stderrLine: string) => {
          // Log all FFmpeg output to console for debugging
          console.log('FFmpeg:', stderrLine);
          parseStderrLine(stderrLine);
        })
        .on('error', (err: Error) => {
          console.error('FFmpeg error:', err.message);
          socket.emit('server-log', { message: `FFmpeg Error: ${err.message}`, type: 'error' });
          if (currentSession) {
            currentSession.errors.push({ time: Date.now(), message: err.message });
          }

          ffmpegProcess = null;
          if (inputStream) { inputStream.destroy(); inputStream = null; }

          // Watchdog: attempt restart if not intentionally stopped
          if (!intentionallyStopped && lastStartData) {
            attemptRestart();
          }
        })
        .on('end', () => {
          console.log('FFmpeg process ended');
          socket.emit('server-log', { message: 'FFmpeg process ended', type: 'info' });

          ffmpegProcess = null;
          if (inputStream) { inputStream.destroy(); inputStream = null; }

          // Watchdog: if not intentionally stopped, treat as unexpected death
          if (!intentionallyStopped && lastStartData) {
            attemptRestart();
          }
        });

      ffmpegProcess.run();
      return true;
    }

    // ── FFmpeg Watchdog: restart logic ────────────────────────────────────
    let lastFFmpegSpawnTime = 0;

    function attemptRestart() {
      if (!lastStartData || intentionallyStopped) return;

      const now = Date.now();

      // Don't restart if FFmpeg ran for less than 5 seconds — indicates a config error, not a transient crash
      if (lastFFmpegSpawnTime > 0 && (now - lastFFmpegSpawnTime) < 5_000) {
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
        const msg = 'FFmpeg restart limit reached, stream failed';
        console.error(msg);
        socket.emit('server-log', { message: msg, type: 'error' });
        socket.emit('stream-failed', { message: msg });
        if (currentSession) currentSession.errors.push({ time: now, message: msg });
        finalizeSession();
        return;
      }

      restartTimestamps.push(now);
      const attemptNum = restartTimestamps.length;
      const msg = `FFmpeg crashed after ${Math.round((now - lastFFmpegSpawnTime) / 1000)}s, attempting restart (${attemptNum}/${RESTART_LIMIT})...`;
      console.log(msg);
      socket.emit('server-log', { message: msg, type: 'warning' });
      if (currentSession) {
        currentSession.ffmpegRestarts++;
        currentSession.errors.push({ time: now, message: msg });
      }

      // Wait 3 seconds before respawning (gives the system time to release resources)
      setTimeout(() => {
        if (intentionallyStopped || !lastStartData) return;

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
      if (typeof roomId !== 'string' || roomId.length > 64 || !/^[\w-]+$/.test(roomId)) {
        socket.emit('server-log', { message: 'Invalid room ID', type: 'error' });
        return;
      }
      socket.join(roomId);
      console.log(`User ${socket.id} joined room ${roomId}`);
      socket.to(roomId).emit("user-joined", socket.id);
    });

    socket.on("signal", (data) => {
      if (data.to) {
        io.to(data.to).emit("signal", { from: socket.id, signal: data.signal });
      } else if (data.roomId && typeof data.roomId === 'string') {
        socket.to(data.roomId).emit("signal", { from: socket.id, signal: data.signal });
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
      destinationHealthMap.clear();

      // Store config for watchdog restarts
      lastStartData = { destinations, encodingProfile: encodingProfile || '1080p60' };

      // Initialize stream session
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

      lastFFmpegSpawnTime = Date.now();
      spawnFFmpeg(lastStartData);

      // Start heartbeat monitor — warns on chunk stalls but does NOT auto-restart
      lastChunkTime = Date.now();
      let lastHeartbeatWarn = 0;
      if (heartbeatInterval) clearInterval(heartbeatInterval);
      heartbeatInterval = setInterval(() => {
        if (!ffmpegProcess || intentionallyStopped) return;
        if (!lastChunkTime) return;
        const elapsed = Date.now() - lastChunkTime;
        const now = Date.now();
        // Only warn once per 30 seconds to avoid flooding the client
        if (elapsed > 10_000 && (now - lastHeartbeatWarn) > 30_000) {
          socket.emit('server-log', { message: 'Warning: No chunks received for 10s — stream may have stalled', type: 'warning' });
          lastHeartbeatWarn = now;
        }
      }, 10_000); // Check every 10s (was 5s)
    });

    socket.on("audience-message", (data, callback) => {
      try {
        // Rate limit audience messages
        if (!messageLimiter.isAllowed(socket.id)) {
          if (typeof callback === 'function') callback({ ok: false, error: 'Rate limited' });
          return;
        }

        if (data.roomId && typeof data.roomId === 'string') {
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
          socket.to(data.roomId).emit("audience-message", sanitizedMessage);
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

    socket.on("stop-stream", () => {
      intentionallyStopped = true;
      if (heartbeatInterval) { clearInterval(heartbeatInterval); heartbeatInterval = null; }
      if (ffmpegProcess) {
        ffmpegProcess.kill('SIGINT');
        ffmpegProcess = null;
      }
      if (inputStream) { inputStream.destroy(); inputStream = null; }
      console.log('Streaming stopped');
      finalizeSession();
    });

    socket.on("disconnect", () => {
      console.log("User disconnected:", socket.id);
      messageLimiter.remove(socket.id);
      chunkLimiter.remove(socket.id);
      intentionallyStopped = true;
      if (heartbeatInterval) { clearInterval(heartbeatInterval); heartbeatInterval = null; }
      if (ffmpegProcess) {
        ffmpegProcess.kill('SIGINT');
        ffmpegProcess = null;
      }
      if (inputStream) { inputStream.destroy(); inputStream = null; }
      finalizeSession();
    });
  });

  // ──────────────────────────────────────────────────────────────────────────────
  // AI API endpoints (server-side Gemini calls — keeps API key out of browser)
  // ──────────────────────────────────────────────────────────────────────────────

  app.post('/api/ai/background', async (req, res) => {
    const { prompt } = req.body;
    if (!prompt || typeof prompt !== 'string') return res.status(400).json({ error: 'prompt required' });

    const sanitizedPrompt = sanitizeText(prompt, 200);

    try {
      const { GoogleGenAI } = await import('@google/genai');
      const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || '' });
      const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash-image',
        contents: { parts: [{ text: `A high quality, professional studio background for a live stream. Theme: ${sanitizedPrompt}. Cinematic lighting, 4k resolution.` }] },
        config: { imageConfig: { aspectRatio: '16:9' } },
      } as any);
      const part = response.candidates?.[0]?.content?.parts?.find((p: any) => p.inlineData);
      if (!part?.inlineData) return res.status(500).json({ error: 'No image generated' });
      res.json({ imageUrl: `data:image/png;base64,${part.inlineData.data}` });
    } catch (err: any) {
      console.error('AI background error:', err.message);
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/ai/direct', async (req, res) => {
    const { activeScene, scenes, telemetry } = req.body;
    if (!activeScene || !scenes || !Array.isArray(scenes)) {
      return res.status(400).json({ error: 'activeScene and scenes required' });
    }

    const sanitizedScene = sanitizeText(String(activeScene), 50);
    const sanitizedScenes = scenes.map((s: any) => sanitizeText(String(s), 50));

    try {
      const { GoogleGenAI } = await import('@google/genai');
      const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || '' });
      const prompt = `You are a professional broadcast director.
Current Scene: ${sanitizedScene}
Available Scenes: ${sanitizedScenes.join(', ')}
Telemetry: CPU ${telemetry?.cpu ?? 'N/A'}%, Bitrate ${telemetry?.bitrate ?? 'N/A'}

Decide if we should switch scenes for viewer engagement.
If yes, respond with ONLY the target scene name from the Available Scenes list.
If no switch needed, respond with exactly: STAY`;
      const response = await ai.models.generateContent({ model: 'gemini-2.0-flash', contents: prompt });
      const decision = response.text?.trim() ?? 'STAY';
      res.json({ scene: decision });
    } catch (err: any) {
      console.error('AI director error:', err.message);
      res.status(500).json({ error: err.message });
    }
  });

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
