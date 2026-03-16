// Hardware-accelerated H.264/VP9 video encoder using the WebCodecs API.
// Replaces MediaRecorder for streaming — accesses GPU encoders directly
// via the VideoEncoder API for lower latency and better control.

export interface EncoderConfig {
  width: number;
  height: number;
  fps: number;
  bitrate: number;
  keyFrameInterval: number;
  codec: 'avc' | 'vp9';
  hardwareAcceleration: 'prefer-hardware' | 'prefer-software' | 'no-preference';
}

export interface EncoderStats {
  encodedFrames: number;
  droppedFrames: number;
  averageEncodeTime: number;
  bitrate: number;
  queueDepth: number;
}

export type OnEncodedChunk = (
  chunk: ArrayBuffer,
  metadata: {
    type: 'key' | 'delta';
    timestamp: number;
    duration: number;
    byteLength: number;
  },
) => void;

const CODEC_STRINGS: Record<EncoderConfig['codec'], string> = {
  avc: 'avc1.640028', // H.264 High Profile Level 4.0
  vp9: 'vp09.00.31.08',
};

const MAX_QUEUE_DEPTH = 3;
const BITRATE_WINDOW_MS = 2000;

function buildVideoEncoderConfig(config: EncoderConfig): VideoEncoderConfig {
  return {
    codec: CODEC_STRINGS[config.codec],
    width: config.width,
    height: config.height,
    bitrate: config.bitrate,
    framerate: config.fps,
    hardwareAcceleration: config.hardwareAcceleration,
    latencyMode: 'realtime',
    bitrateMode: 'constant',
  };
}

export class WebCodecEncoder {
  private encoder: VideoEncoder | null = null;
  private config: EncoderConfig;
  private onChunk: OnEncodedChunk;

  private frameIndex = 0;
  private keyFrameEveryN: number;
  private started = false;

  // Stats tracking
  private encodedFrames = 0;
  private droppedFrames = 0;
  private encodeTimes: number[] = [];
  private queueDepth = 0;

  // Bitrate measurement
  private bytesSent = 0;
  private bitrateWindowStart = 0;
  private measuredBitrate = 0;

  constructor(config: EncoderConfig, onChunk: OnEncodedChunk) {
    if (!WebCodecEncoder.isSupported()) {
      throw new Error(
        'WebCodecs API is not available in this browser. ' +
          'The VideoEncoder API requires a secure context (HTTPS) and a browser ' +
          'that supports WebCodecs (Chrome 94+, Edge 94+, Opera 80+).',
      );
    }

    this.config = { ...config };
    this.onChunk = onChunk;
    this.keyFrameEveryN = config.keyFrameInterval * config.fps;
    this.bitrateWindowStart = performance.now();
  }

  // ---------------------------------------------------------------------------
  // Static helpers
  // ---------------------------------------------------------------------------

  static isSupported(): boolean {
    return typeof globalThis !== 'undefined' && 'VideoEncoder' in globalThis;
  }

  static async isConfigSupported(config: EncoderConfig): Promise<boolean> {
    if (!WebCodecEncoder.isSupported()) return false;

    try {
      const result = await VideoEncoder.isConfigSupported(
        buildVideoEncoderConfig(config),
      );
      return result.supported === true;
    } catch {
      return false;
    }
  }

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  start(): void {
    if (this.started) return;

    this.encoder = new VideoEncoder({
      output: this.handleOutput,
      error: this.handleError,
    });

    this.encoder.configure(buildVideoEncoderConfig(this.config));

    this.encoder.addEventListener('dequeue', this.handleDequeue);

    this.started = true;
    this.frameIndex = 0;
    this.encodedFrames = 0;
    this.droppedFrames = 0;
    this.encodeTimes = [];
    this.queueDepth = 0;
    this.bytesSent = 0;
    this.bitrateWindowStart = performance.now();
    this.measuredBitrate = 0;
  }

  encodeFrame(canvas: HTMLCanvasElement | OffscreenCanvas): void {
    if (!this.encoder || this.encoder.state !== 'configured') return;

    // Drop frames when the encoder is falling behind.
    if (this.queueDepth > MAX_QUEUE_DEPTH) {
      this.droppedFrames++;
      console.warn(
        `[WebCodecEncoder] Dropping frame — queue depth ${this.queueDepth} exceeds ${MAX_QUEUE_DEPTH}`,
      );
      return;
    }

    const timestamp = this.frameIndex * (1_000_000 / this.config.fps); // microseconds
    const isKeyFrame = this.frameIndex % this.keyFrameEveryN === 0;

    let frame: VideoFrame | null = null;
    try {
      frame = new VideoFrame(canvas as CanvasImageSource, { timestamp });

      const encodeStart = performance.now();
      this.encoder.encode(frame, { keyFrame: isKeyFrame });
      this.encodeTimes.push(performance.now() - encodeStart);

      this.queueDepth++;
      this.frameIndex++;
    } finally {
      // Always close the frame to free GPU memory.
      frame?.close();
    }
  }

  getStats(): EncoderStats {
    const avg =
      this.encodeTimes.length > 0
        ? this.encodeTimes.reduce((a, b) => a + b, 0) / this.encodeTimes.length
        : 0;

    return {
      encodedFrames: this.encodedFrames,
      droppedFrames: this.droppedFrames,
      averageEncodeTime: Math.round(avg * 100) / 100,
      bitrate: Math.round(this.measuredBitrate),
      queueDepth: this.queueDepth,
    };
  }

  updateBitrate(bitrate: number): void {
    if (!this.encoder || this.encoder.state !== 'configured') return;

    this.config = { ...this.config, bitrate };
    this.encoder.configure(buildVideoEncoderConfig(this.config));
  }

  async stop(): Promise<void> {
    if (!this.encoder || this.encoder.state === 'closed') return;

    try {
      await this.encoder.flush();
    } catch {
      // Flush can throw if the encoder was reset or closed concurrently.
    }

    this.started = false;
  }

  destroy(): void {
    if (this.encoder) {
      this.encoder.removeEventListener('dequeue', this.handleDequeue);

      if (this.encoder.state !== 'closed') {
        try {
          this.encoder.close();
        } catch {
          // Ignore — may already be closed.
        }
      }

      this.encoder = null;
    }

    this.started = false;
  }

  // ---------------------------------------------------------------------------
  // Internal callbacks
  // ---------------------------------------------------------------------------

  private handleOutput = (
    chunk: EncodedVideoChunk,
    _metadata: EncodedVideoChunkMetadata | undefined,
  ): void => {
    const buffer = new ArrayBuffer(chunk.byteLength);
    chunk.copyTo(buffer);

    this.encodedFrames++;
    this.bytesSent += chunk.byteLength;
    this.updateMeasuredBitrate();

    this.onChunk(buffer, {
      type: chunk.type as 'key' | 'delta',
      timestamp: chunk.timestamp,
      duration: chunk.duration ?? 0,
      byteLength: chunk.byteLength,
    });
  };

  private handleError = (error: DOMException): void => {
    console.error('[WebCodecEncoder] Encoder error:', error);
  };

  private handleDequeue = (): void => {
    if (this.encoder) {
      this.queueDepth = this.encoder.encodeQueueSize;
    }
  };

  // ---------------------------------------------------------------------------
  // Bitrate measurement
  // ---------------------------------------------------------------------------

  private updateMeasuredBitrate(): void {
    const now = performance.now();
    const elapsed = now - this.bitrateWindowStart;

    if (elapsed >= BITRATE_WINDOW_MS) {
      // bits per second over the measurement window
      this.measuredBitrate = (this.bytesSent * 8 * 1000) / elapsed;
      this.bytesSent = 0;
      this.bitrateWindowStart = now;
    }
  }
}
