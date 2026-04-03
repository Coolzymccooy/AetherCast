import { useState, useRef, useCallback, useEffect } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import type { StreamDestination, ServerLog, EncodingProfile } from '../types';

interface UseGPUStreamingOptions {
  setTelemetry?: Dispatch<SetStateAction<any>>;
  setServerLogs?: Dispatch<SetStateAction<ServerLog[]>>;
  onError?: (message: string) => void;
  onSuccess?: (message: string) => void;
}

interface NativeStreamStats {
  frames: number;
  active: boolean;
  desired_active: boolean;
  restarting: boolean;
  restart_count: number;
  max_restarts: number;
  encoder: string;
  is_gpu: boolean;
  width: number;
  height: number;
  fps: number;
  bitrate_kbps: number;
  bytes_written: number;
  write_failures: number;
  keepalive_frames: number;
  archive_path_pattern?: string | null;
  archive_segment_seconds: number;
  last_restart_delay_ms: number;
  last_error?: string | null;
  last_exit_status?: string | null;
  ffmpeg_path: string;
  last_frame_age_ms: number;
  uptime_ms: number;
  lavfi_enabled: boolean;
}

interface GPUStreamStats {
  framesEncoded: number;
  isActive: boolean;
  encoder: string;
  isGPU: boolean;
  fps: number;
  droppedFrames: number;
  restarting: boolean;
  restartCount: number;
  keepaliveFrames: number;
  bitrateKbps: number;
  width: number;
  height: number;
  archivePathPattern: string | null;
  archiveSegmentSeconds: number;
  lastRestartDelayMs: number;
  lastError: string | null;
  uptimeMs: number;
}

type NativeCaptureProfile = {
  width: number;
  height: number;
  fps: number;
  bitrate: number;
  jpegQuality: number;
};

const STATS_POLL_MS = 1500;

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  const chunks: string[] = [];
  for (let i = 0; i < bytes.length; i += 8192) {
    chunks.push(String.fromCharCode.apply(null, bytes.subarray(i, i + 8192) as any));
  }
  return btoa(chunks.join(''));
}

function resolveCaptureProfile(
  encodingProfile: EncodingProfile | undefined,
  isGPU: boolean,
  overrides?: { width?: number; height?: number; fps?: number; bitrate?: number },
): NativeCaptureProfile {
  const profile = encodingProfile || '1080p30';

  let base: NativeCaptureProfile;
  switch (profile) {
    case '1080p60':
    case '1080p30':
      base = isGPU
        ? { width: 1280, height: 720, fps: 30, bitrate: 6000, jpegQuality: 0.88 }
        : { width: 960, height: 540, fps: 30, bitrate: 3500, jpegQuality: 0.84 };
      break;
    case '720p30':
      base = isGPU
        ? { width: 1280, height: 720, fps: 30, bitrate: 4500, jpegQuality: 0.86 }
        : { width: 960, height: 540, fps: 30, bitrate: 3000, jpegQuality: 0.82 };
      break;
    case '480p30':
    default:
      base = { width: 854, height: 480, fps: 30, bitrate: 2000, jpegQuality: 0.8 };
      break;
  }

  return {
    width: overrides?.width || base.width,
    height: overrides?.height || base.height,
    fps: overrides?.fps || base.fps,
    bitrate: overrides?.bitrate || base.bitrate,
    jpegQuality: base.jpegQuality,
  };
}

export function useGPUStreaming(options: UseGPUStreamingOptions = {}) {
  const [isStreaming, setIsStreaming] = useState(false);
  const [stats, setStats] = useState<GPUStreamStats>({
    framesEncoded: 0,
    isActive: false,
    encoder: 'detecting...',
    isGPU: false,
    fps: 0,
    droppedFrames: 0,
    restarting: false,
    restartCount: 0,
    keepaliveFrames: 0,
    bitrateKbps: 0,
    width: 0,
    height: 0,
    archivePathPattern: null,
    archiveSegmentSeconds: 0,
    lastRestartDelayMs: 0,
    lastError: null,
    uptimeMs: 0,
  });
  const [encoderInfo, setEncoderInfo] = useState<{ encoder: string; isGPU: boolean; ffmpegPath: string } | null>(null);

  const frameLoopRef = useRef<number | null>(null);
  const statsPollRef = useRef<number | null>(null);
  const lastFrameTimeRef = useRef(0);
  const frameCountRef = useRef(0);
  const droppedRef = useRef(0);
  const sendingRef = useRef(false);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const fpsRef = useRef(30);
  const widthRef = useRef(1280);
  const heightRef = useRef(720);
  const jpegQualityRef = useRef(0.86);
  const scaleCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const invokeRef = useRef<any>(null);
  const isStreamingRef = useRef(false);
  const lastNativeStateRef = useRef<NativeStreamStats | null>(null);

  const addServerLog = useCallback((message: string, type: ServerLog['type']) => {
    if (!options.setServerLogs) return;
    options.setServerLogs((prev) => [
      { message, type, id: Date.now() + Math.random() } as ServerLog,
      ...prev,
    ]);
  }, [options]);

  const stopStatsPolling = useCallback(() => {
    if (statsPollRef.current !== null) {
      window.clearInterval(statsPollRef.current);
      statsPollRef.current = null;
    }
  }, []);

  const applyNativeStats = useCallback((native: NativeStreamStats) => {
    lastNativeStateRef.current = native;
    setStats({
      framesEncoded: native.frames,
      isActive: native.active,
      encoder: native.encoder,
      isGPU: native.is_gpu,
      fps: native.fps,
      droppedFrames: droppedRef.current + native.write_failures,
      restarting: native.restarting,
      restartCount: native.restart_count,
      keepaliveFrames: native.keepalive_frames,
      bitrateKbps: native.bitrate_kbps,
      width: native.width,
      height: native.height,
      archivePathPattern: native.archive_path_pattern || null,
      archiveSegmentSeconds: native.archive_segment_seconds,
      lastRestartDelayMs: native.last_restart_delay_ms,
      lastError: native.last_error || null,
      uptimeMs: native.uptime_ms,
    });

    options.setTelemetry?.((prev: any) => ({
      ...prev,
      bitrate: native.bitrate_kbps > 0 ? `${(native.bitrate_kbps / 1000).toFixed(1)} Mbps` : prev.bitrate,
      fps: native.fps || prev.fps,
      droppedFrames: droppedRef.current + native.write_failures,
      network: native.restarting ? 'fair' : native.last_frame_age_ms > 1500 ? 'good' : 'excellent',
    }));
  }, [options]);

  const pollNativeState = useCallback(async () => {
    if (!invokeRef.current) return null;

    try {
      const result = await invokeRef.current('get_stream_stats');
      const native = JSON.parse(result as string) as NativeStreamStats;
      const previous = lastNativeStateRef.current;

      if (native.restarting && !previous?.restarting) {
        addServerLog(
          `Native encoder restarting (${native.restart_count}/${native.max_restarts}) in ${(native.last_restart_delay_ms / 1000).toFixed(0)}s`,
          'warning',
        );
      }

      if (!native.restarting && previous?.restarting) {
        addServerLog('Native encoder recovered after restart', 'success');
      }

      if (native.archive_path_pattern && native.archive_path_pattern !== previous?.archive_path_pattern) {
        addServerLog(`Local safety archive enabled: ${native.archive_path_pattern}`, 'info');
      }

      if (native.last_error && native.last_error !== previous?.last_error) {
        addServerLog(`[native] ${native.last_error}`, 'error');
      }

      applyNativeStats(native);

      if (
        isStreamingRef.current &&
        !native.desired_active &&
        !native.active &&
        !native.restarting
      ) {
        stopStatsPolling();
        if (frameLoopRef.current !== null) {
          cancelAnimationFrame(frameLoopRef.current);
          frameLoopRef.current = null;
        }
        canvasRef.current = null;
        sendingRef.current = false;
        isStreamingRef.current = false;
        setIsStreaming(false);
        options.onError?.(
          `Native stream stopped: ${native.last_error || native.last_exit_status || 'FFmpeg exited unexpectedly'}`,
        );
      }

      return native;
    } catch (err: any) {
      const message = err?.message || String(err);
      addServerLog(`Native stats polling failed: ${message}`, 'warning');
      return null;
    }
  }, [addServerLog, applyNativeStats, options, stopStatsPolling]);

  const startStatsPolling = useCallback(() => {
    stopStatsPolling();
    void pollNativeState();
    statsPollRef.current = window.setInterval(() => {
      void pollNativeState();
    }, STATS_POLL_MS);
  }, [pollNativeState, stopStatsPolling]);

  useEffect(() => {
    if (!window.__TAURI_INTERNALS__) return;

    let disposed = false;

    import('@tauri-apps/api/core').then(({ invoke }) => {
      if (disposed) return;
      invokeRef.current = invoke;

      invoke('detect_encoder').then((result: any) => {
        if (disposed) return;
        try {
          const info = JSON.parse(result as string);
          setEncoderInfo(info);
          setStats((prev) => ({ ...prev, encoder: info.encoder, isGPU: info.isGPU }));
          console.log('[GPU] Encoder detected:', info);
        } catch {
          // Ignore JSON parse issues here.
        }
      }).catch((err) => console.log('[GPU] Encoder detection failed:', err));
    });

    return () => {
      disposed = true;
      stopStatsPolling();
    };
  }, [stopStatsPolling]);

  const captureAndSendFrame = useCallback(async (
    canvas: HTMLCanvasElement,
  ) => {
    if (!invokeRef.current) return;
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

      scaleCtx.drawImage(canvas, 0, 0, widthRef.current, heightRef.current);

      const blob = await new Promise<Blob | null>((resolve) =>
        scaleCanvas.toBlob(resolve, 'image/jpeg', jpegQualityRef.current),
      );
      if (!blob) return;

      const buffer = await blob.arrayBuffer();
      const base64 = arrayBufferToBase64(buffer);

      await invokeRef.current('write_frame', { data: base64 });

      frameCountRef.current++;
      if (frameCountRef.current % 30 === 0) {
        setStats((prev) => ({
          ...prev,
          framesEncoded: frameCountRef.current,
          droppedFrames: droppedRef.current,
        }));
      }
    } catch (err: any) {
      const message = typeof err === 'string' ? err : err?.message || String(err);

      if (message.includes('STREAM_RESTARTING')) {
        droppedRef.current++;
        return;
      }

      if (message.includes('STREAM_DEAD')) {
        addServerLog('Native encoder died and could not recover', 'error');
        if (frameLoopRef.current !== null) {
          cancelAnimationFrame(frameLoopRef.current);
          frameLoopRef.current = null;
        }
        canvasRef.current = null;
        isStreamingRef.current = false;
        setIsStreaming(false);
        stopStatsPolling();
        options.onError?.('Native encoder stopped unexpectedly.');
        return;
      }

      console.error('[GPU] Frame encode error:', message);
      droppedRef.current++;
    } finally {
      sendingRef.current = false;
    }
  }, [addServerLog, options, stopStatsPolling]);

  const startGPUStream = useCallback(async (
    canvas: HTMLCanvasElement,
    destinations: StreamDestination[],
    startOptions?: { width?: number; height?: number; fps?: number; bitrate?: number; encoder?: string; encodingProfile?: EncodingProfile },
  ) => {
    if (!window.__TAURI_INTERNALS__) {
      throw new Error('GPU streaming requires Tauri desktop app');
    }

    if (!invokeRef.current) {
      const { invoke } = await import('@tauri-apps/api/core');
      invokeRef.current = invoke;
    }

    const nativeProfile = resolveCaptureProfile(
      startOptions?.encodingProfile,
      encoderInfo?.isGPU ?? true,
      startOptions,
    );

    fpsRef.current = nativeProfile.fps;
    widthRef.current = nativeProfile.width;
    heightRef.current = nativeProfile.height;
    jpegQualityRef.current = nativeProfile.jpegQuality;
    canvasRef.current = canvas;
    isStreamingRef.current = true;

    if (!scaleCanvasRef.current) {
      scaleCanvasRef.current = document.createElement('canvas');
    }
    scaleCanvasRef.current.width = nativeProfile.width;
    scaleCanvasRef.current.height = nativeProfile.height;

    try {
      const result = await invokeRef.current('start_stream', {
        config: {
          destinations: destinations.map((d) => ({
            url: d.rtmpUrl || d.url || '',
            stream_key: d.streamKey,
            protocol: d.protocol || 'rtmp',
            name: d.name,
            enabled: d.enabled,
            rtmp_url: d.rtmpUrl,
          })),
          width: nativeProfile.width,
          height: nativeProfile.height,
          fps: nativeProfile.fps,
          bitrate: nativeProfile.bitrate,
          encoder: startOptions?.encoder || 'auto',
          mode: 'jpeg',
        },
      });

      frameCountRef.current = 0;
      droppedRef.current = 0;
      lastFrameTimeRef.current = 0;
      lastNativeStateRef.current = null;
      setIsStreaming(true);
      addServerLog(
        `Native stream started at ${nativeProfile.width}x${nativeProfile.height} ${nativeProfile.fps}fps`,
        'success',
      );
      startStatsPolling();

      const frameDuration = 1000 / nativeProfile.fps;
      const captureLoop = (time: number) => {
        if (!canvasRef.current || !isStreamingRef.current) return;

        const elapsed = time - lastFrameTimeRef.current;
        if (elapsed >= frameDuration) {
          lastFrameTimeRef.current = time - (elapsed % frameDuration);
          void captureAndSendFrame(canvasRef.current);
        }

        frameLoopRef.current = requestAnimationFrame(captureLoop);
      };

      frameLoopRef.current = requestAnimationFrame(captureLoop);
      options.onSuccess?.(result as string);
      return result as string;
    } catch (err) {
      canvasRef.current = null;
      isStreamingRef.current = false;
      setIsStreaming(false);
      throw err;
    }
  }, [addServerLog, captureAndSendFrame, encoderInfo, options, startStatsPolling]);

  const stopGPUStream = useCallback(async () => {
    if (frameLoopRef.current !== null) {
      cancelAnimationFrame(frameLoopRef.current);
      frameLoopRef.current = null;
    }
    canvasRef.current = null;
    isStreamingRef.current = false;
    stopStatsPolling();

    if (!window.__TAURI_INTERNALS__ || !invokeRef.current) {
      setIsStreaming(false);
      return;
    }

    try {
      const result = await invokeRef.current('stop_stream');
      addServerLog(result as string, 'info');
    } catch (err: any) {
      console.error('[GPU] Stop error:', err);
      addServerLog(`Native stop failed: ${err?.message || err}`, 'error');
    }

    setIsStreaming(false);
    setStats((prev) => ({
      ...prev,
      isActive: false,
      restarting: false,
    }));
  }, [addServerLog, stopStatsPolling]);

  useEffect(() => {
    return () => {
      stopStatsPolling();
      if (frameLoopRef.current !== null) {
        cancelAnimationFrame(frameLoopRef.current);
      }
    };
  }, [stopStatsPolling]);

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
