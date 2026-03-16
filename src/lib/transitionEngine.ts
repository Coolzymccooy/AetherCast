// ─── Transition Engine ───────────────────────────────────────────────────────
// Manages scene transitions for the broadcast compositor. Supports instant
// cuts, fades, directional wipes, and stinger (video overlay) transitions.
// ─────────────────────────────────────────────────────────────────────────────

// ── Types ────────────────────────────────────────────────────────────────────

export type TransitionType =
  | 'Cut'
  | 'Fade'
  | 'Wipe'
  | 'WipeUp'
  | 'WipeDown'
  | 'Stinger';

export interface StingerConfig {
  videoUrl: string;       // URL to the transition video (with alpha or luma key)
  duration: number;        // ms
  cutPoint: number;        // ms — the point in the video where the scene switch happens
  useAlpha: boolean;       // true = video has alpha channel, false = use luma for transparency
}

export interface TransitionState {
  isTransitioning: boolean;
  type: TransitionType;
  progress: number;        // 0-1
  phase: 'in' | 'out';    // 'in' = old scene fading out, 'out' = new scene fading in
}

export type OnTransitionFrame = (state: TransitionState) => void;

// ── Constants ────────────────────────────────────────────────────────────────

const DEFAULT_DURATION_MS = 500;

// ── TransitionEngine ─────────────────────────────────────────────────────────

export class TransitionEngine {
  private state: TransitionState = {
    isTransitioning: false,
    type: 'Cut',
    progress: 0,
    phase: 'in',
  };

  private durationMs = DEFAULT_DURATION_MS;
  private elapsedMs = 0;

  // Stinger
  private stingerConfig: StingerConfig | null = null;
  private stingerEl: HTMLVideoElement | null = null;
  private stingerPreloaded = false;
  private cutPointFired = false;

  // Callbacks
  private cutPointCallbacks: Array<() => void> = [];

  constructor() {
    // nothing to initialise beyond defaults
  }

  // ── Stinger configuration ───────────────────────────────────────────────

  setStinger(config: StingerConfig): void {
    this.cleanupStingerElement();
    this.stingerConfig = { ...config };
    this.stingerPreloaded = false;
  }

  async preload(): Promise<void> {
    if (!this.stingerConfig) return;
    if (this.stingerPreloaded && this.stingerEl) return;

    this.cleanupStingerElement();

    const el = document.createElement('video');
    el.playsInline = true;
    el.muted = true;
    el.preload = 'auto';
    el.style.display = 'none';
    el.src = this.stingerConfig.videoUrl;
    document.body.appendChild(el);

    await new Promise<void>((resolve, reject) => {
      el.addEventListener('canplaythrough', () => resolve(), { once: true });
      el.addEventListener('error', () => reject(el.error), { once: true });
      el.load();
    });

    this.stingerEl = el;
    this.stingerPreloaded = true;
  }

  // ── Start a transition ──────────────────────────────────────────────────

  start(type: TransitionType, durationMs?: number): void {
    // Reset state
    this.elapsedMs = 0;
    this.cutPointFired = false;

    this.state = {
      isTransitioning: true,
      type,
      progress: 0,
      phase: 'in',
    };

    if (type === 'Cut') {
      // Instant switch
      this.state.progress = 1;
      this.state.phase = 'out';
      this.fireCutPoint();
      this.finish();
      return;
    }

    if (type === 'Stinger') {
      if (!this.stingerConfig) {
        // No stinger configured — fall back to a cut
        this.state.progress = 1;
        this.state.phase = 'out';
        this.fireCutPoint();
        this.finish();
        return;
      }

      this.durationMs = this.stingerConfig.duration;
      this.startStingerPlayback();
      return;
    }

    // Fade / Wipe variants
    this.durationMs = durationMs ?? DEFAULT_DURATION_MS;
  }

  // ── Per-frame update ────────────────────────────────────────────────────

  update(deltaMs: number): void {
    if (!this.state.isTransitioning) return;

    this.elapsedMs += deltaMs;

    if (this.state.type === 'Stinger') {
      this.updateStinger();
      return;
    }

    // Linear progress
    const progress = Math.min(this.elapsedMs / this.durationMs, 1);
    this.state.progress = progress;

    if (progress < 0.5) {
      this.state.phase = 'in';
    } else {
      if (this.state.phase === 'in') {
        // First frame past the midpoint — fire cut point
        this.state.phase = 'out';
        this.fireCutPoint();
      }
    }

    if (progress >= 1) {
      this.finish();
    }
  }

  // ── Query ───────────────────────────────────────────────────────────────

  getState(): TransitionState {
    return { ...this.state };
  }

  getStingerVideo(): HTMLVideoElement | null {
    return this.stingerEl;
  }

  // ── Cut-point callback ──────────────────────────────────────────────────

  onCutPoint(callback: () => void): void {
    this.cutPointCallbacks.push(callback);
  }

  // ── Canvas 2D fallback rendering ────────────────────────────────────────

  applyToContext(
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
  ): void {
    if (!this.state.isTransitioning) return;

    const { type, progress, phase } = this.state;

    switch (type) {
      case 'Fade':
        this.applyFade(ctx, width, height, progress, phase);
        break;

      case 'Wipe':
        this.applyWipeHorizontal(ctx, width, height, progress, phase);
        break;

      case 'WipeUp':
        this.applyWipeVertical(ctx, width, height, progress, phase, 'up');
        break;

      case 'WipeDown':
        this.applyWipeVertical(ctx, width, height, progress, phase, 'down');
        break;

      case 'Stinger':
        this.applyStinger(ctx, width, height);
        break;

      case 'Cut':
      default:
        // Nothing to render for a cut
        break;
    }
  }

  // ── Cleanup ─────────────────────────────────────────────────────────────

  destroy(): void {
    this.cleanupStingerElement();
    this.cutPointCallbacks = [];
    this.stingerConfig = null;
    this.state = {
      isTransitioning: false,
      type: 'Cut',
      progress: 0,
      phase: 'in',
    };
  }

  // ── Private: stinger playback ───────────────────────────────────────────

  private startStingerPlayback(): void {
    if (!this.stingerEl || !this.stingerConfig) {
      // Attempt a lazy preload
      const el = document.createElement('video');
      el.playsInline = true;
      el.muted = true;
      el.style.display = 'none';
      el.src = this.stingerConfig!.videoUrl;
      document.body.appendChild(el);
      this.stingerEl = el;
    }

    const el = this.stingerEl!;
    el.currentTime = 0;
    el.play().catch(() => {
      // autoplay blocked — fire cut point immediately and finish
      this.fireCutPoint();
      this.finish();
    });
  }

  private updateStinger(): void {
    if (!this.stingerConfig || !this.stingerEl) {
      this.finish();
      return;
    }

    const currentTimeMs = this.stingerEl.currentTime * 1000;
    const { cutPoint, duration } = this.stingerConfig;

    this.state.progress = Math.min(currentTimeMs / duration, 1);

    // Fire cut point
    if (!this.cutPointFired && currentTimeMs >= cutPoint) {
      this.state.phase = 'out';
      this.fireCutPoint();
    }

    // Check completion
    if (this.stingerEl.ended || currentTimeMs >= duration) {
      this.finish();
    }
  }

  // ── Private: helpers ────────────────────────────────────────────────────

  private fireCutPoint(): void {
    if (this.cutPointFired) return;
    this.cutPointFired = true;

    for (const cb of this.cutPointCallbacks) {
      try {
        cb();
      } catch {
        // listener errors must not break the engine
      }
    }
  }

  private finish(): void {
    this.state.isTransitioning = false;
    this.state.progress = 1;
    this.state.phase = 'out';

    // Reset stinger video for next use
    if (this.stingerEl) {
      this.stingerEl.pause();
      this.stingerEl.currentTime = 0;
    }
  }

  private cleanupStingerElement(): void {
    if (this.stingerEl) {
      this.stingerEl.pause();
      this.stingerEl.removeAttribute('src');
      this.stingerEl.load();
      this.stingerEl.remove();
      this.stingerEl = null;
    }
    this.stingerPreloaded = false;
  }

  // ── Private: Canvas 2D transition effects ───────────────────────────────

  private applyFade(
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
    progress: number,
    phase: 'in' | 'out',
  ): void {
    // Draw a black overlay whose opacity depends on the transition phase.
    // During "in" (old scene fading out) opacity ramps up from 0 → 1.
    // During "out" (new scene fading in) opacity ramps down from 1 → 0.
    const alpha =
      phase === 'in'
        ? progress * 2           // 0→1 over the first half
        : (1 - progress) * 2;   // 1→0 over the second half

    ctx.save();
    ctx.globalAlpha = Math.max(0, Math.min(1, alpha));
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, width, height);
    ctx.restore();
  }

  private applyWipeHorizontal(
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
    progress: number,
    _phase: 'in' | 'out',
  ): void {
    // Left-to-right wipe: clip the new scene to the revealed region.
    const revealX = progress * width;

    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, revealX, height);
    ctx.clip();
    // The compositor draws the new scene into this clipped region.
    // We render a semitransparent black to hide the old scene outside the clip.
    ctx.fillStyle = '#000';
    ctx.globalAlpha = 0;
    ctx.fillRect(0, 0, width, height);
    ctx.restore();

    // Black out the unrevealed portion
    ctx.save();
    ctx.globalAlpha = 1;
    ctx.fillStyle = '#000';
    ctx.fillRect(revealX, 0, width - revealX, height);
    ctx.restore();
  }

  private applyWipeVertical(
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
    progress: number,
    _phase: 'in' | 'out',
    direction: 'up' | 'down',
  ): void {
    const revealH = progress * height;

    ctx.save();

    if (direction === 'up') {
      // Reveal from bottom to top
      const y = height - revealH;
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, width, y);
    } else {
      // Reveal from top to bottom
      ctx.fillStyle = '#000';
      ctx.fillRect(0, revealH, width, height - revealH);
    }

    ctx.restore();
  }

  private applyStinger(
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
  ): void {
    if (!this.stingerEl || this.stingerEl.readyState < 2) return;

    const config = this.stingerConfig;
    if (!config) return;

    if (config.useAlpha) {
      // Video with alpha channel — draw it directly on top
      ctx.save();
      ctx.drawImage(this.stingerEl, 0, 0, width, height);
      ctx.restore();
    } else {
      // Use luma (brightness) as transparency mask
      this.applyLumaStinger(ctx, width, height);
    }
  }

  private applyLumaStinger(
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
  ): void {
    if (!this.stingerEl) return;

    // Draw the stinger frame into a temporary canvas to read pixel data
    const tmpCanvas = document.createElement('canvas');
    tmpCanvas.width = width;
    tmpCanvas.height = height;
    const tmpCtx = tmpCanvas.getContext('2d');
    if (!tmpCtx) return;

    tmpCtx.drawImage(this.stingerEl, 0, 0, width, height);
    const imageData = tmpCtx.getImageData(0, 0, width, height);
    const data = imageData.data;

    // Convert luma to alpha: bright pixels → opaque, dark → transparent
    for (let i = 0; i < data.length; i += 4) {
      const luma = data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114;
      data[i + 3] = Math.round(luma); // use brightness as alpha
    }

    tmpCtx.putImageData(imageData, 0, 0);
    ctx.save();
    ctx.drawImage(tmpCanvas, 0, 0);
    ctx.restore();
  }
}
