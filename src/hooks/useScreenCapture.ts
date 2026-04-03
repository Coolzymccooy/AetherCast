import { useEffect, useRef, useState, useCallback } from 'react';
import ScreenCapture from '../plugins/screenCapture';

interface UseScreenCaptureResult {
  /** A MediaStream derived from native screen frames — only set when capturing */
  stream: MediaStream | null;
  isCapturing: boolean;
  error: string | null;
  framesRendered: number;
  startCapture: () => Promise<void>;
  stopCapture: () => void;
}

const CAPTURE_WIDTH = 720;
const CAPTURE_HEIGHT = 405;
const CAPTURE_FPS = 8;

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
  const [framesRendered, setFramesRendered] = useState(0);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const listenerRef = useRef<{ remove: () => void } | null>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const decodeBusyRef = useRef(false);
  const firstFrameTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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
    if (firstFrameTimeoutRef.current) {
      clearTimeout(firstFrameTimeoutRef.current);
      firstFrameTimeoutRef.current = null;
    }
    listenerRef.current?.remove();
    listenerRef.current = null;
    ScreenCapture.removeAllListeners().catch(() => { /* ok if bridge is not ready */ });
    ScreenCapture.stopCapture().catch(() => { /* ok if already stopped */ });

    streamRef.current?.getTracks().forEach(track => track.stop());
    streamRef.current = null;
    decodeBusyRef.current = false;

    if (canvasRef.current) {
      document.body.removeChild(canvasRef.current);
      canvasRef.current = null;
    }
    setStream(null);
    setIsCapturing(false);
    setFramesRendered(0);
  }, []);

  const startCapture = useCallback(async () => {
    setError(null);
    setFramesRendered(0);
    try {
      const canvas = ensureCanvas();
      const ctx = canvas.getContext('2d')!;

      // Reuse one Image element for decoding frames
      if (!imgRef.current) imgRef.current = new Image();
      const img = imgRef.current;

      const listener = await ScreenCapture.addListener('frameReady', ({ jpeg }) => {
        if (decodeBusyRef.current) return;

        decodeBusyRef.current = true;
        img.onload = () => {
          ctx.drawImage(img, 0, 0, CAPTURE_WIDTH, CAPTURE_HEIGHT);
          decodeBusyRef.current = false;
          if (firstFrameTimeoutRef.current) {
            clearTimeout(firstFrameTimeoutRef.current);
            firstFrameTimeoutRef.current = null;
          }
          setFramesRendered(prev => prev + 1);
        };
        img.onerror = () => {
          decodeBusyRef.current = false;
        };
        img.src = `data:image/jpeg;base64,${jpeg}`;
      });

      await ScreenCapture.startCapture({ width: CAPTURE_WIDTH, height: CAPTURE_HEIGHT, fps: CAPTURE_FPS });

      // Capture MediaStream from canvas at the same fps after the listener is wired up
      const mediaStream = canvas.captureStream(CAPTURE_FPS);
      listenerRef.current = listener;
      streamRef.current = mediaStream;
      setStream(mediaStream);
      setIsCapturing(true);
      firstFrameTimeoutRef.current = setTimeout(() => {
        setError('Screen capture started but no frames were received from Android.');
        stopCapture();
      }, 5000);
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
      if (firstFrameTimeoutRef.current) {
        clearTimeout(firstFrameTimeoutRef.current);
        firstFrameTimeoutRef.current = null;
      }
      if (canvasRef.current) {
        try { document.body.removeChild(canvasRef.current); } catch { /* ok */ }
        canvasRef.current = null;
      }
      ScreenCapture.stopCapture().catch(() => { /* ok */ });
      streamRef.current?.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    };
  }, []);

  return { stream, isCapturing, error, framesRendered, startCapture, stopCapture };
}
