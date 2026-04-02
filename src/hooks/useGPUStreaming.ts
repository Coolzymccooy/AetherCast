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

/** Convert ArrayBuffer to base64 string (chunked to avoid stack overflow) */
function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  const chunks: string[] = [];
  for (let i = 0; i < bytes.length; i += 8192) {
    chunks.push(String.fromCharCode.apply(null, bytes.subarray(i, i + 8192) as any));
  }
  return btoa(chunks.join(''));
}

/**
 * GPU Streaming hook — uses Tauri's Rust backend to pipe canvas frames
 * directly to a local FFmpeg with hardware encoding (NVENC/QSV/AMF/VideoToolbox).
 *
 * Pipeline: Canvas → JPEG blob → base64 → Tauri invoke → FFmpeg (image2pipe) → NVENC → RTMP
 *
 * This avoids: MediaRecorder, Socket.io, server-side re-encoding.
 * JPEG compression reduces IPC payload from ~920KB/frame (raw RGBA) to ~30-60KB/frame.
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
  const scaleCanvasRef = useRef<HTMLCanvasElement | null>(null);

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

    // Scale dimensions for FFmpeg — must match what we actually capture
    // 640x360 is the sweet spot for Tauri IPC (JPEG ~30-60KB/frame)
    const captureWidth = 640;
    const captureHeight = 360;
    const fps = options?.fps || 30; // JPEG compression makes 30fps feasible over IPC
    const bitrate = options?.bitrate || 6000;
    const encoder = options?.encoder || 'auto';

    fpsRef.current = fps;
    canvasRef.current = canvas;

    // Create/reuse offscreen canvas for scaling
    if (!scaleCanvasRef.current) {
      scaleCanvasRef.current = document.createElement('canvas');
    }
    scaleCanvasRef.current.width = captureWidth;
    scaleCanvasRef.current.height = captureHeight;

    // Start FFmpeg via Tauri — use MJPEG pipe input mode
    // FFmpeg receives JPEG frames via image2pipe, encodes to H.264 with GPU, outputs to RTMP
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
        width: captureWidth,
        height: captureHeight,
        fps,
        bitrate,
        encoder,
        mode: 'jpeg', // Use MJPEG pipe input instead of raw RGBA
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
        captureAndSendFrame(invoke, canvasRef.current, captureWidth, captureHeight);
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

      const scaleCanvas = scaleCanvasRef.current;
      if (!scaleCanvas) return;
      const scaleCtx = scaleCanvas.getContext('2d', { willReadFrequently: true });
      if (!scaleCtx) return;

      // Draw scaled-down frame
      scaleCtx.drawImage(canvas, 0, 0, width, height);

      // Convert to JPEG blob — hardware accelerated in most browsers
      // ~30-60KB per frame at 640x360 vs 921KB raw RGBA
      const blob = await new Promise<Blob | null>((resolve) =>
        scaleCanvas.toBlob(resolve, 'image/jpeg', 0.85)
      );
      if (!blob) return;

      // Convert to base64 for Tauri IPC
      const buffer = await blob.arrayBuffer();
      const base64 = arrayBufferToBase64(buffer);

      // Send JPEG frame to Rust — base64 string (~40-80KB) instead of
      // JSON number array (~3-4MB for raw RGBA)
      await invoke('write_frame', { data: base64 });

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
    } catch (err: any) {
      const errMsg = typeof err === 'string' ? err : err?.message || String(err);

      // STREAM_DEAD = FFmpeg process has exited. Stop the frame loop immediately
      // instead of spamming hundreds of failed write attempts.
      if (errMsg.includes('STREAM_DEAD')) {
        console.error('[GPU] FFmpeg process died — stopping frame loop');
        if (frameLoopRef.current !== null) {
          cancelAnimationFrame(frameLoopRef.current);
          frameLoopRef.current = null;
        }
        canvasRef.current = null;
        setIsStreaming(false);
        setStats(prev => ({ ...prev, isActive: false }));
        return;
      }

      console.error('[GPU] Frame encode error:', errMsg);
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
