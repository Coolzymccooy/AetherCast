import { useEffect, useRef, useState, useCallback } from 'react';
import ScreenCapture from '../plugins/screenCapture';

interface UseScreenCaptureResult {
  /** A MediaStream derived from native screen frames — only set when capturing */
  stream: MediaStream | null;
  isCapturing: boolean;
  error: string | null;
  startCapture: () => Promise<void>;
  stopCapture: () => void;
}

const CAPTURE_WIDTH = 1280;
const CAPTURE_HEIGHT = 720;
const CAPTURE_FPS = 15;

/**
 * Canvas bridge: native JPEG frames → drawImage → captureStream(fps) → MediaStream.
 *
 * The Android plugin fires 'frameReady' events at ~15fps with base64 JPEG data.
 * We draw each frame onto a hidden <canvas> and expose canvas.captureStream(15)
 * as a regular MediaStream for PeerJS / WebRTC.
 */
export function useScreenCapture(): UseScreenCaptureResult {
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [isCapturing, setIsCapturing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const listenerRef = useRef<{ remove: () => void } | null>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const ensureCanvas = useCallback((): HTMLCanvasElement => {
    if (!canvasRef.current) {
      const canvas = document.createElement('canvas');
      canvas.width = CAPTURE_WIDTH;
      canvas.height = CAPTURE_HEIGHT;
      canvas.style.display = 'none';
      document.body.appendChild(canvas);
      canvasRef.current = canvas;
    }
    return canvasRef.current;
  }, []);

  const stopCapture = useCallback(() => {
    listenerRef.current?.remove();
    listenerRef.current = null;
    ScreenCapture.removeAllListeners().catch(() => { /* ok if bridge is not ready */ });
    ScreenCapture.stopCapture().catch(() => { /* ok if already stopped */ });

    streamRef.current?.getTracks().forEach(track => track.stop());
    streamRef.current = null;

    if (canvasRef.current) {
      document.body.removeChild(canvasRef.current);
      canvasRef.current = null;
    }
    setStream(null);
    setIsCapturing(false);
  }, []);

  const startCapture = useCallback(async () => {
    setError(null);
    try {
      const canvas = ensureCanvas();
      const ctx = canvas.getContext('2d')!;

      // Reuse one Image element for decoding frames
      if (!imgRef.current) imgRef.current = new Image();
      const img = imgRef.current;

      const listener = await ScreenCapture.addListener('frameReady', ({ jpeg }) => {
        img.onload = () => ctx.drawImage(img, 0, 0, CAPTURE_WIDTH, CAPTURE_HEIGHT);
        img.src = `data:image/jpeg;base64,${jpeg}`;
      });

      await ScreenCapture.startCapture({ width: CAPTURE_WIDTH, height: CAPTURE_HEIGHT, fps: CAPTURE_FPS });

      // Capture MediaStream from canvas at the same fps after the listener is wired up
      const mediaStream = canvas.captureStream(CAPTURE_FPS);
      listenerRef.current = listener;
      streamRef.current = mediaStream;
      setStream(mediaStream);
      setIsCapturing(true);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Screen capture failed';
      setError(msg);
      stopCapture();
    }
  }, [ensureCanvas, stopCapture]);

  // Clean up on unmount
  useEffect(() => {
    return () => {
      listenerRef.current?.remove();
      if (canvasRef.current) {
        try { document.body.removeChild(canvasRef.current); } catch { /* ok */ }
        canvasRef.current = null;
      }
      ScreenCapture.stopCapture().catch(() => { /* ok */ });
      streamRef.current?.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    };
  }, []);

  return { stream, isCapturing, error, startCapture, stopCapture };
}
