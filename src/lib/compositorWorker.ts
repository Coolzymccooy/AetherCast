/**
 * Compositor Web Worker
 *
 * Moves the canvas rendering loop off the main thread entirely.
 * The main thread sends video frames as ImageBitmap and scene config.
 * The worker renders to an OffscreenCanvas at a locked framerate.
 *
 * This prevents React re-renders, modal opens, and UI interactions
 * from ever dropping compositor frames — critical for multi-hour streams.
 *
 * Usage:
 *   const worker = new CompositorWorkerBridge(canvas);
 *   worker.updateSource('cam1', videoBitmap);
 *   worker.setScene({ type: 'CAM', layout: 'Solo', ... });
 *   worker.destroy();
 */

// ── Messages from main thread to worker ─────────────────────────────────────

export type WorkerInMessage =
  | { type: 'init'; canvas: OffscreenCanvas; width: number; height: number; fps: number }
  | { type: 'updateSource'; id: string; bitmap: ImageBitmap }
  | { type: 'removeSource'; id: string }
  | { type: 'setScene'; config: WorkerSceneConfig }
  | { type: 'setBackground'; background: string; brandColor: string }
  | { type: 'setOverlays'; overlays: WorkerOverlays }
  | { type: 'destroy' };

export type WorkerOutMessage =
  | { type: 'ready' }
  | { type: 'frame'; frameCount: number; renderTimeMs: number }
  | { type: 'error'; message: string };

export interface WorkerSceneConfig {
  sceneType: 'CAM' | 'SCREEN' | 'DUAL' | 'GRID' | 'PODCAST';
  sceneName: string;
  layout: string;
  frameStyle: string;
  motionStyle: string;
  transition: string;
  transitionProgress: number;
  sourceSwap: boolean;
  isStreaming: boolean;
}

export interface WorkerOverlays {
  showBug: boolean;
  showSocials: boolean;
  lowerThirds: { show: boolean; name: string; title: string; accentColor: string };
}

// ── Worker Bridge (runs on main thread) ────────────────────────────────────

export class CompositorWorkerBridge {
  private worker: Worker | null = null;
  private offscreen: OffscreenCanvas | null = null;
  private sourceElements: Map<string, HTMLVideoElement | HTMLImageElement> = new Map();
  private transferInterval: number | null = null;
  private onFrame?: (frameCount: number, renderTimeMs: number) => void;
  private fallbackMode = false;

  constructor(
    canvas: HTMLCanvasElement,
    fps: number = 30,
    onFrame?: (frameCount: number, renderTimeMs: number) => void,
  ) {
    this.onFrame = onFrame;

    // Check if OffscreenCanvas is supported
    if (typeof canvas.transferControlToOffscreen !== 'function') {
      console.warn('CompositorWorker: OffscreenCanvas not supported, falling back to main thread rendering');
      this.fallbackMode = true;
      return;
    }

    try {
      this.offscreen = canvas.transferControlToOffscreen();

      // Create a blob URL worker from inline code
      const workerCode = this.getWorkerCode();
      const blob = new Blob([workerCode], { type: 'application/javascript' });
      const workerUrl = URL.createObjectURL(blob);
      this.worker = new Worker(workerUrl);
      URL.revokeObjectURL(workerUrl);

      this.worker.onmessage = (e: MessageEvent<WorkerOutMessage>) => {
        if (e.data.type === 'frame' && this.onFrame) {
          this.onFrame(e.data.frameCount, e.data.renderTimeMs);
        } else if (e.data.type === 'error') {
          console.error('CompositorWorker error:', e.data.message);
        }
      };

      this.worker.onerror = (err) => {
        console.error('CompositorWorker crashed:', err);
      };

      // Transfer the OffscreenCanvas to the worker
      this.worker.postMessage(
        { type: 'init', canvas: this.offscreen, width: canvas.width, height: canvas.height, fps },
        [this.offscreen],
      );

      // Start periodic source frame transfer (captures ImageBitmaps from video elements)
      this.transferInterval = window.setInterval(() => this.transferFrames(), 1000 / fps);
    } catch (err) {
      console.error('CompositorWorker: Failed to initialize, falling back:', err);
      this.fallbackMode = true;
    }
  }

  /** Register a video/image source for frame transfer */
  registerSource(id: string, element: HTMLVideoElement | HTMLImageElement): void {
    this.sourceElements.set(id, element);
  }

  /** Unregister a source */
  unregisterSource(id: string): void {
    this.sourceElements.delete(id);
    this.worker?.postMessage({ type: 'removeSource', id });
  }

  /** Update scene configuration */
  setScene(config: WorkerSceneConfig): void {
    this.worker?.postMessage({ type: 'setScene', config });
  }

  /** Update background */
  setBackground(background: string, brandColor: string): void {
    this.worker?.postMessage({ type: 'setBackground', background, brandColor });
  }

  /** Update overlays */
  setOverlays(overlays: WorkerOverlays): void {
    this.worker?.postMessage({ type: 'setOverlays', overlays });
  }

  /** Is running in fallback (main thread) mode? */
  isFallback(): boolean {
    return this.fallbackMode;
  }

  /** Cleanup */
  destroy(): void {
    if (this.transferInterval !== null) {
      clearInterval(this.transferInterval);
      this.transferInterval = null;
    }
    this.worker?.postMessage({ type: 'destroy' });
    this.worker?.terminate();
    this.worker = null;
    this.sourceElements.clear();
  }

  // ── Private ──────────────────────────────────────────────────────────────

  private transferFrames(): void {
    if (!this.worker) return;

    this.sourceElements.forEach((element, id) => {
      try {
        // Create ImageBitmap from the video/image element (async but fast with GPU)
        if (element instanceof HTMLVideoElement && element.readyState >= 2) {
          createImageBitmap(element).then(bitmap => {
            this.worker?.postMessage(
              { type: 'updateSource', id, bitmap },
              [bitmap], // Transfer ownership (zero-copy)
            );
          }).catch(() => { /* frame not ready */ });
        } else if (element instanceof HTMLImageElement && element.complete) {
          createImageBitmap(element).then(bitmap => {
            this.worker?.postMessage(
              { type: 'updateSource', id, bitmap },
              [bitmap],
            );
          }).catch(() => { /* image not ready */ });
        }
      } catch { /* silently skip frames that can't be captured */ }
    });
  }

  /** Generate the inline worker script */
  private getWorkerCode(): string {
    return `
// ── Compositor Worker (runs in Web Worker thread) ─────────────────────────
let canvas = null;
let ctx = null;
let width = 1920;
let height = 1080;
let fps = 30;
let frameCount = 0;
let lastTime = 0;
let running = false;
let interval = 0;

// Source bitmaps (transferred from main thread)
const sources = new Map();

// Current scene config
let scene = { sceneType: 'CAM', sceneName: 'Cam 1', layout: 'Solo', frameStyle: 'Glass', motionStyle: 'Snappy', transition: 'Cut', transitionProgress: 1, sourceSwap: false, isStreaming: false };
let background = 'Gradient Motion';
let brandColor = '#5d28d9';
let overlays = { showBug: false, showSocials: false, lowerThirds: { show: false, name: '', title: '', accentColor: '#00E5FF' } };

self.onmessage = function(e) {
  const msg = e.data;
  switch (msg.type) {
    case 'init':
      canvas = msg.canvas;
      width = msg.width;
      height = msg.height;
      fps = msg.fps;
      interval = 1000 / fps;
      ctx = canvas.getContext('2d', { alpha: false });
      running = true;
      self.postMessage({ type: 'ready' });
      requestAnimationFrame(render);
      break;

    case 'updateSource':
      // Close previous bitmap to free GPU memory
      if (sources.has(msg.id)) {
        sources.get(msg.id).close();
      }
      sources.set(msg.id, msg.bitmap);
      break;

    case 'removeSource':
      if (sources.has(msg.id)) {
        sources.get(msg.id).close();
        sources.delete(msg.id);
      }
      break;

    case 'setScene':
      scene = msg.config;
      break;

    case 'setBackground':
      background = msg.background;
      brandColor = msg.brandColor;
      break;

    case 'setOverlays':
      overlays = msg.overlays;
      break;

    case 'destroy':
      running = false;
      sources.forEach(bmp => bmp.close());
      sources.clear();
      break;
  }
};

function render(time) {
  if (!running || !ctx) return;

  const delta = time - lastTime;
  if (delta >= interval) {
    const renderStart = performance.now();
    frameCount++;
    lastTime = time - (delta % interval);

    drawFrame(ctx, frameCount);

    const renderTime = performance.now() - renderStart;
    // Only report every 30 frames to avoid flooding the message channel
    if (frameCount % 30 === 0) {
      self.postMessage({ type: 'frame', frameCount, renderTimeMs: renderTime });
    }
  }

  requestAnimationFrame(render);
}

function drawFrame(ctx, fc) {
  // 1. Background
  drawBackground(ctx, fc);

  // 2. Scene sources
  drawScene(ctx, fc);

  // 3. Overlays
  drawOverlays(ctx, fc);

  // 4. Live indicator
  if (scene.isStreaming) {
    ctx.fillStyle = '#FF4C4C';
    ctx.beginPath();
    ctx.arc(width - 30, 30, 6, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#FFFFFF';
    ctx.font = 'bold 12px Inter, sans-serif';
    ctx.textAlign = 'right';
    ctx.fillText('LIVE', width - 45, 34);
  }
}

function drawBackground(ctx, fc) {
  if (background === 'Gradient Motion') {
    const grad = ctx.createLinearGradient(0, 0, width, height);
    grad.addColorStop(0, brandColor);
    grad.addColorStop(0.5, '#0f172a');
    grad.addColorStop(1, '#000000');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, width, height);
  } else if (background === 'Brand Theme') {
    ctx.fillStyle = brandColor;
    ctx.fillRect(0, 0, width, height);
  } else if (background === 'Neon Pulse') {
    ctx.fillStyle = '#050505';
    ctx.fillRect(0, 0, width, height);
    const pulse = Math.sin(fc * 0.05) * 0.5 + 0.5;
    ctx.fillStyle = 'rgba(255,0,255,' + (pulse * 0.1) + ')';
    ctx.fillRect(0, 0, width, height);
  } else if (background === 'Cosmic') {
    ctx.fillStyle = '#0B0B1A';
    ctx.fillRect(0, 0, width, height);
    ctx.fillStyle = '#FFF';
    for (let i = 0; i < 100; i++) {
      const x = (Math.sin(i * 123.45) * 0.5 + 0.5) * width;
      const y = (Math.cos(i * 67.89) * 0.5 + 0.5) * height;
      const size = (Math.sin(i * 10 + fc * 0.05) * 0.5 + 0.5) * 2;
      ctx.beginPath(); ctx.arc(x, y, size, 0, Math.PI * 2); ctx.fill();
    }
  } else {
    ctx.fillStyle = '#0B0F14';
    ctx.fillRect(0, 0, width, height);
  }
}

function drawSource(ctx, bitmap, x, y, w, h, radius) {
  if (!bitmap) {
    // Placeholder
    ctx.fillStyle = '#111821';
    ctx.fillRect(x, y, w, h);
    return;
  }

  ctx.save();
  if (radius > 0) {
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, radius);
    ctx.clip();
  }
  ctx.drawImage(bitmap, x, y, w, h);
  ctx.restore();
}

function getSource(id) {
  return sources.get(id) || null;
}

function drawScene(ctx, fc) {
  const cam1 = getSource('cam1') || getSource('local-cam-1');
  const cam2 = getSource('cam2') || getSource('local-cam-2');
  const screen = getSource('screen');
  let primary = cam1;
  let secondary = screen || cam2;
  if (scene.sourceSwap) { const t = primary; primary = secondary; secondary = t; }

  const radius = scene.frameStyle === 'Glass' ? 12 : scene.frameStyle === 'Floating' ? 16 : 0;
  const pad = 40;

  if (scene.sceneType === 'CAM') {
    if (scene.layout === 'Framed Solo') {
      const w = width - 160; const h = w * 9/16; const y = (height - h) / 2;
      drawSource(ctx, scene.sceneName === 'Cam 2' ? secondary : primary, 80, y, w, h, radius);
    } else {
      drawSource(ctx, scene.sceneName === 'Cam 2' ? secondary : primary, 0, 0, width, height, 0);
    }
  } else if (scene.sceneType === 'DUAL') {
    if (scene.layout === 'Picture-in-Pic') {
      drawSource(ctx, secondary, 0, 0, width, height, 0);
      const pw = width/4; const ph = height/4;
      drawSource(ctx, primary, width-pw-40, height-ph-40, pw, ph, radius);
    } else {
      const w = (width/2) - pad*1.5; const h = w*9/16; const y = (height-h)/2;
      drawSource(ctx, primary, pad, y, w, h, radius);
      drawSource(ctx, secondary, width/2+pad/2, y, w, h, radius);
    }
  } else if (scene.sceneType === 'SCREEN') {
    drawSource(ctx, secondary, 0, 0, width, height, 0);
    const pw = width/4; const ph = height/4;
    drawSource(ctx, primary, width-pw-40, height-ph-40, pw, ph, radius);
  } else if (scene.sceneType === 'GRID') {
    const gpad = 20; const w = (width/2)-gpad*1.5; const h = w*9/16;
    const sy = (height-(h*2+gpad))/2;
    for (let i = 0; i < 4; i++) {
      const col = i%2; const row = Math.floor(i/2);
      const src = i===0 ? primary : getSource('remote-'+(i)) || secondary;
      drawSource(ctx, src, gpad+col*(w+gpad), sy+row*(h+gpad), w, h, radius);
    }
  } else if (scene.sceneType === 'PODCAST') {
    drawSource(ctx, secondary, 0, 0, width, height, 0);
    const pw = width/4; const ph = height/4;
    drawSource(ctx, primary, width-pw-40, height-ph-40, pw, ph, radius);
  }
}

function drawOverlays(ctx, fc) {
  if (overlays.showBug) {
    const bx = width-100, by = 40;
    ctx.fillStyle = 'rgba(0,229,255,0.2)';
    ctx.beginPath(); ctx.arc(bx, by+30, 30, 0, Math.PI*2); ctx.fill();
    ctx.strokeStyle = '#00E5FF'; ctx.lineWidth = 2; ctx.stroke();
    ctx.fillStyle = '#FFF'; ctx.font = 'bold 12px Inter, sans-serif'; ctx.textAlign = 'center';
    ctx.fillText('SELTON', bx, by+34);
  }

  if (overlays.lowerThirds.show) {
    const lx = 60, ly = height - 140, lw = 400, lh = 80;
    ctx.fillStyle = 'rgba(11,15,20,0.9)';
    ctx.beginPath(); ctx.roundRect(lx, ly, lw, lh, [0,12,12,0]); ctx.fill();
    ctx.fillStyle = overlays.lowerThirds.accentColor;
    ctx.fillRect(lx, ly, 6, lh);
    ctx.fillStyle = '#FFF'; ctx.font = 'bold 28px Inter, sans-serif'; ctx.textAlign = 'left';
    ctx.fillText(overlays.lowerThirds.name.toUpperCase(), lx+30, ly+40);
    ctx.fillStyle = 'rgba(255,255,255,0.7)'; ctx.font = '500 16px Inter, sans-serif';
    ctx.fillText(overlays.lowerThirds.title, lx+30, ly+65);
  }

  if (overlays.showSocials) {
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.beginPath(); ctx.roundRect(60, 60, 200, 30, 15); ctx.fill();
    ctx.fillStyle = '#FFF'; ctx.font = '600 12px Inter, sans-serif'; ctx.textAlign = 'left';
    ctx.fillText('@seltonstudio', 100, 80);
  }
}
`;
  }
}
