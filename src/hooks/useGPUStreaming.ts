import { useState, useRef, useCallback, useEffect } from 'react';
import type { StreamDestination, ServerLog, EncodingProfile } from '../types';

interface GPUStreamStats {
  framesEncoded: number;
  isActive: boolean;
  encoder: string;
  isGPU: boolean;
  fps: number;
  droppedFrames: number;
}

/**
 * GPU Streaming hook — uses Tauri's Rust backend to pipe raw canvas frames
 * directly to FFmpeg with hardware encoding (NVENC/QSV/AMF/VideoToolbox).
 *
 * Eliminates: MediaRecorder, Socket.io chunks, WebM re-encoding.
 * Pipeline: Canvas → getImageData → Tauri invoke → FFmpeg stdin → RTMP
 */
export function useGPUStreaming() {
  const [isStreaming, setIsStreaming] = useState(false);
  const [stats, setStats] = useState<GPUStreamStats>({
    framesEncoded: 0, isActive: false, encoder: 'detecting...', isGPU: false, fps: 0, droppedFrames: 0,
  });
  const [encoderInfo, setEncoderInfo] = useState<{ encoder: string; isGPU: boolean; ffmpegPath: string } | null>(null);

  const frameLoopRef = useRef<number | null>(null);
  const lastFrameTimeRef = useRef(0);
  const frameCountRef = useRef(0);
  const droppedRef = useRef(0);
  const sendingRef = useRef(false); // Prevents overlapping invoke calls
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const fpsRef = useRef(30);

  // Detect GPU encoder on mount
  useEffect(() => {
    if (!window.__TAURI_INTERNALS__) return;

    import('@tauri-apps/api/core').then(({ invoke }) => {
      invoke('detect_encoder').then((result: any) => {
        try {
          const info = JSON.parse(result as string);
          setEncoderInfo(info);
          setStats(prev => ({ ...prev, encoder: info.encoder, isGPU: info.isGPU }));
          console.log('[GPU] Encoder detected:', info);
        } catch {}
      }).catch(err => console.log('[GPU] Encoder detection failed:', err));
    });
  }, []);

  const startGPUStream = useCallback(async (
    canvas: HTMLCanvasElement,
    destinations: StreamDestination[],
    options?: { width?: number; height?: number; fps?: number; bitrate?: number; encoder?: string },
  ) => {
    if (!window.__TAURI_INTERNALS__) {
      throw new Error('GPU streaming requires Tauri desktop app');
    }

    const { invoke } = await import('@tauri-apps/api/core');
    const width = options?.width || canvas.width;
    const height = options?.height || canvas.height;
    const fps = options?.fps || 15; // 15fps for Tauri IPC — JSON serialization can't handle 30fps at full res
    const bitrate = options?.bitrate || 6000;
    const encoder = options?.encoder || 'auto';

    fpsRef.current = fps;
    canvasRef.current = canvas;

    // Start FFmpeg via Tauri
    const result = await invoke('start_stream', {
      config: {
        destinations: destinations.map(d => ({
          url: d.rtmpUrl || d.url || '',
          stream_key: d.streamKey,
          protocol: d.protocol || 'rtmp',
          name: d.name,
          enabled: d.enabled,
          rtmp_url: d.rtmpUrl,
        })),
        width, height, fps, bitrate, encoder,
      },
    });

    console.log('[GPU] Stream started:', result);
    setIsStreaming(true);
    frameCountRef.current = 0;
    droppedRef.current = 0;
    lastFrameTimeRef.current = 0;

    // Start frame capture loop
    const frameDuration = 1000 / fps;

    const captureLoop = (time: number) => {
      if (!canvasRef.current) return;

      const elapsed = time - lastFrameTimeRef.current;
      if (elapsed >= frameDuration) {
        lastFrameTimeRef.current = time - (elapsed % frameDuration);
        captureAndSendFrame(invoke, canvasRef.current, width, height);
      }

      frameLoopRef.current = requestAnimationFrame(captureLoop);
    };

    frameLoopRef.current = requestAnimationFrame(captureLoop);

    return result as string;
  }, []);

  const captureAndSendFrame = async (
    invoke: any,
    canvas: HTMLCanvasElement,
    width: number,
    height: number,
  ) => {
    // Skip if previous frame is still being sent (prevents queue buildup)
    if (sendingRef.current) {
      droppedRef.current++;
      return;
    }

    try {
      sendingRef.current = true;

      // Scale canvas down to 640x360 before reading pixels
      // Full 1920x1080 = 8MB per frame — too large for Tauri IPC (JSON serialized)
      // 640x360 = 921KB per frame — manageable at 15fps = ~14MB/s
      const scaledW = 640;
      const scaledH = 360;

      // Use a shared offscreen canvas for scaling
      if (!(window as any).__aether_scale_canvas) {
        const sc = document.createElement('canvas');
        sc.width = scaledW;
        sc.height = scaledH;
        (window as any).__aether_scale_canvas = sc;
      }
      const scaleCanvas = (window as any).__aether_scale_canvas as HTMLCanvasElement;
      const scaleCtx = scaleCanvas.getContext('2d', { willReadFrequently: true });
      if (!scaleCtx) return;

      // Draw scaled-down frame
      scaleCtx.drawImage(canvas, 0, 0, scaledW, scaledH);
      const imageData = scaleCtx.getImageData(0, 0, scaledW, scaledH);

      await invoke('encode_frame', {
        frameData: Array.from(imageData.data),
        width: scaledW,
        height: scaledH,
      });

      frameCountRef.current++;

      // Update stats every 30 frames
      if (frameCountRef.current % 30 === 0) {
        setStats(prev => ({
          ...prev,
          framesEncoded: frameCountRef.current,
          droppedFrames: droppedRef.current,
          isActive: true,
          fps: fpsRef.current,
        }));
      }
    } catch (err) {
      console.error('[GPU] Frame encode error:', err);
      droppedRef.current++;
    } finally {
      sendingRef.current = false;
    }
  };

  const stopGPUStream = useCallback(async () => {
    // Stop capture loop
    if (frameLoopRef.current !== null) {
      cancelAnimationFrame(frameLoopRef.current);
      frameLoopRef.current = null;
    }
    canvasRef.current = null;

    if (!window.__TAURI_INTERNALS__) return;

    try {
      const { invoke } = await import('@tauri-apps/api/core');
      const result = await invoke('stop_stream');
      console.log('[GPU] Stream stopped:', result);
    } catch (err) {
      console.error('[GPU] Stop error:', err);
    }

    setIsStreaming(false);
    setStats(prev => ({ ...prev, isActive: false }));
  }, []);

  const isAvailable = !!window.__TAURI_INTERNALS__;

  return {
    isAvailable,
    isStreaming,
    stats,
    encoderInfo,
    startGPUStream,
    stopGPUStream,
  };
}
