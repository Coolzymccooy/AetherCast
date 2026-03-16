// Ring-Buffer Instant Replay System
// Uses pre-allocated ArrayBuffer pool to minimize GC pressure during multi-hour sessions

export interface ReplayConfig {
  bufferDurationSec: number; // e.g., 300 (5 minutes)
  fps: number;               // capture fps, e.g., 30
  quality: number;           // JPEG quality 0-1
}

export interface ReplayClip {
  id: string;
  startTime: number;   // ms timestamp
  endTime: number;     // ms timestamp
  duration: number;    // ms
  frames: Blob[];      // encoded JPEG frames
  audioBlob?: Blob;    // audio recording for the clip
}

interface FrameEntry {
  data: ArrayBuffer;   // Pre-allocated buffer, reused across frames
  byteLength: number;  // Actual bytes used (may be less than data.byteLength)
  timestamp: number;   // ms
}

interface AudioChunk {
  blob: Blob;
  timestamp: number;
}

// Pre-allocated frame buffer size — 150KB covers most 1080p JPEG frames at quality 0.7
const FRAME_BUFFER_SIZE = 150 * 1024;

export class ReplayBuffer {
  private config: ReplayConfig;
  private framePool: FrameEntry[];
  private writeIndex: number = 0;
  private frameCount: number = 0;
  private maxFrames: number;

  private audioChunks: AudioChunk[] = [];
  private maxAudioChunks: number;

  private recording: boolean = false;
  private animFrameId: number | null = null;
  private lastCaptureTime: number = 0;
  private frameDuration: number;

  private canvas: HTMLCanvasElement | null = null;
  private captureCanvas: HTMLCanvasElement | null = null; // Offscreen canvas for capture
  private captureCtx: CanvasRenderingContext2D | null = null;
  private audioRecorder: MediaRecorder | null = null;

  // Stats
  private totalCapturedFrames: number = 0;
  private totalDroppedFrames: number = 0;
  private pendingCapture: boolean = false;

  constructor(config: ReplayConfig) {
    this.config = config;
    this.maxFrames = config.bufferDurationSec * config.fps;
    this.frameDuration = 1000 / config.fps;
    this.maxAudioChunks = config.bufferDurationSec;

    // Pre-allocate the frame pool — all memory is allocated upfront
    this.framePool = new Array(this.maxFrames);
    for (let i = 0; i < this.maxFrames; i++) {
      this.framePool[i] = {
        data: new ArrayBuffer(FRAME_BUFFER_SIZE),
        byteLength: 0,
        timestamp: 0,
      };
    }
  }

  start(canvas: HTMLCanvasElement, audioStream?: MediaStream): void {
    if (this.recording) return;

    this.canvas = canvas;
    this.recording = true;
    this.lastCaptureTime = 0;

    // Create a dedicated offscreen canvas for capture to avoid blocking the main compositor
    this.captureCanvas = document.createElement('canvas');
    this.captureCanvas.width = canvas.width;
    this.captureCanvas.height = canvas.height;
    this.captureCtx = this.captureCanvas.getContext('2d', { alpha: false });

    this.captureLoop(performance.now());

    if (audioStream) {
      this.startAudioCapture(audioStream);
    }
  }

  stop(): void {
    this.recording = false;

    if (this.animFrameId !== null) {
      cancelAnimationFrame(this.animFrameId);
      this.animFrameId = null;
    }

    if (this.audioRecorder && this.audioRecorder.state !== 'inactive') {
      this.audioRecorder.stop();
    }
    this.audioRecorder = null;
    this.canvas = null;
    this.captureCanvas = null;
    this.captureCtx = null;
  }

  isRecording(): boolean {
    return this.recording;
  }

  getBufferDuration(): number {
    return this.frameCount / this.config.fps;
  }

  createClip(durationSec: number, playbackRate: number = 1): ReplayClip {
    const requestedFrames = Math.min(
      Math.ceil(durationSec * this.config.fps),
      this.frameCount,
    );

    if (requestedFrames === 0) {
      return { id: crypto.randomUUID(), startTime: Date.now(), endTime: Date.now(), duration: 0, frames: [] };
    }

    // Extract frames from ring buffer (oldest to newest within window)
    const frames: Blob[] = [];
    const startIdx = (this.writeIndex - requestedFrames + this.maxFrames) % this.maxFrames;
    let firstTimestamp = 0;
    let lastTimestamp = 0;

    for (let i = 0; i < requestedFrames; i++) {
      const idx = (startIdx + i) % this.maxFrames;
      const entry = this.framePool[idx];
      if (entry && entry.byteLength > 0) {
        // Create a Blob from the used portion of the pre-allocated buffer
        // This is a copy, but only happens during clip creation (not per-frame)
        const slice = entry.data.slice(0, entry.byteLength);
        frames.push(new Blob([slice], { type: 'image/jpeg' }));
        if (i === 0) firstTimestamp = entry.timestamp;
        lastTimestamp = entry.timestamp;
      }
    }

    // Slow-motion: duplicate frames
    let outputFrames = frames;
    if (playbackRate > 0 && playbackRate < 1) {
      outputFrames = [];
      const factor = Math.round(1 / playbackRate);
      for (const frame of frames) {
        for (let d = 0; d < factor; d++) outputFrames.push(frame);
      }
    }

    // Extract matching audio
    let audioBlob: Blob | undefined;
    if (this.audioChunks.length > 0) {
      const matching = this.audioChunks.filter(c => c.timestamp >= firstTimestamp && c.timestamp <= lastTimestamp);
      if (matching.length > 0) {
        audioBlob = new Blob(matching.map(c => c.blob), { type: 'audio/webm' });
      }
    }

    return {
      id: crypto.randomUUID(),
      startTime: firstTimestamp,
      endTime: lastTimestamp,
      duration: (outputFrames.length / this.config.fps) * 1000,
      frames: outputFrames,
      audioBlob,
    };
  }

  async playClip(clip: ReplayClip): Promise<HTMLVideoElement> {
    const videoBlob = await this.encodeClipToWebM(clip);
    const url = URL.createObjectURL(videoBlob);
    const video = document.createElement('video');
    video.src = url;
    video.controls = true;
    video.onended = () => URL.revokeObjectURL(url);
    return video;
  }

  async exportClip(clip: ReplayClip): Promise<Blob> {
    return this.encodeClipToWebM(clip);
  }

  getStats(): { bufferSizeMB: number; frameCount: number; oldestFrameAge: number; droppedFrames: number; totalCaptured: number } {
    let totalBytes = 0;
    let oldestTimestamp = Infinity;
    const now = Date.now();

    for (let i = 0; i < this.maxFrames; i++) {
      const entry = this.framePool[i];
      if (entry && entry.byteLength > 0) {
        totalBytes += entry.byteLength;
        if (entry.timestamp < oldestTimestamp && entry.timestamp > 0) {
          oldestTimestamp = entry.timestamp;
        }
      }
    }

    return {
      bufferSizeMB: totalBytes / (1024 * 1024),
      frameCount: this.frameCount,
      oldestFrameAge: oldestTimestamp === Infinity ? 0 : (now - oldestTimestamp) / 1000,
      droppedFrames: this.totalDroppedFrames,
      totalCaptured: this.totalCapturedFrames,
    };
  }

  destroy(): void {
    this.stop();
    // Don't null out the pool — just reset metadata. The ArrayBuffers will be GC'd with the instance.
    for (let i = 0; i < this.framePool.length; i++) {
      this.framePool[i].byteLength = 0;
      this.framePool[i].timestamp = 0;
    }
    this.audioChunks = [];
    this.frameCount = 0;
    this.writeIndex = 0;
  }

  // ──────────── Private ────────────

  private captureLoop(now: number): void {
    if (!this.recording) return;
    const elapsed = now - this.lastCaptureTime;
    if (elapsed >= this.frameDuration) {
      this.lastCaptureTime = now - (elapsed % this.frameDuration);
      this.captureFrame();
    }
    this.animFrameId = requestAnimationFrame((t) => this.captureLoop(t));
  }

  private captureFrame(): void {
    if (!this.canvas || !this.captureCtx || !this.captureCanvas) return;

    // Skip if previous capture is still pending (backpressure)
    if (this.pendingCapture) {
      this.totalDroppedFrames++;
      return;
    }

    // Draw from main canvas to capture canvas (fast GPU copy, doesn't block compositor)
    this.captureCtx.drawImage(this.canvas, 0, 0);

    this.pendingCapture = true;

    this.captureCanvas.toBlob(
      (blob) => {
        this.pendingCapture = false;
        if (!blob) return;

        const entry = this.framePool[this.writeIndex];

        // Read blob into the pre-allocated ArrayBuffer
        blob.arrayBuffer().then(ab => {
          if (ab.byteLength <= entry.data.byteLength) {
            // Fast path: copy into existing buffer (no allocation)
            new Uint8Array(entry.data).set(new Uint8Array(ab));
            entry.byteLength = ab.byteLength;
          } else {
            // Frame exceeded pre-allocated size — replace buffer (rare)
            entry.data = ab;
            entry.byteLength = ab.byteLength;
          }
          entry.timestamp = Date.now();

          this.writeIndex = (this.writeIndex + 1) % this.maxFrames;
          if (this.frameCount < this.maxFrames) this.frameCount++;
          this.totalCapturedFrames++;
        });
      },
      'image/jpeg',
      this.config.quality,
    );
  }

  private startAudioCapture(stream: MediaStream): void {
    try {
      this.audioRecorder = new MediaRecorder(stream, { mimeType: 'audio/webm;codecs=opus' });
    } catch {
      this.audioRecorder = new MediaRecorder(stream);
    }

    this.audioRecorder.ondataavailable = (e) => {
      if (e.data.size > 0) {
        this.audioChunks.push({ blob: e.data, timestamp: Date.now() });
        while (this.audioChunks.length > this.maxAudioChunks) {
          this.audioChunks.shift();
        }
      }
    };

    this.audioRecorder.start(1000);
  }

  private async encodeClipToWebM(clip: ReplayClip): Promise<Blob> {
    const playbackCanvas = document.createElement('canvas');
    const firstImg = await this.blobToImage(clip.frames[0]);
    playbackCanvas.width = firstImg.width;
    playbackCanvas.height = firstImg.height;
    const ctx = playbackCanvas.getContext('2d')!;
    const stream = playbackCanvas.captureStream(this.config.fps);

    if (clip.audioBlob) {
      try {
        const audioCtx = new AudioContext();
        const arrayBuffer = await clip.audioBlob.arrayBuffer();
        const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);
        const dest = audioCtx.createMediaStreamDestination();
        const source = audioCtx.createBufferSource();
        source.buffer = audioBuffer;
        source.connect(dest);
        source.start();
        for (const track of dest.stream.getAudioTracks()) stream.addTrack(track);
      } catch { /* audio mixing failed — continue without */ }
    }

    return new Promise<Blob>((resolve, reject) => {
      let recorder: MediaRecorder;
      try { recorder = new MediaRecorder(stream, { mimeType: 'video/webm;codecs=vp9' }); }
      catch { try { recorder = new MediaRecorder(stream, { mimeType: 'video/webm' }); }
      catch (e) { reject(new Error('MediaRecorder not supported')); return; } }

      const chunks: Blob[] = [];
      recorder.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data); };
      recorder.onstop = () => resolve(new Blob(chunks, { type: 'video/webm' }));
      recorder.onerror = () => reject(new Error('MediaRecorder error during clip export'));
      recorder.start();

      let frameIdx = 0;
      const drawNext = async () => {
        if (frameIdx >= clip.frames.length) { recorder.stop(); return; }
        const img = await this.blobToImage(clip.frames[frameIdx]);
        ctx.clearRect(0, 0, playbackCanvas.width, playbackCanvas.height);
        ctx.drawImage(img, 0, 0);
        frameIdx++;
        setTimeout(drawNext, this.frameDuration);
      };
      drawNext();
    });
  }

  private blobToImage(blob: Blob): Promise<HTMLImageElement> {
    return new Promise((resolve, reject) => {
      const img = new Image();
      const url = URL.createObjectURL(blob);
      img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Failed to decode frame')); };
      img.src = url;
    });
  }
}
