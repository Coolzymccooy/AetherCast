import { useEffect, useRef, useState, useCallback } from 'react';
import ScreenCapture from '../plugins/screenCapture';
import { applyVideoTrackProfile } from '../utils/videoQuality';

export interface CaptureProfile {
  width: number;
  height: number;
  fps: number;
}

interface UseScreenCaptureResult {
  stream: MediaStream | null;
  isCapturing: boolean;
  error: string | null;
  framesRendered: number;
  captureProfile: CaptureProfile | null;
  startCapture: () => Promise<void>;
  stopCapture: () => void;
}

const CAPTURE_FPS = 12;
const MAX_CAPTURE_LONG_EDGE = 1600;
const MAX_CAPTURE_SHORT_EDGE = 900;
const MIN_CAPTURE_LONG_EDGE = 960;
const MIN_CAPTURE_SHORT_EDGE = 540;

const roundToEven = (value: number): number => {
  const rounded = Math.round(value);
  return rounded % 2 === 0 ? rounded : rounded + 1;
};

const getCaptureProfile = (): CaptureProfile => {
  const viewportWidth = Math.max(window.innerWidth, 1);
  const viewportHeight = Math.max(window.innerHeight, 1);
  const deviceScale = Math.min(window.devicePixelRatio || 1, 2);
  const nativeWidth = viewportWidth * deviceScale;
  const nativeHeight = viewportHeight * deviceScale;
  const isPortrait = nativeHeight >= nativeWidth;
  const aspect = nativeWidth / nativeHeight;
  const nativeLongEdge = Math.max(nativeWidth, nativeHeight);
  const targetLongEdge = Math.min(MAX_CAPTURE_LONG_EDGE, Math.max(MIN_CAPTURE_LONG_EDGE, nativeLongEdge));

  let width = isPortrait ? targetLongEdge * aspect : targetLongEdge;
  let height = isPortrait ? targetLongEdge : targetLongEdge / aspect;
  const currentShortEdge = Math.min(width, height);

  if (currentShortEdge > MAX_CAPTURE_SHORT_EDGE) {
    const scale = MAX_CAPTURE_SHORT_EDGE / currentShortEdge;
    width *= scale;
    height *= scale;
  } else if (currentShortEdge < MIN_CAPTURE_SHORT_EDGE) {
    const scale = MIN_CAPTURE_SHORT_EDGE / currentShortEdge;
    width *= scale;
    height *= scale;
  }

  return {
    width: roundToEven(width),
    height: roundToEven(height),
    fps: CAPTURE_FPS,
  };
};

export function useScreenCapture(): UseScreenCaptureResult {
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [isCapturing, setIsCapturing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [framesRendered, setFramesRendered] = useState(0);
  const [captureProfile, setCaptureProfile] = useState<CaptureProfile | null>(null);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const listenerRef = useRef<{ remove: () => void } | null>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const decodeBusyRef = useRef(false);
  const firstFrameTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const ensureCanvas = useCallback((profile: CaptureProfile): HTMLCanvasElement => {
    if (!canvasRef.current) {
      const canvas = document.createElement('canvas');
      canvas.style.display = 'none';
      document.body.appendChild(canvas);
      canvasRef.current = canvas;
    }

    canvasRef.current.width = profile.width;
    canvasRef.current.height = profile.height;
    return canvasRef.current;
  }, []);

  const stopCapture = useCallback(() => {
    if (firstFrameTimeoutRef.current) {
      clearTimeout(firstFrameTimeoutRef.current);
      firstFrameTimeoutRef.current = null;
    }

    listenerRef.current?.remove();
    listenerRef.current = null;
    ScreenCapture.removeAllListeners().catch(() => { /* bridge can already be gone */ });
    ScreenCapture.stopCapture().catch(() => { /* already stopped */ });

    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    decodeBusyRef.current = false;

    if (canvasRef.current) {
      document.body.removeChild(canvasRef.current);
      canvasRef.current = null;
    }

    setStream(null);
    setIsCapturing(false);
    setFramesRendered(0);
    setCaptureProfile(null);
  }, []);

  const startCapture = useCallback(async () => {
    setError(null);
    setFramesRendered(0);

    try {
      const profile = getCaptureProfile();
      const canvas = ensureCanvas(profile);
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('Screen capture canvas is unavailable');

      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      setCaptureProfile(profile);

      if (!imgRef.current) imgRef.current = new Image();
      const img = imgRef.current;

      const listener = await ScreenCapture.addListener('frameReady', ({ jpeg }) => {
        if (decodeBusyRef.current) return;

        decodeBusyRef.current = true;
        img.onload = () => {
          ctx.clearRect(0, 0, profile.width, profile.height);
          ctx.drawImage(img, 0, 0, profile.width, profile.height);
          decodeBusyRef.current = false;

          if (firstFrameTimeoutRef.current) {
            clearTimeout(firstFrameTimeoutRef.current);
            firstFrameTimeoutRef.current = null;
          }

          setFramesRendered((prev) => prev + 1);
        };
        img.onerror = () => {
          decodeBusyRef.current = false;
        };
        img.src = `data:image/jpeg;base64,${jpeg}`;
      });

      await ScreenCapture.startCapture(profile);

      const mediaStream = canvas.captureStream(profile.fps);
      applyVideoTrackProfile(mediaStream.getVideoTracks()[0], 'screen');

      listenerRef.current = listener;
      streamRef.current = mediaStream;
      setStream(mediaStream);
      setIsCapturing(true);
      firstFrameTimeoutRef.current = setTimeout(() => {
        setError('Screen capture started but no frames were received from Android.');
        stopCapture();
      }, 5000);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Screen capture failed';
      setError(message);
      stopCapture();
    }
  }, [ensureCanvas, stopCapture]);

  useEffect(() => {
    return () => {
      listenerRef.current?.remove();
      if (firstFrameTimeoutRef.current) {
        clearTimeout(firstFrameTimeoutRef.current);
        firstFrameTimeoutRef.current = null;
      }
      if (canvasRef.current) {
        try {
          document.body.removeChild(canvasRef.current);
        } catch {
          // ignore detach failures during teardown
        }
        canvasRef.current = null;
      }
      ScreenCapture.stopCapture().catch(() => { /* already stopped */ });
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    };
  }, []);

  return { stream, isCapturing, error, framesRendered, captureProfile, startCapture, stopCapture };
}
