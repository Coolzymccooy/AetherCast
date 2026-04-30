import { useState, useRef, useCallback, useEffect } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import type { StreamDestination, ServerLog, EncodingProfile, Telemetry } from '../types';
import type { NativeSceneSnapshot, NativeSourceDescriptor } from '../lib/sceneSchema';
import {
  parseOutputProgressLine,
  resolveNativeCaptureProfile,
  shouldPreferNativeSourceFrame,
  type NativeCaptureProfile,
} from '../lib/nativeStreaming';

type TauriInvoke = (cmd: string, args?: Record<string, unknown>) => Promise<unknown>;

interface UseNativeEngineOptions {
  setTelemetry?: Dispatch<SetStateAction<Telemetry>>;
  setServerLogs?: Dispatch<SetStateAction<ServerLog[]>>;
  onError?: (message: string) => void;
  onSuccess?: (message: string) => void;
}

type NativeHealthState =
  | 'inactive'
  | 'starting'
  | 'active'
  | 'recovering'
  | 'degraded'
  | 'error'
  | 'stopped';

type NativeAudioKind =
  | 'microphone'
  | 'system'
  | 'virtual'
  | 'synthetic'
  | 'unknown';

type NativeSourceKind =
  | 'camera'
  | 'screen'
  | 'remote'
  | 'browser'
  | 'media'
  | 'overlay'
  | 'background'
  | 'unknown';

interface NativeOutputStatus {
  worker_id: string;
  name: string;
  protocol: string;
  muxer: string;
  target: string;
  recovery_delay_ms: number;
  restart_count: number;
  last_event?: string | null;
  state: NativeHealthState;
  last_error?: string | null;
  last_update_ms: number;
  target_width?: number | null;
  target_height?: number | null;
  target_fps?: number | null;
  target_bitrate_kbps?: number | null;
  measured_fps?: number | null;
  measured_bitrate_kbps?: number | null;
  encoder_speed?: number | null;
  first_progress_ms?: number | null;
  last_progress_ms?: number | null;
}

interface NativeArchiveStatus {
  state: NativeHealthState;
  path_pattern?: string | null;
  segment_seconds: number;
  recovery_delay_ms: number;
  restart_count: number;
  last_event?: string | null;
  last_error?: string | null;
  last_update_ms: number;
}

interface NativeNdiSourceStatus {
  key: string;
  name: string;
  state: NativeHealthState;
  frames_sent: number;
  dropped_frames: number;
  last_frame_ms: number;
  last_frame_age_ms: number;
  last_error?: string | null;
}

export interface NativeNdiStatus {
  state: NativeHealthState;
  health: {
    ok: boolean;
    error?: string | null;
    mock?: boolean;
  };
  active: boolean;
  desired_active: boolean;
  width: number;
  height: number;
  fps: number;
  alpha_enabled: boolean;
  frames_sent: number;
  dropped_frames: number;
  started_at_ms: number;
  uptime_ms: number;
  last_frame_ms: number;
  last_frame_age_ms: number;
  last_error?: string | null;
  sources: NativeNdiSourceStatus[];
}

export interface NativeNdiDiscoveredSource {
  name: string;
  url_address?: string | null;
}

export interface NativeNdiInputStatus {
  state: NativeHealthState;
  active: boolean;
  desired_active: boolean;
  source_name?: string | null;
  routed_source_id: string;
  width: number;
  height: number;
  frames_received: number;
  dropped_frames: number;
  started_at_ms: number;
  uptime_ms: number;
  last_frame_ms: number;
  last_frame_age_ms: number;
  last_error?: string | null;
}

interface NativeAudioInput {
  name: string;
  alternative_name?: string | null;
  kind: NativeAudioKind;
  backend: string;
}

export interface NativeAudioBusConfig {
  busId: string;
  name: string;
  sourceKind: NativeAudioKind | 'media' | 'unknown';
  volume: number;
  muted: boolean;
  delayMs: number;
  monitorEnabled: boolean;
}

interface NativeAudioBusStatus {
  bus_id: string;
  name: string;
  source_kind: NativeAudioKind;
  input_name?: string | null;
  volume: number;
  muted: boolean;
  delay_ms: number;
  monitor_enabled: boolean;
  state: NativeHealthState;
  last_error?: string | null;
  last_event?: string | null;
  last_update_ms: number;
}

interface NativeAudioStatus {
  state: NativeHealthState;
  mode: string;
  backend: string;
  input_count: number;
  sample_rate: number;
  channels: number;
  bitrate_kbps: number;
  source_summary: string;
  inputs: NativeAudioInput[];
  buses: NativeAudioBusStatus[];
  using_synthetic: boolean;
  last_error?: string | null;
  last_event?: string | null;
  last_update_ms: number;
}

interface NativeAudioDiscovery {
  ffmpeg_path: string;
  supports_dshow: boolean;
  supports_lavfi: boolean;
  devices: NativeAudioInput[];
  suggested_status: NativeAudioStatus;
}

interface NativeVideoStatus {
  state: NativeHealthState;
  render_path: string;
  scene_revision: number;
  active_scene_id?: string | null;
  active_scene_name?: string | null;
  scene_type?: string | null;
  layout?: string | null;
  node_count: number;
  visible_node_count: number;
  source_frame_count: number;
  last_sync_ms: number;
  last_render_ms: number;
  last_error?: string | null;
}

interface NativeSourceStatus {
  source_id: string;
  label: string;
  source_kind: NativeSourceKind;
  state: NativeHealthState;
  recovery_delay_ms: number;
  restart_count: number;
  last_event?: string | null;
  source_status?: string | null;
  resolution?: string | null;
  fps?: number | null;
  audio_level?: number | null;
  browser_owned: boolean;
  frame_width: number;
  frame_height: number;
  last_frame_ms: number;
  last_inventory_sync_ms: number;
  last_update_ms: number;
  last_error?: string | null;
}

interface NativeStreamStats {
  frames: number;
  active: boolean;
  desired_active: boolean;
  restarting: boolean;
  restart_count: number;
  max_restarts: number;
  session_id: number;
  encoder: string;
  is_gpu: boolean;
  width: number;
  height: number;
  fps: number;
  bitrate_kbps: number;
  bytes_written: number;
  write_failures: number;
  keepalive_frames: number;
  watchdog_renders: number;
  archive_path_pattern?: string | null;
  archive_segment_seconds: number;
  last_restart_delay_ms: number;
  last_error?: string | null;
  last_exit_status?: string | null;
  ffmpeg_path: string;
  started_at_ms: number;
  last_frame_age_ms: number;
  uptime_ms: number;
  lavfi_enabled: boolean;
  transport_mode: 'bridge' | 'invoke';
  frame_transport: string;
  bridge_url?: string | null;
  bridge_connected: boolean;
  bridge_frames_received: number;
  bridge_bytes_received: number;
  bridge_last_error?: string | null;
  source_bridge_url?: string | null;
  source_bridge_connected_sources: number;
  source_bridge_frames_received: number;
  source_bridge_bytes_received: number;
  source_bridge_last_error?: string | null;
  video_status: NativeVideoStatus;
  source_statuses: NativeSourceStatus[];
  audio_status: NativeAudioStatus;
  output_statuses: NativeOutputStatus[];
  archive_status: NativeArchiveStatus;
  ndi_status: NativeNdiStatus;
  ndi_input_status: NativeNdiInputStatus;
}

interface NativeStartStreamResponse {
  message: string;
  bridge_url?: string | null;
  bridge_token?: string | null;
  source_bridge_url?: string | null;
  transport?: 'bridge' | 'invoke';
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
  watchdogRenders: number;
  bitrateKbps: number;
  width: number;
  height: number;
  frameTransport: string;
  archivePathPattern: string | null;
  archiveSegmentSeconds: number;
  lastRestartDelayMs: number;
  lastError: string | null;
  uptimeMs: number;
  sourceBridgeConnectedSources: number;
  videoStatus: NativeVideoStatus | null;
  sourceStatuses: NativeSourceStatus[];
  audioStatus: NativeAudioStatus | null;
  outputStatuses: NativeOutputStatus[];
  archiveStatus: NativeArchiveStatus | null;
  ndiStatus: NativeNdiStatus | null;
  ndiInputStatus: NativeNdiInputStatus | null;
}

interface NativeDiagnosticsSnapshot {
  capturedAt: number;
  stats: NativeStreamStats;
}

interface NativeDiagnosticsArtifactResult {
  file_path: string;
  check_command: string;
  check_passed: boolean;
  check_exit_code: number;
  stdout: string;
  stderr: string;
}

export type NativeVideoSourceConfig = {
  sourceId: string;
  deviceName: string;
  backend?: string;
  width?: number;
  height?: number;
  fps?: number;
};

export type NativeSceneCaptureSource = {
  sourceId: string;
  element: HTMLVideoElement | HTMLImageElement | HTMLCanvasElement;
};

export type NativeCaptureSurface = {
  canvas: HTMLCanvasElement;
  captureSources?: () => NativeSceneCaptureSource[];
};

type NativeFrameMode = 'raw' | 'native-scene';

const STATS_POLL_MS = 1500;
const BRIDGE_BACKPRESSURE_BYTES = 4 * 1024 * 1024;
const BRIDGE_RECONNECT_MS = 1000;
const NATIVE_READY_TIMEOUT_MS = 30000;
const NATIVE_READY_POLL_MS = 500;
const NATIVE_OUTPUT_STABLE_MS = 3000;
const NATIVE_PROGRESS_MAX_AGE_MS = 8000;
const NATIVE_FRAME_LOOP_MIN_DELAY_MS = 4;
const SOURCE_BRIDGE_FRAME_INTERVAL_MS = 50;

const delay = (ms: number) => new Promise((resolve) => window.setTimeout(resolve, ms));

function resolvePrimaryOutputProgress(native: NativeStreamStats): {
  fps?: number;
  bitrateMbps?: number;
  bitrateKbps?: number;
  encoderSpeed?: number;
} {
  const primaryOutput = native.output_statuses.find((output) => output.protocol !== 'archive');
  if (
    primaryOutput?.measured_fps !== undefined
    || primaryOutput?.measured_bitrate_kbps !== undefined
    || primaryOutput?.encoder_speed !== undefined
  ) {
    return {
      fps: primaryOutput.measured_fps ?? undefined,
      bitrateKbps: primaryOutput.measured_bitrate_kbps ?? undefined,
      bitrateMbps:
        primaryOutput.measured_bitrate_kbps !== undefined
          ? primaryOutput.measured_bitrate_kbps / 1000
          : undefined,
      encoderSpeed: primaryOutput.encoder_speed ?? undefined,
    };
  }

  const line = primaryOutput?.last_event || primaryOutput?.last_error || '';
  return parseOutputProgressLine(line);
}

function resolveMeasuredOutputFps(native: NativeStreamStats): number {
  const progress = resolvePrimaryOutputProgress(native);
  if (progress.fps && Number.isFinite(progress.fps) && progress.fps > 0) {
    return progress.fps;
  }

  if (native.uptime_ms <= 0 || native.frames <= 0) {
    return native.fps || 0;
  }

  return native.frames / Math.max(native.uptime_ms / 1000, 1);
}

function resolveNativeNetworkState(native: NativeStreamStats): 'excellent' | 'good' | 'fair' | 'poor' {
  const progress = resolvePrimaryOutputProgress(native);
  const measuredFps = resolveMeasuredOutputFps(native);
  const primaryOutput = native.output_statuses.find((output) => output.protocol !== 'archive');
  const targetFps = primaryOutput?.target_fps || native.fps || 0;
  const encoderSpeed = progress.encoderSpeed || 0;

  const outputStates = native.output_statuses.map((output) => output.state);

  if (
    outputStates.includes('error') ||
    native.archive_status?.state === 'error' ||
    (!native.active && native.restarting) ||
    (encoderSpeed > 0 && encoderSpeed < 0.7) ||
    (targetFps > 0 && measuredFps > 0 && measuredFps < targetFps * 0.7)
  ) {
    return 'poor';
  }

  if (
    native.restarting ||
    outputStates.includes('recovering') ||
    outputStates.includes('degraded') ||
    native.archive_status?.state === 'recovering' ||
    native.archive_status?.state === 'degraded' ||
    native.write_failures > 0 ||
    (encoderSpeed > 0 && encoderSpeed < 0.95) ||
    (targetFps > 0 && measuredFps > 0 && measuredFps < targetFps * 0.9)
  ) {
    return 'fair';
  }

  if (
    native.last_frame_age_ms > 1500 ||
    (native.transport_mode === 'bridge' && !native.bridge_connected) ||
    (encoderSpeed > 0 && encoderSpeed < 0.98) ||
    (targetFps > 0 && measuredFps > 0 && measuredFps < targetFps * 0.97)
  ) {
    return 'good';
  }

  return 'excellent';
}

function outputStatusKey(status: NativeOutputStatus): string {
  return status.worker_id || `${status.protocol}:${status.target}`;
}

function healthStateLogType(state: NativeHealthState): ServerLog['type'] {
  switch (state) {
    case 'active':
      return 'success';
    case 'recovering':
    case 'degraded':
      return 'warning';
    case 'error':
      return 'error';
    default:
      return 'info';
  }
}

function getCaptureElementDimensions(
  element: HTMLVideoElement | HTMLImageElement | HTMLCanvasElement,
): { width: number; height: number } {
  if (element instanceof HTMLVideoElement) {
    return {
      width: element.videoWidth || element.clientWidth || 0,
      height: element.videoHeight || element.clientHeight || 0,
    };
  }

  if (element instanceof HTMLImageElement) {
    return {
      width: element.naturalWidth || element.width || 0,
      height: element.naturalHeight || element.height || 0,
    };
  }

  return {
    width: element.width || 0,
    height: element.height || 0,
  };
}

export function useNativeEngine(options: UseNativeEngineOptions = {}) {
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
    watchdogRenders: 0,
    bitrateKbps: 0,
    width: 0,
    height: 0,
    frameTransport: 'unknown',
    archivePathPattern: null,
    archiveSegmentSeconds: 0,
    lastRestartDelayMs: 0,
    lastError: null,
    uptimeMs: 0,
    sourceBridgeConnectedSources: 0,
    videoStatus: null,
    sourceStatuses: [],
    audioStatus: null,
    outputStatuses: [],
    archiveStatus: null,
    ndiStatus: null,
    ndiInputStatus: null,
  });
  const statsRef = useRef<GPUStreamStats>(stats);
  const [encoderInfo, setEncoderInfo] = useState<{ encoder: string; isGPU: boolean; ffmpegPath: string } | null>(null);
  const [audioInfo, setAudioInfo] = useState<NativeAudioDiscovery | null>(null);

  useEffect(() => {
    statsRef.current = stats;
  }, [stats]);

  const frameLoopRef = useRef<number | null>(null);
  const frameLoopRunIdRef = useRef(0);
  const statsPollRef = useRef<number | null>(null);
  const diagnosticsHistoryRef = useRef<NativeDiagnosticsSnapshot[]>([]);
  const frameCountRef = useRef(0);
  const droppedRef = useRef(0);
  const sendingRef = useRef(false);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const fpsRef = useRef(30);
  const widthRef = useRef(1280);
  const heightRef = useRef(720);
  const scaleCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const invokeRef = useRef<TauriInvoke | null>(null);
  const isStreamingRef = useRef(false);
  const lastNativeStateRef = useRef<NativeStreamStats | null>(null);
  const bridgeSocketRef = useRef<WebSocket | null>(null);
  const bridgeUrlRef = useRef<string | null>(null);
  const bridgeReconnectTimerRef = useRef<number | null>(null);
  const sourceBridgeUrlRef = useRef<string | null>(null);
  const sourceBridgeSocketsRef = useRef<Map<string, WebSocket>>(new Map());
  const transportModeRef = useRef<'bridge' | 'invoke'>('invoke');
  const lastSceneRevisionRef = useRef<number>(0);
  const lastSourceInventoryHashRef = useRef<string>('');
  const latestSourceInventoryRef = useRef<NativeSourceDescriptor[]>([]);
  const lastOwnedSourceIdsKeyRef = useRef<string>('');
  const latestSceneSnapshotRef = useRef<NativeSceneSnapshot | null>(null);
  const sourceCaptureRef = useRef<(() => NativeSceneCaptureSource[]) | null>(null);
  const sourceScaleCanvasesRef = useRef<Map<string, HTMLCanvasElement>>(new Map());
  const sourceBridgeLastFrameAtRef = useRef<Map<string, number>>(new Map());
  const sourceCaptureFailureKeysRef = useRef<Set<string>>(new Set());
  const frameModeRef = useRef<NativeFrameMode>('raw');
  const activeNativeSourceIdsRef = useRef<Set<string>>(new Set());
  const sourceStoreOwnedSourceIdsRef = useRef<Set<string>>(new Set());
  const lastSyncedBrowserSourceIdsRef = useRef<Set<string>>(new Set());

  const { setServerLogs } = options;
  const addServerLog = useCallback((message: string, type: ServerLog['type']) => {
    if (!setServerLogs) return;
    setServerLogs((prev) => [
      { message, type, id: Date.now() + Math.random() } as ServerLog,
      ...prev,
    ]);
  }, [setServerLogs]);

  const stopStatsPolling = useCallback(() => {
    if (statsPollRef.current !== null) {
      window.clearInterval(statsPollRef.current);
      statsPollRef.current = null;
    }
  }, []);

  const clearBridgeReconnectTimer = useCallback(() => {
    if (bridgeReconnectTimerRef.current !== null) {
      window.clearTimeout(bridgeReconnectTimerRef.current);
      bridgeReconnectTimerRef.current = null;
    }
  }, []);

  const closeBridgeSocket = useCallback((reason?: string) => {
    clearBridgeReconnectTimer();

    const socket = bridgeSocketRef.current;
    bridgeSocketRef.current = null;
    if (!socket) return;

    socket.onopen = null;
    socket.onclose = null;
    socket.onerror = null;

    if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING) {
      try {
        socket.close(1000, reason || 'closing');
      } catch {
        // Ignore close failures during teardown.
      }
    }
  }, [clearBridgeReconnectTimer]);

  const closeSourceBridgeSocket = useCallback((sourceId: string, reason?: string) => {
    const socket = sourceBridgeSocketsRef.current.get(sourceId);
    if (!socket) return;

    sourceBridgeSocketsRef.current.delete(sourceId);
    socket.onopen = null;
    socket.onclose = null;
    socket.onerror = null;

    if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING) {
      try {
        socket.close(1000, reason || 'closing');
      } catch {
        // Ignore close failures during teardown.
      }
    }
  }, []);

  const closeAllSourceBridgeSockets = useCallback((reason?: string) => {
    const sourceIds = Array.from(sourceBridgeSocketsRef.current.keys());
    sourceIds.forEach((sourceId) => closeSourceBridgeSocket(sourceId, reason));
  }, [closeSourceBridgeSocket]);

  const connectBridgeSocket = useCallback(async (
    url: string,
    reconnectReason?: string,
  ): Promise<boolean> => {
    closeBridgeSocket('reconnect');

    return await new Promise<boolean>((resolve) => {
      let settled = false;
      const socket = new WebSocket(url);
      socket.binaryType = 'arraybuffer';
      bridgeSocketRef.current = socket;

      const finish = (connected: boolean) => {
        if (settled) return;
        settled = true;
        resolve(connected);
      };

      socket.onopen = () => {
        addServerLog(
          reconnectReason ? `Native frame bridge recovered (${reconnectReason})` : 'Native frame bridge connected',
          'info',
        );
        finish(true);
      };

      socket.onerror = (event) => {
        addServerLog(`Native frame bridge connection error${reconnectReason ? ` (${reconnectReason})` : ''}: ${(event as ErrorEvent).message || 'WebSocket error'}`, 'warning');
        finish(false);
      };

      socket.onclose = () => {
        if (bridgeSocketRef.current === socket) {
          bridgeSocketRef.current = null;
        }
        const reconnectUrl = bridgeUrlRef.current;
        if (isStreamingRef.current && transportModeRef.current === 'bridge' && reconnectUrl) {
          clearBridgeReconnectTimer();
          bridgeReconnectTimerRef.current = window.setTimeout(() => {
            bridgeReconnectTimerRef.current = null;
            const nextUrl = bridgeUrlRef.current || reconnectUrl;
            if (!isStreamingRef.current || transportModeRef.current !== 'bridge' || !nextUrl) {
              return;
            }
            void connectBridgeSocket(nextUrl, 'socket closed');
          }, BRIDGE_RECONNECT_MS);
        }
        finish(false);
      };
    });
  }, [addServerLog, clearBridgeReconnectTimer, closeBridgeSocket]);

  const ensureSourceBridgeSocket = useCallback(async (
    sourceId: string,
  ): Promise<WebSocket | null> => {
    const bridgeUrl = sourceBridgeUrlRef.current;
    if (!bridgeUrl || !isStreamingRef.current) {
      return null;
    }

    const existing = sourceBridgeSocketsRef.current.get(sourceId);
    if (existing) {
      if (existing.readyState === WebSocket.OPEN) {
        return existing;
      }
      if (existing.readyState === WebSocket.CONNECTING) {
        return null;
      }
      closeSourceBridgeSocket(sourceId, 'reconnect');
    }

    return await new Promise<WebSocket | null>((resolve) => {
      let settled = false;
      const socket = new WebSocket(bridgeUrl);
      socket.binaryType = 'arraybuffer';
      sourceBridgeSocketsRef.current.set(sourceId, socket);

      const finish = (value: WebSocket | null) => {
        if (settled) return;
        settled = true;
        resolve(value);
      };

      socket.onopen = () => {
        try {
          socket.send(JSON.stringify({ source_id: sourceId }));
          finish(socket);
        } catch {
          finish(null);
        }
      };

      socket.onerror = (event) => {
        addServerLog(`Native source bridge connection error for ${sourceId}: ${(event as ErrorEvent).message || 'WebSocket error'}`, 'warning');
        finish(null);
      };

      socket.onclose = () => {
        if (sourceBridgeSocketsRef.current.get(sourceId) === socket) {
          sourceBridgeSocketsRef.current.delete(sourceId);
        }
        finish(null);
      };
    });
  }, [closeSourceBridgeSocket]);

  const sendSourceFrameViaBridge = useCallback(async (
    sourceId: string,
    width: number,
    height: number,
    frameBytes: Uint8Array,
  ): Promise<boolean> => {
    const socket = await ensureSourceBridgeSocket(sourceId);
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      return false;
    }

    if (socket.bufferedAmount >= BRIDGE_BACKPRESSURE_BYTES) {
      return false;
    }

    const packet = new Uint8Array(8 + frameBytes.byteLength);
    const view = new DataView(packet.buffer);
    view.setUint32(0, width, true);
    view.setUint32(4, height, true);
    packet.set(frameBytes, 8);
    socket.send(packet);
    return true;
  }, [ensureSourceBridgeSocket]);

  const applyNativeStats = useCallback((native: NativeStreamStats) => {
    lastNativeStateRef.current = native;
    transportModeRef.current = native.transport_mode || 'invoke';
    bridgeUrlRef.current = native.bridge_url || null;
    const progress = resolvePrimaryOutputProgress(native);
    const measuredFps = resolveMeasuredOutputFps(native);
    const displayedBitrate = progress.bitrateMbps && progress.bitrateMbps > 0
      ? `${progress.bitrateMbps.toFixed(1)} Mbps`
      : undefined;

    setStats({
      framesEncoded: native.frames,
      isActive: native.active,
      encoder: native.encoder,
      isGPU: native.is_gpu,
      fps: measuredFps,
      droppedFrames: droppedRef.current + native.write_failures,
      restarting: native.restarting,
      restartCount: native.restart_count,
      keepaliveFrames: native.keepalive_frames,
      watchdogRenders: native.watchdog_renders,
      bitrateKbps: native.bitrate_kbps,
      width: native.width,
      height: native.height,
      frameTransport: native.frame_transport || 'unknown',
      archivePathPattern: native.archive_path_pattern || null,
      archiveSegmentSeconds: native.archive_segment_seconds,
      lastRestartDelayMs: native.last_restart_delay_ms,
      lastError: native.last_error || null,
      uptimeMs: native.uptime_ms,
      sourceBridgeConnectedSources: native.source_bridge_connected_sources || 0,
      videoStatus: native.video_status || null,
      sourceStatuses: native.source_statuses || [],
      audioStatus: native.audio_status || null,
      outputStatuses: native.output_statuses || [],
      archiveStatus: native.archive_status || null,
      ndiStatus: native.ndi_status || null,
      ndiInputStatus: native.ndi_input_status || null,
    });

    options.setTelemetry?.((prev: any) => ({
      ...prev,
      bitrate: displayedBitrate || prev.bitrate,
      fps: measuredFps || prev.fps,
      droppedFrames: droppedRef.current + native.write_failures,
      network: resolveNativeNetworkState(native),
      nativeFrameTransport: native.frame_transport || prev.nativeFrameTransport,
      nativeVideoState: native.video_status?.state || prev.nativeVideoState,
      nativeVideoScene: native.video_status?.active_scene_name || prev.nativeVideoScene,
      nativeSourceHealth: native.source_statuses?.map((source) => ({
        name: source.label,
        state: source.state,
      })) || [],
      nativeAudioState: native.audio_status?.state || prev.nativeAudioState,
      nativeAudioSource: native.audio_status?.source_summary || prev.nativeAudioSource,
      nativeOutputHealth: native.output_statuses?.map((output) => ({
        name: output.name,
        state: output.state,
      })) || [],
      nativeArchiveState: native.archive_status?.state || prev.nativeArchiveState,
      nativeSourceBridgeConnectedSources: native.source_bridge_connected_sources || 0,
    }));
  }, [options]);

  const pollNativeState = useCallback(async () => {
    if (!invokeRef.current) return null;

    try {
      const result = await invokeRef.current('get_stream_stats');
      const parsed = JSON.parse(result as string) as Partial<NativeStreamStats>;
      const native = {
        session_id: 0,
        audio_status: {
          state: 'inactive',
          mode: 'silent',
          backend: 'none',
          input_count: 0,
          sample_rate: 48000,
          channels: 2,
          bitrate_kbps: 160,
          source_summary: 'No native audio input',
          inputs: [],
          buses: [],
          using_synthetic: false,
          last_error: null,
          last_event: null,
          last_update_ms: 0,
        },
        frame_transport: 'unknown',
        source_bridge_url: null,
        source_bridge_connected_sources: 0,
        source_bridge_frames_received: 0,
        source_bridge_bytes_received: 0,
        source_bridge_last_error: null,
        video_status: {
          state: 'inactive',
          render_path: 'unsynced',
          scene_revision: 0,
          active_scene_id: null,
          active_scene_name: null,
          scene_type: null,
          layout: null,
          node_count: 0,
          visible_node_count: 0,
          source_frame_count: 0,
          last_sync_ms: 0,
          last_render_ms: 0,
          last_error: null,
        },
        source_statuses: [],
        output_statuses: [],
        archive_status: {
          state: 'inactive',
          path_pattern: null,
          segment_seconds: 0,
          recovery_delay_ms: 0,
          restart_count: 0,
          last_event: null,
          last_error: null,
          last_update_ms: 0,
        },
        ndi_status: {
          state: 'inactive',
          health: { ok: false, error: null },
          active: false,
          desired_active: false,
          width: 1920,
          height: 1080,
          fps: 30,
          alpha_enabled: true,
          frames_sent: 0,
          dropped_frames: 0,
          started_at_ms: 0,
          uptime_ms: 0,
          last_frame_ms: 0,
          last_frame_age_ms: 0,
          last_error: null,
          sources: [],
        },
        ndi_input_status: {
          state: 'inactive',
          active: false,
          desired_active: false,
          source_name: null,
          routed_source_id: 'camera:local-2',
          width: 0,
          height: 0,
          frames_received: 0,
          dropped_frames: 0,
          started_at_ms: 0,
          uptime_ms: 0,
          last_frame_ms: 0,
          last_frame_age_ms: 0,
          last_error: null,
        },
        started_at_ms: 0,
        ...parsed,
      } as NativeStreamStats;
      const previous = lastNativeStateRef.current;
      diagnosticsHistoryRef.current.push({
        capturedAt: Date.now(),
        stats: native,
      });
      if (diagnosticsHistoryRef.current.length > 7200) {
        diagnosticsHistoryRef.current = diagnosticsHistoryRef.current.slice(-7200);
      }

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

      if (
        native.source_bridge_connected_sources !== undefined &&
        native.source_bridge_connected_sources !== previous?.source_bridge_connected_sources
      ) {
        addServerLog(
          `[source-bridge] ${native.source_bridge_connected_sources} source connection${native.source_bridge_connected_sources === 1 ? '' : 's'} active`,
          native.source_bridge_connected_sources > 0 ? 'info' : 'warning',
        );
      }

      if (!previous?.video_status) {
        addServerLog(
          `[video] ${native.video_status.state} (${native.video_status.render_path}, scene ${native.video_status.active_scene_name || 'unsynced'})`,
          healthStateLogType(native.video_status.state),
        );
      } else if (
        native.video_status.scene_revision !== previous.video_status.scene_revision ||
        native.video_status.state !== previous.video_status.state ||
        native.video_status.last_error !== previous.video_status.last_error
      ) {
        const detail = native.video_status.last_error ? `: ${native.video_status.last_error}` : '';
        addServerLog(
          `[video] ${native.video_status.state} (${native.video_status.render_path}, scene ${native.video_status.active_scene_name || 'unsynced'}, nodes ${native.video_status.visible_node_count}/${native.video_status.node_count})${detail}`,
          healthStateLogType(native.video_status.state),
        );
      }

      for (const source of native.source_statuses || []) {
        const previousSource = previous?.source_statuses?.find(
          (candidate) => candidate.source_id === source.source_id,
        );

        if (!previousSource) {
          addServerLog(
            `[source:${source.label}] ${source.state} (${source.source_kind}${source.frame_width && source.frame_height ? ` ${source.frame_width}x${source.frame_height}` : ''})`,
            healthStateLogType(source.state),
          );
          continue;
        }

        if (
          previousSource.state !== source.state ||
          previousSource.last_error !== source.last_error ||
          previousSource.frame_width !== source.frame_width ||
          previousSource.frame_height !== source.frame_height
        ) {
          const detail = source.last_error ? `: ${source.last_error}` : '';
          addServerLog(
            `[source:${source.label}] ${source.state} (${source.source_kind}${source.frame_width && source.frame_height ? ` ${source.frame_width}x${source.frame_height}` : ''})${detail}`,
            healthStateLogType(source.state),
          );
        }
      }

      if (!previous?.audio_status) {
        addServerLog(
          `[audio] ${native.audio_status.state} (${native.audio_status.source_summary})`,
          healthStateLogType(native.audio_status.state),
        );
      } else if (
        native.audio_status.state !== previous.audio_status.state ||
        native.audio_status.last_error !== previous.audio_status.last_error ||
        native.audio_status.source_summary !== previous.audio_status.source_summary
      ) {
        const detail = native.audio_status.last_error || native.audio_status.last_event
          ? `: ${native.audio_status.last_error || native.audio_status.last_event}`
          : '';
        addServerLog(
          `[audio] ${native.audio_status.state} (${native.audio_status.source_summary})${detail}`,
          healthStateLogType(native.audio_status.state),
        );
      }

      for (const output of native.output_statuses || []) {
        const previousOutput = previous?.output_statuses?.find(
          (candidate) => outputStatusKey(candidate) === outputStatusKey(output),
        );

        if (!previousOutput) {
          addServerLog(
            `[output:${output.name}] ${output.state} (${output.protocol}/${output.muxer} ${output.target}, backoff ${output.recovery_delay_ms}ms, worker ${output.worker_id})`,
            healthStateLogType(output.state),
          );
          continue;
        }

        if (
          previousOutput.state !== output.state ||
          previousOutput.last_error !== output.last_error ||
          previousOutput.restart_count !== output.restart_count
        ) {
          const detail = output.last_error || output.last_event ? `: ${output.last_error || output.last_event}` : '';
          addServerLog(
            `[output:${output.name}] ${output.state} (restarts ${output.restart_count})${detail}`,
            healthStateLogType(output.state),
          );
        }
      }

      if (
        native.archive_status &&
        previous?.archive_status &&
        (
          native.archive_status.state !== previous.archive_status.state ||
          native.archive_status.last_error !== previous.archive_status.last_error
        )
      ) {
        const detail = native.archive_status.last_error ? `: ${native.archive_status.last_error}` : '';
        addServerLog(
          `[archive] ${native.archive_status.state}${detail}`,
          healthStateLogType(native.archive_status.state),
        );
      }

      if (!previous?.ndi_status) {
        addServerLog(
          `[ndi] ${native.ndi_status.state} (${native.ndi_status.width}x${native.ndi_status.height}@${native.ndi_status.fps}, alpha ${native.ndi_status.alpha_enabled ? 'on' : 'off'})`,
          healthStateLogType(native.ndi_status.state),
        );
      } else if (
        native.ndi_status.state !== previous.ndi_status.state ||
        native.ndi_status.last_error !== previous.ndi_status.last_error ||
        native.ndi_status.active !== previous.ndi_status.active
      ) {
        const detail = native.ndi_status.last_error ? `: ${native.ndi_status.last_error}` : '';
        addServerLog(
          `[ndi] ${native.ndi_status.state} (${native.ndi_status.frames_sent} frames, dropped ${native.ndi_status.dropped_frames})${detail}`,
          healthStateLogType(native.ndi_status.state),
        );
      }

      if (!previous?.ndi_input_status) {
        addServerLog(
          `[ndi-input] ${native.ndi_input_status.state} (${native.ndi_input_status.source_name || 'no source'})`,
          healthStateLogType(native.ndi_input_status.state),
        );
      } else if (
        native.ndi_input_status.state !== previous.ndi_input_status.state ||
        native.ndi_input_status.last_error !== previous.ndi_input_status.last_error ||
        native.ndi_input_status.frames_received !== previous.ndi_input_status.frames_received
      ) {
        const detail = native.ndi_input_status.last_error ? `: ${native.ndi_input_status.last_error}` : '';
        addServerLog(
          `[ndi-input] ${native.ndi_input_status.state} ${native.ndi_input_status.source_name || ''} (${native.ndi_input_status.width}x${native.ndi_input_status.height}, ${native.ndi_input_status.frames_received} frames)${detail}`,
          healthStateLogType(native.ndi_input_status.state),
        );
      }

      if (native.last_error && native.last_error !== previous?.last_error) {
        addServerLog(`[native] ${native.last_error}`, 'error');
      }

      if (native.bridge_last_error && native.bridge_last_error !== previous?.bridge_last_error) {
        addServerLog(`[bridge] ${native.bridge_last_error}`, 'warning');
      }

      if (native.transport_mode === 'bridge' && native.bridge_connected && !previous?.bridge_connected) {
        addServerLog('Native frame bridge is live', 'success');
      }

      if (native.transport_mode === 'bridge' && previous?.bridge_connected && !native.bridge_connected) {
        addServerLog('Native frame bridge disconnected, falling back while reconnecting', 'warning');
      }

      applyNativeStats(native);

      if (
        isStreamingRef.current &&
        native.transport_mode === 'bridge' &&
        native.bridge_url &&
        !native.bridge_connected &&
        !bridgeSocketRef.current &&
        bridgeReconnectTimerRef.current === null
      ) {
        const reconnectUrl = native.bridge_url;
        bridgeReconnectTimerRef.current = window.setTimeout(() => {
          bridgeReconnectTimerRef.current = null;
          const nextUrl = bridgeUrlRef.current || reconnectUrl;
          if (!isStreamingRef.current || transportModeRef.current !== 'bridge' || !nextUrl) {
            return;
          }
          void connectBridgeSocket(nextUrl, 'stats sync');
        }, BRIDGE_RECONNECT_MS);
      }

      if (
        isStreamingRef.current &&
        !native.desired_active &&
        !native.active &&
        !native.restarting
      ) {
        stopStatsPolling();
        if (frameLoopRef.current !== null) {
          window.clearTimeout(frameLoopRef.current);
          frameLoopRef.current = null;
        }
        frameLoopRunIdRef.current++;
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
  }, [addServerLog, applyNativeStats, connectBridgeSocket, options, stopStatsPolling]);

  const syncSceneSnapshot = useCallback(async (snapshot: NativeSceneSnapshot) => {
    if (!window.__TAURI_INTERNALS__) return;
    latestSceneSnapshotRef.current = snapshot;

    if (!invokeRef.current) {
      const { invoke } = await import('@tauri-apps/api/core');
      invokeRef.current = invoke;
    }

    if (lastSceneRevisionRef.current === snapshot.revision) {
      return;
    }

    try {
      await invokeRef.current('update_scene_snapshot', { snapshot });
      lastSceneRevisionRef.current = snapshot.revision;
    } catch (err: any) {
      addServerLog(`Native scene sync failed: ${err?.message || err}`, 'warning');
    }
  }, [addServerLog]);

  const applySourceOwnership = useCallback((sources: NativeSourceDescriptor[]) => {
    const ownedSourceIds = new Set([
      ...Array.from(activeNativeSourceIdsRef.current),
      ...Array.from(sourceStoreOwnedSourceIdsRef.current),
    ]);

    return sources.map((source) => {
      if (!ownedSourceIds.has(source.source_id)) {
        return source;
      }

      return {
        ...source,
        browser_owned: false,
        available: isStreamingRef.current ? true : source.available,
      };
    });
  }, []);

  const syncSourceInventory = useCallback(async (sources: NativeSourceDescriptor[]) => {
    if (!window.__TAURI_INTERNALS__) return;
    latestSourceInventoryRef.current = sources;

    if (!invokeRef.current) {
      const { invoke } = await import('@tauri-apps/api/core');
      invokeRef.current = invoke;
    }

    const normalizedSources = applySourceOwnership(sources);
    const inventoryHash = JSON.stringify(normalizedSources);
    if (lastSourceInventoryHashRef.current === inventoryHash) {
      return;
    }

    try {
      await invokeRef.current('update_source_inventory', { sources: normalizedSources });
      lastSourceInventoryHashRef.current = inventoryHash;
    } catch (err: any) {
      addServerLog(`Native source sync failed: ${err?.message || err}`, 'warning');
    }
  }, [addServerLog, applySourceOwnership]);

  const startStatsPolling = useCallback(() => {
    stopStatsPolling();
    void pollNativeState();
    statsPollRef.current = window.setInterval(() => {
      void pollNativeState();
    }, STATS_POLL_MS);
  }, [pollNativeState, stopStatsPolling]);

  const waitForNativeStreamReady = useCallback(async (destinationCount: number) => {
    const startedAt = Date.now();
    let lastKnownError: string | null = null;

    while ((Date.now() - startedAt) < NATIVE_READY_TIMEOUT_MS) {
      const native = await pollNativeState();
      if (native) {
        const now = Date.now();
        lastKnownError = native.last_error || native.last_exit_status || lastKnownError;
        lastKnownError = native.archive_status?.last_error || lastKnownError;
        const readyOutputs = (native.output_statuses || []).filter((output) =>
          output.state === 'active'
          && !!output.first_progress_ms
          && !!output.last_progress_ms
          && now - output.first_progress_ms >= NATIVE_OUTPUT_STABLE_MS
          && now - output.last_progress_ms <= NATIVE_PROGRESS_MAX_AGE_MS,
        );
        const archiveRequired = !!(native.archive_status?.path_pattern || native.archive_path_pattern);
        const archiveReady = !archiveRequired || (
          native.archive_status?.state === 'active'
          && !!native.archive_status.last_update_ms
          && now - native.archive_status.last_update_ms <= NATIVE_PROGRESS_MAX_AGE_MS
        );

        if (native.frames > 0 && readyOutputs.length > 0 && archiveReady && !native.restarting) {
          return `Live output confirmed (${readyOutputs.length}/${destinationCount} destination${destinationCount === 1 ? '' : 's'} active${archiveRequired ? ', archive active' : ''})`;
        }

        if (!native.desired_active && !native.active && !native.restarting) {
          throw new Error(lastKnownError || 'Native stream stopped before it became ready.');
        }
      }

      await delay(NATIVE_READY_POLL_MS);
    }

    throw new Error(lastKnownError || 'Timed out waiting for native outputs to become ready.');
  }, [pollNativeState]);

  const engineInitRef = useRef(false);
  useEffect(() => {
    if (!window.__TAURI_INTERNALS__) return;
    if (engineInitRef.current) return;
    engineInitRef.current = true;

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

      invoke('list_audio_devices').then((result: any) => {
        if (disposed) return;
        try {
          const info = JSON.parse(result as string) as NativeAudioDiscovery;
          setAudioInfo(info);
          addServerLog(
            `[audio] native engine ready: ${info.suggested_status.source_summary} (${info.devices.length} device${info.devices.length === 1 ? '' : 's'})`,
            healthStateLogType(info.suggested_status.state),
          );
        } catch {
          // Ignore JSON parse issues here.
        }
      }).catch((err) => console.log('[GPU] Audio detection failed:', err));
    });

    return () => {
      disposed = true;
      stopStatsPolling();
    };
  }, [addServerLog, stopStatsPolling]);

  const captureAndSendRawFrame = useCallback(async (
    canvas: HTMLCanvasElement,
  ) => {
    if (!invokeRef.current) return;

    const scaleCanvas = scaleCanvasRef.current;
    if (!scaleCanvas) return;
    const scaleCtx = scaleCanvas.getContext('2d', { willReadFrequently: true });
    if (!scaleCtx) return;

    scaleCtx.imageSmoothingEnabled = true;
    scaleCtx.imageSmoothingQuality = 'high';
    scaleCtx.clearRect(0, 0, widthRef.current, heightRef.current);
    scaleCtx.drawImage(canvas, 0, 0, widthRef.current, heightRef.current);
    const imageData = scaleCtx.getImageData(0, 0, widthRef.current, heightRef.current);
    const frameBytes = new Uint8Array(imageData.data.buffer);
    const bridgeSocket = bridgeSocketRef.current;
    const wantsBridge = transportModeRef.current === 'bridge';

    if (
      wantsBridge &&
      bridgeSocket &&
      bridgeSocket.readyState === WebSocket.OPEN &&
      bridgeSocket.bufferedAmount < BRIDGE_BACKPRESSURE_BYTES
    ) {
      bridgeSocket.send(frameBytes);
    } else {
      if (wantsBridge) {
        if (bridgeSocket && bridgeSocket.readyState === WebSocket.OPEN) {
          droppedRef.current++;
          return;
        }

        if (
          bridgeUrlRef.current &&
          bridgeReconnectTimerRef.current === null &&
          (!bridgeSocket || bridgeSocket.readyState === WebSocket.CLOSED || bridgeSocket.readyState === WebSocket.CLOSING)
        ) {
          const reconnectUrl = bridgeUrlRef.current;
          bridgeReconnectTimerRef.current = window.setTimeout(() => {
            bridgeReconnectTimerRef.current = null;
            const nextUrl = bridgeUrlRef.current || reconnectUrl;
            if (!isStreamingRef.current || transportModeRef.current !== 'bridge' || !nextUrl) {
              return;
            }
            void connectBridgeSocket(nextUrl, 'send path');
          }, BRIDGE_RECONNECT_MS);
        }
      }

      await invokeRef.current('encode_frame', {
        frameData: Array.from(frameBytes),
        width: widthRef.current,
        height: heightRef.current,
      });
    }
  }, [connectBridgeSocket]);

  const syncNativeSceneSources = useCallback(async (): Promise<number> => {
    if (!invokeRef.current) return 0;

    const snapshot = latestSceneSnapshotRef.current;
    const captureSources = sourceCaptureRef.current;
    if (!snapshot || !captureSources) {
      closeAllSourceBridgeSockets('source capture unavailable');
      sourceStoreOwnedSourceIdsRef.current = new Set(activeNativeSourceIdsRef.current);
      lastSyncedBrowserSourceIdsRef.current = new Set();
      return 0;
    }

    const sourceTargets = new Map<string, { width: number; height: number }>();
    for (const node of snapshot.nodes) {
      if (!node.source_id) continue;
      const current = sourceTargets.get(node.source_id);
      sourceTargets.set(node.source_id, {
        width: Math.min(
          widthRef.current,
          Math.max(current?.width || 0, Math.round(node.width) || 0),
        ),
        height: Math.min(
          heightRef.current,
          Math.max(current?.height || 0, Math.round(node.height) || 0),
        ),
      });
    }

    const currentBrowserSourceIds = new Set<string>();
    const sourceStoreOwnedIds = new Set<string>(activeNativeSourceIdsRef.current);
    let updatedSources = 0;

    for (const source of captureSources()) {
      currentBrowserSourceIds.add(source.sourceId);
      sourceStoreOwnedIds.add(source.sourceId);

      const shouldPreferNativeSource = shouldPreferNativeSourceFrame(
        source.sourceId,
        activeNativeSourceIdsRef.current,
        lastNativeStateRef.current?.source_statuses || [],
      );
      if (shouldPreferNativeSource) {
        continue;
      }

      const sourceFrameSentAt = sourceBridgeLastFrameAtRef.current.get(source.sourceId) || 0;
      if (Date.now() - sourceFrameSentAt < SOURCE_BRIDGE_FRAME_INTERVAL_MS) {
        continue;
      }

      const sourceDimensions = getCaptureElementDimensions(source.element);
      if (!sourceDimensions.width || !sourceDimensions.height) continue;

      const target = sourceTargets.get(source.sourceId);
      const captureWidth = Math.max(
        2,
        Math.min(
          widthRef.current,
          target?.width || sourceDimensions.width || widthRef.current,
        ),
      );
      const captureHeight = Math.max(
        2,
        Math.min(
          heightRef.current,
          target?.height || sourceDimensions.height || heightRef.current,
        ),
      );

      let sourceCanvas = sourceScaleCanvasesRef.current.get(source.sourceId);
      if (!sourceCanvas) {
        sourceCanvas = document.createElement('canvas');
        sourceScaleCanvasesRef.current.set(source.sourceId, sourceCanvas);
      }

      sourceCanvas.width = captureWidth;
      sourceCanvas.height = captureHeight;

      const ctx = sourceCanvas.getContext('2d', { willReadFrequently: true });
      if (!ctx) continue;
      try {
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        ctx.clearRect(0, 0, captureWidth, captureHeight);
        ctx.drawImage(source.element as CanvasImageSource, 0, 0, captureWidth, captureHeight);

        const imageData = ctx.getImageData(0, 0, captureWidth, captureHeight);
        const frameBytes = new Uint8Array(imageData.data.buffer);
        const sentViaBridge = await sendSourceFrameViaBridge(
          source.sourceId,
          captureWidth,
          captureHeight,
          frameBytes,
        );
        if (!sentViaBridge) {
          continue;
        }
        sourceBridgeLastFrameAtRef.current.set(source.sourceId, Date.now());
        sourceCaptureFailureKeysRef.current.delete(source.sourceId);
        updatedSources += 1;
      } catch (error: any) {
        const message = error?.message || String(error);
        const failureKey = `${source.sourceId}:${message}`;
        if (!sourceCaptureFailureKeysRef.current.has(failureKey)) {
          sourceCaptureFailureKeysRef.current.add(failureKey);
          addServerLog(
            `Native source capture skipped for ${source.sourceId}: ${message}`,
            'warning',
          );
        }
        continue;
      }
    }

    for (const previousSourceId of lastSyncedBrowserSourceIdsRef.current) {
      if (currentBrowserSourceIds.has(previousSourceId)) continue;
      if (activeNativeSourceIdsRef.current.has(previousSourceId)) continue;

      sourceScaleCanvasesRef.current.delete(previousSourceId);
      sourceBridgeLastFrameAtRef.current.delete(previousSourceId);
      closeSourceBridgeSocket(previousSourceId, 'source removed');
      await invokeRef.current('clear_scene_source_frame', {
        sourceId: previousSourceId,
      });
    }

    lastSyncedBrowserSourceIdsRef.current = currentBrowserSourceIds;
    sourceStoreOwnedSourceIdsRef.current = sourceStoreOwnedIds;
    return updatedSources;
  }, [addServerLog, closeAllSourceBridgeSockets, closeSourceBridgeSocket, sendSourceFrameViaBridge]);

  const captureAndSendNativeSceneFrame = useCallback(async (
    canvas: HTMLCanvasElement,
  ) => {
    if (!invokeRef.current) return;

    const snapshot = latestSceneSnapshotRef.current;
    if (!snapshot) {
      await captureAndSendRawFrame(canvas);
      return;
    }

    const updatedSources = await syncNativeSceneSources();
    const ownedSourceIdsKey = Array.from(sourceStoreOwnedSourceIdsRef.current)
      .sort()
      .join('|');
    if (
      ownedSourceIdsKey !== lastOwnedSourceIdsKeyRef.current &&
      latestSourceInventoryRef.current.length > 0
    ) {
      lastOwnedSourceIdsKeyRef.current = ownedSourceIdsKey;
      await syncSourceInventory(latestSourceInventoryRef.current);
    }

    if (!updatedSources && sourceStoreOwnedSourceIdsRef.current.size === 0) {
      await captureAndSendRawFrame(canvas);
      return;
    }

    await invokeRef.current('render_native_scene_frame');
  }, [captureAndSendRawFrame, syncNativeSceneSources, syncSourceInventory]);

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

      if (frameModeRef.current === 'native-scene') {
        await captureAndSendNativeSceneFrame(canvas);
      } else {
        await captureAndSendRawFrame(canvas);
      }

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
          window.clearTimeout(frameLoopRef.current);
          frameLoopRef.current = null;
        }
        frameLoopRunIdRef.current++;
        canvasRef.current = null;
        sourceCaptureRef.current = null;
        isStreamingRef.current = false;
        closeAllSourceBridgeSockets('stream dead');
        sourceBridgeUrlRef.current = null;
        activeNativeSourceIdsRef.current.clear();
        sourceStoreOwnedSourceIdsRef.current.clear();
        lastSyncedBrowserSourceIdsRef.current.clear();
        lastOwnedSourceIdsKeyRef.current = '';
        sourceCaptureFailureKeysRef.current.clear();
        sourceBridgeLastFrameAtRef.current.clear();
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
  }, [addServerLog, captureAndSendNativeSceneFrame, captureAndSendRawFrame, closeAllSourceBridgeSockets, options, stopStatsPolling]);

  const startStream = useCallback(async (
    surface: HTMLCanvasElement | NativeCaptureSurface,
    destinations: StreamDestination[],
    startOptions?: {
      width?: number;
      height?: number;
      fps?: number;
      bitrate?: number;
      encoder?: string;
      encodingProfile?: EncodingProfile;
      audioMode?: 'auto' | 'hybrid' | 'system' | 'microphone' | 'device' | 'silent';
      audioDevice?: string;
      includeMicrophone?: boolean;
      includeSystemAudio?: boolean;
      audioBuses?: NativeAudioBusConfig[];
      nativeVideoSources?: NativeVideoSourceConfig[];
      sourceFeeds?: () => NativeSceneCaptureSource[];
    },
  ) => {
    if (!window.__TAURI_INTERNALS__) {
      throw new Error('GPU streaming requires Tauri desktop app');
    }

    if (!invokeRef.current) {
      const { invoke } = await import('@tauri-apps/api/core');
      invokeRef.current = invoke;
    }

    const captureSurface = surface instanceof HTMLCanvasElement
      ? { canvas: surface, captureSources: undefined }
      : surface;
    const resolvedSourceFeeds = startOptions?.sourceFeeds || captureSurface.captureSources;
    const useNativeScene = typeof resolvedSourceFeeds === 'function';
    const nativeVideoSources = (startOptions?.nativeVideoSources || []).filter(
      (source) => !!source.sourceId && !!source.deviceName,
    );
    const nativeProfile = resolveNativeCaptureProfile(
      startOptions?.encodingProfile,
      encoderInfo?.isGPU ?? true,
      {
        mode: useNativeScene ? 'native-scene' : 'raw',
        destinations,
      },
    );

    fpsRef.current = nativeProfile.fps;
    widthRef.current = nativeProfile.width;
    heightRef.current = nativeProfile.height;
    frameModeRef.current = useNativeScene ? 'native-scene' : 'raw';
    canvasRef.current = captureSurface.canvas;
    sourceCaptureRef.current = resolvedSourceFeeds || null;
    activeNativeSourceIdsRef.current = new Set(nativeVideoSources.map((source) => source.sourceId));
    isStreamingRef.current = true;

    if (latestSourceInventoryRef.current.length > 0) {
      await syncSourceInventory(latestSourceInventoryRef.current);
    }

    if (!scaleCanvasRef.current) {
      scaleCanvasRef.current = document.createElement('canvas');
    }
    scaleCanvasRef.current.width = nativeProfile.width;
    scaleCanvasRef.current.height = nativeProfile.height;

    try {
      const destinationCount = destinations.filter((destination) => destination.enabled !== false).length;
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
          mode: useNativeScene ? 'native-scene' : 'raw',
          audio_mode: startOptions?.audioMode || 'auto',
          audio_device: startOptions?.audioDevice || '',
          audio_sample_rate: 48000,
          audio_channels: 2,
          audio_bitrate: 160,
          include_microphone: startOptions?.includeMicrophone ?? true,
          include_system_audio: startOptions?.includeSystemAudio ?? true,
          audio_buses: (startOptions?.audioBuses || []).map((bus) => ({
            busId: bus.busId,
            name: bus.name,
            sourceKind: bus.sourceKind,
            volume: bus.volume,
            muted: bus.muted,
            delayMs: bus.delayMs,
            monitorEnabled: bus.monitorEnabled,
          })),
          native_video_sources: nativeVideoSources.map((source) => ({
            sourceId: source.sourceId,
            deviceName: source.deviceName,
            backend: source.backend || 'dshow',
            width: source.width || nativeProfile.width,
            height: source.height || nativeProfile.height,
            fps: source.fps || nativeProfile.fps,
          })),
        },
      });

      let startResponse: NativeStartStreamResponse = {
        message: typeof result === 'string' ? result : 'Native stream started',
        transport: 'invoke',
      };

      if (typeof result === 'string') {
        try {
          startResponse = {
            ...startResponse,
            ...(JSON.parse(result) as NativeStartStreamResponse),
          };
        } catch {
          // Older desktop builds return a plain string.
        }
      }

      transportModeRef.current = startResponse.transport || 'invoke';
      bridgeUrlRef.current = startResponse.bridge_url || null;
      sourceBridgeUrlRef.current = startResponse.source_bridge_url || null;
      closeBridgeSocket('starting stream');
      closeAllSourceBridgeSockets('starting stream');

      if (transportModeRef.current === 'bridge' && bridgeUrlRef.current) {
        const bridgeConnected = await connectBridgeSocket(bridgeUrlRef.current, 'initial connect');
        if (!bridgeConnected) {
          addServerLog('Native frame bridge unavailable, using invoke fallback', 'warning');
          transportModeRef.current = 'invoke';
          bridgeUrlRef.current = null;
        }
      }

      if (useNativeScene && sourceBridgeUrlRef.current) {
        addServerLog(`Native source bridge ready: ${sourceBridgeUrlRef.current}`, 'info');
        const initialSources = resolvedSourceFeeds ? resolvedSourceFeeds() : [];
        await Promise.all(initialSources.map((source) => ensureSourceBridgeSocket(source.sourceId)));
      }

      frameCountRef.current = 0;
      droppedRef.current = 0;
      lastNativeStateRef.current = null;
      diagnosticsHistoryRef.current = [];
      frameLoopRunIdRef.current++;
      setIsStreaming(true);
      if (latestSourceInventoryRef.current.length > 0) {
        await syncSourceInventory(latestSourceInventoryRef.current);
      }
      addServerLog(
        `Native ${useNativeScene ? 'scene' : 'raw'} stream starting at ${nativeProfile.width}x${nativeProfile.height} ${nativeProfile.fps}fps`,
        'info',
      );
      startStatsPolling();

      const frameDuration = 1000 / nativeProfile.fps;
      const runId = frameLoopRunIdRef.current;
      const scheduleNextCapture = (delayMs: number) => {
        frameLoopRef.current = window.setTimeout(() => {
          frameLoopRef.current = null;
          if (!canvasRef.current || !isStreamingRef.current || frameLoopRunIdRef.current !== runId) {
            return;
          }

          const captureCanvas = canvasRef.current;
          const startedAt = performance.now();
          void captureAndSendFrame(captureCanvas).finally(() => {
            if (!canvasRef.current || !isStreamingRef.current || frameLoopRunIdRef.current !== runId) {
              return;
            }

            const elapsed = performance.now() - startedAt;
            scheduleNextCapture(Math.max(NATIVE_FRAME_LOOP_MIN_DELAY_MS, frameDuration - elapsed));
          });
        }, Math.max(0, delayMs));
      };

      scheduleNextCapture(0);
      try {
        const readyMessage = await waitForNativeStreamReady(destinationCount);
        addServerLog(readyMessage, 'success');
        options.onSuccess?.(readyMessage);
        return readyMessage;
      } catch (readyError) {
        try {
          await invokeRef.current('stop_stream');
        } catch {
          // Best effort cleanup before bubbling the readiness failure.
        }
        throw readyError;
      }
    } catch (err) {
      frameLoopRunIdRef.current++;
      if (frameLoopRef.current !== null) {
        window.clearTimeout(frameLoopRef.current);
        frameLoopRef.current = null;
      }
      closeBridgeSocket('start failed');
      closeAllSourceBridgeSockets('start failed');
      sourceBridgeUrlRef.current = null;
      canvasRef.current = null;
      sourceCaptureRef.current = null;
      activeNativeSourceIdsRef.current.clear();
      sourceStoreOwnedSourceIdsRef.current.clear();
      lastSyncedBrowserSourceIdsRef.current.clear();
      lastOwnedSourceIdsKeyRef.current = '';
      sourceCaptureFailureKeysRef.current.clear();
      sourceBridgeLastFrameAtRef.current.clear();
      frameModeRef.current = 'raw';
      isStreamingRef.current = false;
      diagnosticsHistoryRef.current = [];
      setIsStreaming(false);
      throw err;
    }
  }, [
    addServerLog,
    captureAndSendFrame,
    closeBridgeSocket,
    closeAllSourceBridgeSockets,
    connectBridgeSocket,
    encoderInfo,
    options,
    startStatsPolling,
    syncSourceInventory,
    waitForNativeStreamReady,
  ]);

  const stopStream = useCallback(async () => {
    if (frameLoopRef.current !== null) {
      window.clearTimeout(frameLoopRef.current);
      frameLoopRef.current = null;
    }
    frameLoopRunIdRef.current++;
    canvasRef.current = null;
    isStreamingRef.current = false;
    stopStatsPolling();
    closeBridgeSocket('stop streaming');
    closeAllSourceBridgeSockets('stop streaming');
    transportModeRef.current = 'invoke';
    bridgeUrlRef.current = null;
    sourceBridgeUrlRef.current = null;
    lastNativeStateRef.current = null;
    lastSceneRevisionRef.current = 0;
    lastSourceInventoryHashRef.current = '';
    sourceCaptureRef.current = null;
    activeNativeSourceIdsRef.current.clear();
    sourceStoreOwnedSourceIdsRef.current.clear();
    lastSyncedBrowserSourceIdsRef.current.clear();
    lastOwnedSourceIdsKeyRef.current = '';
    sourceCaptureFailureKeysRef.current.clear();
    sourceBridgeLastFrameAtRef.current.clear();
    frameModeRef.current = 'raw';
    sourceScaleCanvasesRef.current.clear();
    diagnosticsHistoryRef.current = [];

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
    if (latestSourceInventoryRef.current.length > 0) {
      await syncSourceInventory(latestSourceInventoryRef.current);
    }
    setStats((prev) => ({
      ...prev,
      isActive: false,
      restarting: false,
      frameTransport: 'unknown',
      sourceBridgeConnectedSources: 0,
      videoStatus: null,
      sourceStatuses: [],
      audioStatus: null,
      outputStatuses: [],
      archiveStatus: null,
      ndiStatus: prev.ndiStatus,
      ndiInputStatus: prev.ndiInputStatus,
    }));
  }, [addServerLog, closeAllSourceBridgeSockets, closeBridgeSocket, stopStatsPolling, syncSourceInventory]);

  const startNdi = useCallback(async (config?: {
    resolution?: '720p' | '1080p';
    fps?: number;
    alphaEnabled?: boolean;
  }) => {
    if (!window.__TAURI_INTERNALS__) {
      throw new Error('NDI output is available only in the desktop app.');
    }

    if (!invokeRef.current) {
      const { invoke } = await import('@tauri-apps/api/core');
      invokeRef.current = invoke;
    }

    const result = JSON.parse(
      await invokeRef.current('start_ndi', {
        config: {
          resolution: config?.resolution || '1080p',
          fps: config?.fps || 30,
          alphaEnabled: config?.alphaEnabled !== false,
        },
      }) as string,
    ) as NativeNdiStatus;

    setStats((prev) => ({ ...prev, ndiStatus: result }));
    addServerLog(
      `[ndi] starting ${result.width}x${result.height}@${result.fps} (${result.sources.map((source) => source.name).join(', ')})`,
      'info',
    );
    startStatsPolling();
    return result;
  }, [addServerLog, startStatsPolling]);

  const stopNdi = useCallback(async () => {
    if (!window.__TAURI_INTERNALS__) {
      return null;
    }

    if (!invokeRef.current) {
      const { invoke } = await import('@tauri-apps/api/core');
      invokeRef.current = invoke;
    }

    const result = JSON.parse(await invokeRef.current('stop_ndi') as string) as NativeNdiStatus;
    setStats((prev) => ({ ...prev, ndiStatus: result }));
    addServerLog('[ndi] stopped', 'info');
    if (!isStreamingRef.current) {
      stopStatsPolling();
    }
    return result;
  }, [addServerLog, stopStatsPolling]);

  const refreshNdiStatus = useCallback(async () => {
    if (!window.__TAURI_INTERNALS__) {
      return null;
    }

    if (!invokeRef.current) {
      const { invoke } = await import('@tauri-apps/api/core');
      invokeRef.current = invoke;
    }

    const result = JSON.parse(await invokeRef.current('get_ndi_status') as string) as NativeNdiStatus;
    setStats((prev) => ({ ...prev, ndiStatus: result }));
    return result;
  }, []);

  const pushNdiProgramFrame = useCallback(async (canvas: HTMLCanvasElement) => {
    if (!window.__TAURI_INTERNALS__) return;

    if (!invokeRef.current) {
      const { invoke } = await import('@tauri-apps/api/core');
      invokeRef.current = invoke;
    }

    const ndi = statsRef.current.ndiStatus;
    if (!ndi?.desired_active) return;

    const width = ndi.width || 1280;
    const height = ndi.height || 720;
    if (!scaleCanvasRef.current) {
      scaleCanvasRef.current = document.createElement('canvas');
    }
    const scaleCanvas = scaleCanvasRef.current;
    scaleCanvas.width = width;
    scaleCanvas.height = height;
    const scaleCtx = scaleCanvas.getContext('2d', { willReadFrequently: true });
    if (!scaleCtx) return;

    scaleCtx.imageSmoothingEnabled = true;
    scaleCtx.imageSmoothingQuality = 'high';
    scaleCtx.clearRect(0, 0, width, height);
    scaleCtx.drawImage(canvas, 0, 0, width, height);
    const imageData = scaleCtx.getImageData(0, 0, width, height);
    await invokeRef.current('push_ndi_program_frame', {
      width,
      height,
      frameData: Array.from(new Uint8Array(imageData.data.buffer)),
    });
  }, []);

  const listNdiSources = useCallback(async () => {
    if (!window.__TAURI_INTERNALS__) {
      return [] as NativeNdiDiscoveredSource[];
    }

    if (!invokeRef.current) {
      const { invoke } = await import('@tauri-apps/api/core');
      invokeRef.current = invoke;
    }

    return JSON.parse(await invokeRef.current('list_ndi_sources') as string) as NativeNdiDiscoveredSource[];
  }, []);

  const startNdiInput = useCallback(async (sourceName: string, routedSourceId = 'camera:local-2') => {
    if (!window.__TAURI_INTERNALS__) {
      throw new Error('NDI input is available only in the desktop app.');
    }

    if (!invokeRef.current) {
      const { invoke } = await import('@tauri-apps/api/core');
      invokeRef.current = invoke;
    }

    const result = JSON.parse(
      await invokeRef.current('start_ndi_input', {
        config: { sourceName, routedSourceId },
      }) as string,
    ) as NativeNdiInputStatus;
    setStats((prev) => ({ ...prev, ndiInputStatus: result }));
    addServerLog(`[ndi-input] routing ${sourceName} into Cam 2`, 'info');
    startStatsPolling();
    return result;
  }, [addServerLog, startStatsPolling]);

  const stopNdiInput = useCallback(async () => {
    if (!window.__TAURI_INTERNALS__) {
      return null;
    }

    if (!invokeRef.current) {
      const { invoke } = await import('@tauri-apps/api/core');
      invokeRef.current = invoke;
    }

    const result = JSON.parse(await invokeRef.current('stop_ndi_input') as string) as NativeNdiInputStatus;
    setStats((prev) => ({ ...prev, ndiInputStatus: result }));
    addServerLog('[ndi-input] stopped', 'info');
    if (!isStreamingRef.current && !stats.ndiStatus?.desired_active) {
      stopStatsPolling();
    }
    return result;
  }, [addServerLog, stats.ndiStatus?.desired_active, stopStatsPolling]);

  useEffect(() => {
    return () => {
      stopStatsPolling();
      closeBridgeSocket('unmount');
      closeAllSourceBridgeSockets('unmount');
      activeNativeSourceIdsRef.current.clear();
      sourceStoreOwnedSourceIdsRef.current.clear();
      lastSyncedBrowserSourceIdsRef.current.clear();
      lastOwnedSourceIdsKeyRef.current = '';
      sourceCaptureFailureKeysRef.current.clear();
      sourceBridgeLastFrameAtRef.current.clear();
      sourceScaleCanvasesRef.current.clear();
      diagnosticsHistoryRef.current = [];
      if (frameLoopRef.current !== null) {
        window.clearTimeout(frameLoopRef.current);
        frameLoopRef.current = null;
      }
      frameLoopRunIdRef.current++;
    };
  }, [closeAllSourceBridgeSockets, closeBridgeSocket, stopStatsPolling]);

  const isAvailable = !!window.__TAURI_INTERNALS__;

  const buildDiagnosticsPayload = useCallback(() => {
    const latest = lastNativeStateRef.current;
    return {
      artifactVersion: 2,
      exportedAt: new Date().toISOString(),
      soakGate: {
        maxRestartCount: 3,
        maxFrameAgeMs: 5000,
        maxDegradedRatio: 0.1,
        outputsMustAvoidError: true,
        archiveMustAvoidError: true,
      },
      session: latest ? {
        sessionId: latest.session_id,
        startedAtMs: latest.started_at_ms,
        uptimeMs: latest.uptime_ms,
        encoder: latest.encoder,
        isGPU: latest.is_gpu,
        width: latest.width,
        height: latest.height,
        fps: latest.fps,
        bitrateKbps: latest.bitrate_kbps,
        transportMode: latest.transport_mode,
        frameTransport: latest.frame_transport,
        outputCount: latest.output_statuses?.length || 0,
        sourceCount: latest.source_statuses?.length || 0,
        archivePathPattern: latest.archive_path_pattern || latest.archive_status?.path_pattern || null,
      } : null,
      encoderInfo,
      audioInfo,
      latest,
      history: diagnosticsHistoryRef.current,
    };
  }, [audioInfo, encoderInfo]);

  const downloadDiagnosticsPayload = useCallback((payload: unknown) => {
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `aether-native-diagnostics-${Date.now()}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  }, []);

  const exportDiagnostics = useCallback(() => {
    const payload = buildDiagnosticsPayload();
    downloadDiagnosticsPayload(payload);
    return payload;
  }, [buildDiagnosticsPayload, downloadDiagnosticsPayload]);

  const exportAndCheckDiagnostics = useCallback(async () => {
    if (!window.__TAURI_INTERNALS__) {
      throw new Error('Diagnostics artifact export is available only in the desktop app.');
    }

    if (!invokeRef.current) {
      const { invoke } = await import('@tauri-apps/api/core');
      invokeRef.current = invoke;
    }

    const payload = buildDiagnosticsPayload();
    const result = JSON.parse(
      await invokeRef.current('export_native_diagnostics_artifact', {
        payloadJson: JSON.stringify(payload),
      }) as string,
    ) as NativeDiagnosticsArtifactResult;

    addServerLog(`[diagnostics] saved soak artifact: ${result.file_path}`, 'info');
    addServerLog(
      `[diagnostics] ${result.check_passed ? 'check passed' : 'check failed'}: ${result.check_command}`,
      result.check_passed ? 'success' : 'warning',
    );

    return {
      payload,
      ...result,
    };
  }, [addServerLog, buildDiagnosticsPayload]);

  return {
    isAvailable,
    isStreaming,
    stats,
    encoderInfo,
    audioInfo,
    syncSceneSnapshot,
    syncSourceInventory,
    startStream,
    stopStream,
    startNdi,
    stopNdi,
    refreshNdiStatus,
    pushNdiProgramFrame,
    listNdiSources,
    startNdiInput,
    stopNdiInput,
    exportDiagnostics,
    exportAndCheckDiagnostics,
    // Transitional aliases while the app migrates off the old hook name.
    startGPUStream: startStream,
    stopGPUStream: stopStream,
  };
}
