import { useState, useRef, MutableRefObject, useEffect, useCallback } from 'react';
import { Socket } from 'socket.io-client';
import { StreamDestination, Recording, ServerLog, EncodingProfile, Telemetry } from '../types';
import { audioEngine } from '../lib/audioEngine';
import { normalizeStreamDestinations } from '../lib/streamDestinations';

interface UseStreamingOptions {
  socketRef: MutableRefObject<Socket | null>;
  isStreaming: boolean;
  setIsStreaming: (v: boolean) => void;
  setServerLogs: React.Dispatch<React.SetStateAction<ServerLog[]>>;
  setTelemetry: React.Dispatch<React.SetStateAction<Telemetry>>;
  onError?: (message: string) => void;
  onSuccess?: (message: string) => void;
}

export type DestinationStatus = {
  id: string;
  name: string;
  status: 'connected' | 'disconnected' | 'error' | 'reconnecting';
  message?: string;
};

type StreamStartedPayload = {
  message?: string;
  timestamp?: number;
};

type BrowserTransportMode = 'mediarecorder-h264' | 'mediarecorder-webm';

type ActiveStreamPayload = {
  destinations: StreamDestination[];
  encodingProfile: EncodingProfile;
  browserH264: boolean;
  mimeType: string;
  transportMode: BrowserTransportMode;
  videoBitsPerSecond: number;
  captureFps: number;
};

type BrowserStreamProfile = {
  captureFps: number;
  videoBitsPerSecond: number;
};

const BROWSER_STREAM_PROFILES: Record<EncodingProfile, BrowserStreamProfile> = {
  '1080p60': { captureFps: 30, videoBitsPerSecond: 8_000_000 },
  '1080p30': { captureFps: 30, videoBitsPerSecond: 6_000_000 },
  '720p30': { captureFps: 30, videoBitsPerSecond: 4_000_000 },
  '480p30': { captureFps: 30, videoBitsPerSecond: 2_000_000 },
};

const RECORDER_TIMESLICE_MS = 33; // ~1 frame at 30fps; prevents 30-frame bursts that cause non-monotonic DTS on Twitch
const HEALTH_CHECK_INTERVAL_MS = 2000;
const REQUEST_DATA_AFTER_MS = 2500;
const RESTART_AFTER_MS = 6000;
const TRANSPORT_RESTART_DELAY_MS = 750;
const STREAM_READY_TIMEOUT_MS = 15000;

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export function useStreaming({
  socketRef,
  isStreaming,
  setIsStreaming,
  setServerLogs,
  setTelemetry,
  onError,
  onSuccess,
}: UseStreamingOptions) {
  const [isRecording, setIsRecording] = useState(false);
  const [destinations, setDestinations] = useState<StreamDestination[]>(() => {
    const saved = localStorage.getItem('aether_destinations');
    const parsed: StreamDestination[] = saved ? JSON.parse(saved) : [
      { id: '1', name: 'YouTube', rtmpUrl: 'rtmps://a.rtmp.youtube.com:443/live2', streamKey: '', enabled: true },
    ];
    // Migrate any saved destinations that were incorrectly set to /live → /app (correct Twitch RTMP app name).
    return normalizeStreamDestinations(parsed);
  });
  const [recordings, setRecordings] = useState<Recording[]>(() => {
    const saved = localStorage.getItem('aether_recordings');
    return saved ? JSON.parse(saved) : [
      { id: 'rec-1', timestamp: '2026-03-14 10:30', duration: '00:45:12', size: '1.2 GB', thumbnail: 'https://picsum.photos/seed/rec1/320/180', fileName: 'Podcast_Ep12_Final.mp4' },
      { id: 'rec-2', timestamp: '2026-03-13 14:15', duration: '00:12:05', size: '450 MB', thumbnail: 'https://picsum.photos/seed/rec2/320/180', fileName: 'Interview_Snippet.mp4' },
    ];
  });
  const [droppedFrames, setDroppedFrames] = useState(0);
  const [encodingProfile, setEncodingProfile] = useState<EncodingProfile>('1080p30');
  const [destinationStatuses, setDestinationStatuses] = useState<DestinationStatus[]>([]);

  const streamRecorderRef = useRef<MediaRecorder | null>(null);
  const recordingRecorderRef = useRef<MediaRecorder | null>(null);
  const recordedChunksRef = useRef<Blob[]>([]);
  const captureStreamRef = useRef<MediaStream | null>(null);
  const captureCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const activePayloadRef = useRef<ActiveStreamPayload | null>(null);
  const streamWantedRef = useRef(false);
  const expectedRecorderStopRef = useRef(false);
  const restartInFlightRef = useRef(false);
  const lastChunkAtRef = useRef(0);
  const lastRequestDataAtRef = useRef(0);
  const healthTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const droppedFramesRef = useRef(0);

  useEffect(() => {
    localStorage.setItem('aether_destinations', JSON.stringify(destinations));
  }, [destinations]);

  useEffect(() => {
    localStorage.setItem('aether_recordings', JSON.stringify(recordings));
  }, [recordings]);

  const addServerLog = useCallback((message: string, type: ServerLog['type']) => {
    setServerLogs((prev) => [
      { message, type, id: Date.now() + Math.random() } as ServerLog,
      ...prev,
    ]);
  }, [setServerLogs]);

  const waitForStreamReady = useCallback((socket: Socket) => {
    return new Promise<string>((resolve, reject) => {
      let settled = false;

      const cleanup = () => {
        window.clearTimeout(timeoutId);
        socket.off('stream-started', handleStarted);
        socket.off('stream-failed', handleFailed);
        socket.off('disconnect', handleDisconnect);
      };

      const finish = (fn: () => void) => {
        if (settled) return;
        settled = true;
        cleanup();
        fn();
      };

      const handleStarted = (payload?: StreamStartedPayload) => {
        finish(() => resolve(payload?.message || 'Streaming started successfully.'));
      };

      const handleFailed = (payload?: { message?: string }) => {
        finish(() => reject(new Error(payload?.message || 'FFmpeg failed before the stream became ready.')));
      };

      const handleDisconnect = () => {
        finish(() => reject(new Error('Socket disconnected before the stream became ready.')));
      };

      const timeoutId = window.setTimeout(() => {
        finish(() => reject(new Error('Timed out waiting for the stream to become ready.')));
      }, STREAM_READY_TIMEOUT_MS);

      socket.on('stream-started', handleStarted);
      socket.on('stream-failed', handleFailed);
      socket.on('disconnect', handleDisconnect);
    });
  }, []);

  const clearHealthTimer = useCallback(() => {
    if (healthTimerRef.current) {
      clearInterval(healthTimerRef.current);
      healthTimerRef.current = null;
    }
  }, []);

  const releaseCaptureStream = useCallback((stopTracks: boolean) => {
    if (stopTracks) {
      captureStreamRef.current?.getTracks().forEach((track) => track.stop());
    }
    captureStreamRef.current = null;
    captureCanvasRef.current = null;
  }, []);

  const stopActiveRecorder = useCallback(async () => {
    const recorder = streamRecorderRef.current;
    if (!recorder) return;

    streamRecorderRef.current = null;

    if (recorder.state === 'inactive') {
      return;
    }

    expectedRecorderStopRef.current = true;
    await new Promise<void>((resolve) => {
      const handleStop = () => resolve();
      recorder.addEventListener('stop', handleStop, { once: true });
      try {
        recorder.stop();
      } catch {
        resolve();
      }
    });
  }, []);

  const buildPayload = useCallback((activeDestinations: StreamDestination[]): ActiveStreamPayload => {
    const profile = BROWSER_STREAM_PROFILES[encodingProfile];
    let mimeType = 'video/mp4;codecs=avc1';
    let browserH264 = false;
    let transportMode: BrowserTransportMode = 'mediarecorder-webm';

    if (MediaRecorder.isTypeSupported('video/mp4;codecs=avc1')) {
      mimeType = 'video/mp4;codecs=avc1';
      browserH264 = true;
      transportMode = 'mediarecorder-h264';
    } else if (MediaRecorder.isTypeSupported('video/webm;codecs=h264')) {
      mimeType = 'video/webm;codecs=h264';
      browserH264 = false;
      transportMode = 'mediarecorder-webm';
    } else if (MediaRecorder.isTypeSupported('video/webm;codecs=vp8')) {
      mimeType = 'video/webm;codecs=vp8';
    } else {
      mimeType = 'video/webm';
    }

    return {
      destinations: activeDestinations,
      encodingProfile,
      browserH264,
      mimeType,
      transportMode,
      videoBitsPerSecond: profile.videoBitsPerSecond,
      captureFps: profile.captureFps,
    };
  }, [encodingProfile]);

  const ensureCaptureStream = useCallback((payload: ActiveStreamPayload): MediaStream => {
    const existingTrack = captureStreamRef.current?.getVideoTracks()[0];
    if (captureStreamRef.current && existingTrack && existingTrack.readyState === 'live') {
      return captureStreamRef.current;
    }

    const canvas = document.querySelector('canvas');
    if (!canvas || !(canvas instanceof HTMLCanvasElement)) {
      throw new Error('No canvas found. Make sure the compositor is visible.');
    }

    captureCanvasRef.current = canvas;
    captureStreamRef.current = canvas.captureStream(payload.captureFps);
    return captureStreamRef.current;
  }, []);

  const emitStartStream = useCallback((payload: ActiveStreamPayload) => {
    socketRef.current?.emit('start-stream', {
      destinations: payload.destinations,
      encodingProfile: payload.encodingProfile,
      browserH264: payload.browserH264,
      mimeType: payload.mimeType,
      transportMode: payload.transportMode,
    });
  }, [socketRef]);

  const restartBrowserTransportRef = useRef<(reason: string) => Promise<void>>(async () => {});

  const startHealthTimer = useCallback(() => {
    clearHealthTimer();
    healthTimerRef.current = setInterval(() => {
      if (!streamWantedRef.current) return;

      const recorder = streamRecorderRef.current;
      if (!recorder || recorder.state !== 'recording') return;

      const now = Date.now();
      const idleFor = now - lastChunkAtRef.current;

      if (idleFor >= REQUEST_DATA_AFTER_MS && idleFor < RESTART_AFTER_MS && now - lastRequestDataAtRef.current >= REQUEST_DATA_AFTER_MS) {
        lastRequestDataAtRef.current = now;
        try {
          recorder.requestData();
        } catch {
          // requestData is best effort only.
        }
      }

      if (idleFor >= RESTART_AFTER_MS) {
        addServerLog(`Recorder stalled for ${Math.round(idleFor / 1000)}s — rebuilding browser transport`, 'warning');
        void restartBrowserTransportRef.current('chunk-stall');
      }
    }, HEALTH_CHECK_INTERVAL_MS);
  }, [addServerLog, clearHealthTimer]);

  const createAndStartRecorder = useCallback((capturedStream: MediaStream, payload: ActiveStreamPayload) => {
    const recorder = new MediaRecorder(capturedStream, {
      mimeType: payload.mimeType,
      videoBitsPerSecond: payload.videoBitsPerSecond,
    });

    recorder.ondataavailable = (event) => {
      if (event.data.size <= 0) return;

      lastChunkAtRef.current = Date.now();

      if (!socketRef.current?.connected) {
        return;
      }

      const mbps = (event.data.size * 8) / 1_000_000;
      setTelemetry((prev: any) => ({
        ...prev,
        bitrate: `${mbps.toFixed(1)} Mbps`,
      }));
      socketRef.current.emit('stream-chunk', { chunk: event.data });
    };

    recorder.onerror = (event) => {
      console.error('MediaRecorder Error:', event);
      addServerLog('Recorder error — rebuilding browser transport', 'error');
      if (streamWantedRef.current) {
        void restartBrowserTransportRef.current('recorder-error');
      }
    };

    recorder.onstop = () => {
      if (expectedRecorderStopRef.current) {
        expectedRecorderStopRef.current = false;
        return;
      }

      if (!streamWantedRef.current) return;
      addServerLog('Recorder stopped unexpectedly — rebuilding browser transport', 'warning');
      void restartBrowserTransportRef.current('recorder-stop');
    };

    streamRecorderRef.current = recorder;
    lastChunkAtRef.current = Date.now();
    lastRequestDataAtRef.current = 0;
    recorder.start(RECORDER_TIMESLICE_MS);
    startHealthTimer();
  }, [addServerLog, setTelemetry, socketRef, startHealthTimer]);

  const stopStreamingRuntime = useCallback(async (emitStopToServer: boolean, stopTracks: boolean) => {
    streamWantedRef.current = false;
    restartInFlightRef.current = false;
    clearHealthTimer();
    await stopActiveRecorder();
    if (emitStopToServer) {
      socketRef.current?.emit('stop-stream');
    }
    activePayloadRef.current = null;
    releaseCaptureStream(stopTracks);
    setIsStreaming(false);
  }, [clearHealthTimer, releaseCaptureStream, setIsStreaming, socketRef, stopActiveRecorder]);

  const restartBrowserTransport = useCallback(async (reason: string) => {
    if (restartInFlightRef.current || !streamWantedRef.current) return;

    const payload = activePayloadRef.current;
    if (!payload) return;

    const socket = socketRef.current;
    if (!socket?.connected) {
      addServerLog(`Transport restart deferred — socket offline (${reason})`, 'warning');
      return;
    }

    restartInFlightRef.current = true;
    try {
      addServerLog(`Rebuilding browser compatibility transport (${reason})`, 'info');
      await stopActiveRecorder();
      emitStartStream(payload);
      await delay(TRANSPORT_RESTART_DELAY_MS);
      if (!streamWantedRef.current) return;
      const capturedStream = ensureCaptureStream(payload);
      createAndStartRecorder(capturedStream, payload);
      addServerLog(`Browser compatibility transport recovered (${reason})`, 'success');
    } catch (err: any) {
      const message = err?.message || `Failed to rebuild browser transport (${reason})`;
      addServerLog(message, 'error');
      await stopStreamingRuntime(false, true);
      onError?.(message);
    } finally {
      restartInFlightRef.current = false;
    }
  }, [addServerLog, createAndStartRecorder, emitStartStream, ensureCaptureStream, onError, socketRef, stopActiveRecorder, stopStreamingRuntime]);

  restartBrowserTransportRef.current = restartBrowserTransport;

  useEffect(() => {
    const socket = socketRef.current;
    if (!socket) return;

    const handleConnect = () => {
      if (streamWantedRef.current && activePayloadRef.current) {
        addServerLog('Socket reconnected — restarting browser compatibility transport', 'info');
        void restartBrowserTransport('socket-reconnect');
      }
    };

    const handleDisconnect = () => {
      if (streamWantedRef.current) {
        addServerLog('Socket disconnected — waiting to rebuild browser compatibility transport', 'warning');
      }
    };

    const handleStreamRecovered = () => {
      addServerLog('Server FFmpeg recovered successfully', 'success');
    };

    const handleStreamRefreshRequest = (data: any) => {
      const reason = data?.reason || 'server-refresh-request';
      addServerLog(`Server requested stream refresh (${reason})`, 'warning');
      void restartBrowserTransport(reason);
    };

    const handleStreamStats = (stats: { fps?: number; bitrate?: string; speed?: string }) => {
      setTelemetry((prev: any) => ({
        ...prev,
        ...(stats.fps != null ? { fps: stats.fps } : {}),
        ...(stats.bitrate != null ? { bitrate: stats.bitrate } : {}),
        ...(stats.speed != null ? { speed: stats.speed } : {}),
      }));
    };

    const handleDestinationStatus = (status: DestinationStatus | DestinationStatus[]) => {
      const statuses = Array.isArray(status) ? status : [status];
      setDestinationStatuses((prev) => {
        const next = [...prev];
        for (const item of statuses) {
          const idx = next.findIndex((dest) => dest.id === item.id);
          if (idx >= 0) next[idx] = item;
          else next.push(item);
        }
        return next;
      });
    };

    const handleStreamFailed = (data: any) => {
      const message = data?.message || 'FFmpeg restart limit reached';
      addServerLog(`STREAM DIED: ${message}`, 'error');
      void stopStreamingRuntime(false, true);
      onError?.(`Stream failed: ${message}. Please restart manually.`);
    };

    const handleSessionSummary = (summary: any) => {
      addServerLog(
        `Session ended — Duration: ${Math.round((summary?.duration || 0) / 1000)}s, Frames: ${summary?.totalFramesSent || 0}, Drops: ${summary?.droppedFrames || 0}`,
        'info',
      );
    };

    socket.on('connect', handleConnect);
    socket.on('disconnect', handleDisconnect);
    socket.on('stream-recovered', handleStreamRecovered);
    socket.on('stream-refresh-request', handleStreamRefreshRequest);
    socket.on('stream-stats', handleStreamStats);
    socket.on('destination-status', handleDestinationStatus);
    socket.on('stream-failed', handleStreamFailed);
    socket.on('session-summary', handleSessionSummary);

    return () => {
      socket.off('connect', handleConnect);
      socket.off('disconnect', handleDisconnect);
      socket.off('stream-recovered', handleStreamRecovered);
      socket.off('stream-refresh-request', handleStreamRefreshRequest);
      socket.off('stream-stats', handleStreamStats);
      socket.off('destination-status', handleDestinationStatus);
      socket.off('stream-failed', handleStreamFailed);
      socket.off('session-summary', handleSessionSummary);
    };
  }, [addServerLog, onError, restartBrowserTransport, setTelemetry, socketRef, stopStreamingRuntime]);

  const startStreaming = async (showSettings: () => void) => {
    const activeDestinations = normalizeStreamDestinations(
      destinations.filter((dest) => dest.enabled),
    );
    if (activeDestinations.length === 0) {
      onError?.('No streaming destinations enabled. Configure at least one destination.');
      showSettings();
      return;
    }
    if (!activeDestinations.every((dest) => dest.streamKey)) {
      onError?.('Missing stream key for one or more destinations.');
      showSettings();
      return;
    }

    try {
      const socket = socketRef.current;
      if (!socket?.connected) {
        onError?.('Not connected to server. Check your connection and try again.');
        return;
      }

      const payload = buildPayload(activeDestinations);
      const capturedStream = ensureCaptureStream(payload);
      const readyPromise = waitForStreamReady(socket);

      if (encodingProfile === '1080p60') {
        addServerLog('Browser compatibility mode is capped at 30fps for stability. Use the desktop GPU path for true 60fps output.', 'warning');
      }

      activePayloadRef.current = payload;
      streamWantedRef.current = true;
      droppedFramesRef.current = 0;
      setDroppedFrames(0);

      addServerLog(`Browser compatibility transport: ${payload.transportMode} (${payload.mimeType})`, 'info');
      emitStartStream(payload);
      await delay(TRANSPORT_RESTART_DELAY_MS);
      createAndStartRecorder(capturedStream, payload);
      const readyMessage = await readyPromise;
      setIsStreaming(true);
      onSuccess?.(readyMessage);
    } catch (err: any) {
      console.error('Failed to start stream:', err);
      await stopStreamingRuntime(true, true);
      onError?.(`Failed to start stream: ${err?.message || 'Unknown error'}`);
      addServerLog(`Stream Error: ${err?.message || err}`, 'error');
    }
  };

  const stopStreaming = async () => {
    try {
      await stopStreamingRuntime(true, true);
    } catch (err: any) {
      console.error('Failed to stop stream:', err);
      onError?.(`Failed to stop stream: ${err?.message || 'Unknown error'}`);
    }
  };

  const startRecording = () => {
    const canvas = document.querySelector('canvas');
    if (!canvas) return;

    const stream = canvas.captureStream(60);
    const mixedAudio = audioEngine.getMixedStream();
    if (mixedAudio) mixedAudio.getAudioTracks().forEach((track) => stream.addTrack(track));

    const recorder = new MediaRecorder(stream, { mimeType: 'video/webm;codecs=vp9' });
    recordedChunksRef.current = [];

    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) recordedChunksRef.current.push(event.data);
    };

    recorder.onstop = () => {
      const blob = new Blob(recordedChunksRef.current, { type: 'video/webm' });
      const url = URL.createObjectURL(blob);
      recordingRecorderRef.current = null;
      const newRecording: Recording = {
        id: `rec-${Date.now()}`,
        fileName: `Broadcast_${new Date().toISOString().replace(/[:.]/g, '-')}.webm`,
        timestamp: new Date().toLocaleString(),
        duration: '00:00:10',
        size: `${(blob.size / (1024 * 1024)).toFixed(1)} MB`,
        thumbnail: url,
        url,
      };
      setRecordings((prev) => [newRecording, ...prev]);
    };

    recorder.start();
    recordingRecorderRef.current = recorder;
    setIsRecording(true);
  };

  const stopRecording = () => {
    if (recordingRecorderRef.current) {
      recordingRecorderRef.current.stop();
      recordingRecorderRef.current = null;
      setIsRecording(false);
    }
  };

  return {
    isRecording,
    destinations, setDestinations,
    recordings, setRecordings,
    startStreaming,
    stopStreaming,
    startRecording,
    stopRecording,
    droppedFrames,
    encodingProfile, setEncodingProfile,
    destinationStatuses,
  };
}
