import { useState, useRef, MutableRefObject, useEffect } from 'react';
import { StreamDestination, Recording, ServerLog, EncodingProfile } from '../types';
import { audioEngine } from '../lib/audioEngine';

interface UseStreamingOptions {
  socketRef: MutableRefObject<any>;
  isStreaming: boolean;
  setIsStreaming: (v: boolean) => void;
  setServerLogs: React.Dispatch<React.SetStateAction<ServerLog[]>>;
  setTelemetry: React.Dispatch<React.SetStateAction<any>>;
  onError?: (message: string) => void;
  onSuccess?: (message: string) => void;
}

export type DestinationStatus = {
  id: string;
  name: string;
  status: 'connected' | 'disconnected' | 'error' | 'reconnecting';
  message?: string;
};

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
    return saved ? JSON.parse(saved) : [
      { id: '1', name: 'YouTube', rtmpUrl: 'rtmps://a.rtmp.youtube.com:443/live2', streamKey: '', enabled: true },
    ];
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

  const droppedFramesRef = useRef(0);
  const lastDestinationsRef = useRef<StreamDestination[]>([]);

  useEffect(() => {
    localStorage.setItem('aether_destinations', JSON.stringify(destinations));
  }, [destinations]);

  useEffect(() => {
    // Note: thumbnail Blob URLs in recordings will be invalid on refresh,
    // but the metadata persists.
    localStorage.setItem('aether_recordings', JSON.stringify(recordings));
  }, [recordings]);

  // --- Stream Recovery on Socket Reconnect ---
  useEffect(() => {
    const socket = socketRef.current;
    if (!socket) return;

    const handleConnect = () => {
      if (isStreaming && lastDestinationsRef.current.length > 0) {
        setServerLogs(prev => [
          { message: 'Client: Re-emitting start-stream after reconnection...', type: 'info', id: Date.now() } as ServerLog,
          ...prev,
        ]);
        socket.emit('start-stream', {
          destinations: lastDestinationsRef.current,
          encodingProfile,
        });
        setServerLogs(prev => [
          { message: 'Stream recovered after reconnection', type: 'success', id: Date.now() } as ServerLog,
          ...prev,
        ]);
      }
    };

    const handleStreamRecovered = (data: any) => {
      setServerLogs(prev => [
        { message: `Server: Stream recovered — ${data?.message || 'FFmpeg restarted'}`, type: 'success', id: Date.now() } as ServerLog,
        ...prev,
      ]);
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
      setDestinationStatuses(prev => {
        const next = [...prev];
        for (const s of statuses) {
          const idx = next.findIndex(d => d.id === s.id);
          if (idx >= 0) {
            next[idx] = s;
          } else {
            next.push(s);
          }
        }
        return next;
      });
    };

    // Detect when FFmpeg watchdog exhausts retries — stream is truly dead
    const handleStreamFailed = (data: any) => {
      setIsStreaming(false);
      if (mediaRecorderRef.current) {
        try { mediaRecorderRef.current.stop(); } catch { /* already stopped */ }
        mediaRecorderRef.current = null;
      }
      lastDestinationsRef.current = [];
      onError?.(`Stream failed: ${data?.message || 'FFmpeg restart limit reached'}. Please restart manually.`);
      setServerLogs(prev => [
        { message: `STREAM DIED: ${data?.message || 'All restart attempts exhausted'}`, type: 'error', id: Date.now() } as ServerLog,
        ...prev,
      ]);
    };

    // Detect session end from server
    const handleSessionSummary = (summary: any) => {
      setServerLogs(prev => [
        { message: `Session ended — Duration: ${Math.round((summary?.duration || 0) / 1000)}s, Frames: ${summary?.totalFramesSent || 0}, Drops: ${summary?.droppedFrames || 0}`, type: 'info', id: Date.now() } as ServerLog,
        ...prev,
      ]);
    };

    socket.on('connect', handleConnect);
    socket.on('stream-recovered', handleStreamRecovered);
    socket.on('stream-stats', handleStreamStats);
    socket.on('destination-status', handleDestinationStatus);
    socket.on('stream-failed', handleStreamFailed);
    socket.on('session-summary', handleSessionSummary);

    return () => {
      socket.off('connect', handleConnect);
      socket.off('stream-recovered', handleStreamRecovered);
      socket.off('stream-stats', handleStreamStats);
      socket.off('destination-status', handleDestinationStatus);
      socket.off('stream-failed', handleStreamFailed);
      socket.off('session-summary', handleSessionSummary);
    };
  }, [socketRef.current, isStreaming, encodingProfile, setServerLogs, setTelemetry]);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordedChunksRef = useRef<Blob[]>([]);

  const startStreaming = async (showSettings: () => void) => {
    const activeDestinations = destinations.filter(d => d.enabled);
    if (activeDestinations.length === 0) {
      onError?.('No streaming destinations enabled. Configure at least one destination.');
      showSettings();
      return;
    }
    if (!activeDestinations.every(d => d.streamKey)) {
      onError?.('Missing stream key for one or more destinations.');
      showSettings();
      return;
    }

    try {
      if (window.__TAURI_INTERNALS__) {
        try {
          const { invoke } = await import('@tauri-apps/api/core');
          const res = await invoke('start_stream', {
            config: {
              destinations: activeDestinations.map(d => ({
                url: d.rtmpUrl || '',
                stream_key: d.streamKey || '',
                protocol: d.protocol || 'rtmp',
                name: d.name || '',
                enabled: d.enabled,
              })),
              width: 1920,
              height: 1080,
              fps: 30,
              bitrate: 4500,
              encoder: 'auto',
            }
          });
          setServerLogs(prev => [{ message: `Tauri: ${res}`, type: 'success', id: Date.now() } as ServerLog, ...prev]);
          setIsStreaming(true);
          onSuccess?.('Streaming started via Tauri.');
        } catch (tauriErr: any) {
          console.error('Tauri start_stream failed, falling back to browser:', tauriErr);
          // Tauri native streaming not yet connected — this is expected, not an error
          console.log('Tauri invoke not available, using browser streaming path');
          // Fall through to browser-based streaming below
        }
        if (isStreaming) return; // Tauri succeeded, no need for browser fallback
      }
      {
        const canvas = document.querySelector('canvas');
        if (!canvas) {
          onError?.('No canvas found. Make sure the compositor is visible.');
          return;
        }

        if (!socketRef.current?.connected) {
          onError?.('Not connected to server. Check your connection and try again.');
          return;
        }

        // Capture video-only from canvas — DO NOT add audio tracks
        // Adding audio tracks with vp8+opus codec causes MediaRecorder to stall
        // when the audio track has no active data (common with MediaStreamDestination).
        // FFmpeg on the server adds silent audio via anullsrc filter.
        const capturedStream = (canvas as HTMLCanvasElement).captureStream(30);

        // Always use video-only codec — most reliable across all browsers
        let mimeType = 'video/webm;codecs=vp8';
        if (!MediaRecorder.isTypeSupported(mimeType)) {
          mimeType = 'video/webm';
        }

        console.log(`Stream: video-only, mimeType: ${mimeType}`);

        const recorder = new MediaRecorder(capturedStream, { mimeType, videoBitsPerSecond: 6_000_000 });

        recorder.ondataavailable = (e) => {
          if (e.data.size > 0 && socketRef.current?.connected) {
            // Send the Blob directly — Socket.io handles Blob/binary natively
            // This avoids arrayBuffer() which can hang under Chrome memory pressure
            const size = e.data.size;
            const mbps = (size * 8) / 1_000_000;
            setTelemetry((prev: any) => ({ ...prev, bitrate: `${mbps.toFixed(1)} Mbps` }));
            socketRef.current.emit('stream-chunk', { chunk: e.data });
          }
        };

        recorder.onerror = (event) => {
          console.error('MediaRecorder Error:', event);
          setIsStreaming(false);
          onError?.('Stream recording failed.');
          setServerLogs(prev => [{ message: `Recorder Error: ${event}`, type: 'error', id: Date.now() } as ServerLog, ...prev]);
        };

        // Start FFmpeg on server first
        socketRef.current.emit('start-stream', {
          destinations: activeDestinations,
          encodingProfile,
        });

        // Wait for FFmpeg to initialize, then start recording
        await new Promise(resolve => setTimeout(resolve, 1000));

        recorder.start(1000);
        mediaRecorderRef.current = recorder;
        setIsStreaming(true);

        // Store destinations for reconnection recovery
        lastDestinationsRef.current = activeDestinations;
        // Reset dropped frames counter for new stream
        droppedFramesRef.current = 0;
        setDroppedFrames(0);

        onSuccess?.('Streaming started successfully.');
      }
    } catch (err: any) {
      console.error('Failed to start stream:', err);
      onError?.(`Failed to start stream: ${err?.message || 'Unknown error'}`);
      setServerLogs(prev => [{ message: `Stream Error: ${err}`, type: 'error', id: Date.now() } as ServerLog, ...prev]);
      setIsStreaming(false);
    }
  };

  const stopStreaming = async () => {
    try {
      if (window.__TAURI_INTERNALS__) {
        try {
          const { invoke } = await import('@tauri-apps/api/core');
          const res = await invoke('stop_stream');
          setServerLogs(prev => [{ message: `Tauri: ${res}`, type: 'info', id: Date.now() } as ServerLog, ...prev]);
          setIsStreaming(false);
          lastDestinationsRef.current = [];
          return;
        } catch (tauriErr) {
          console.error('Tauri stop_stream failed:', tauriErr);
          // Fall through to browser stop
        }
      }
      if (mediaRecorderRef.current && isStreaming) {
        mediaRecorderRef.current.stop();
        setIsStreaming(false);
        lastDestinationsRef.current = [];
        socketRef.current?.emit('stop-stream');
      }
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
    if (mixedAudio) mixedAudio.getAudioTracks().forEach(t => stream.addTrack(t));

    const recorder = new MediaRecorder(stream, { mimeType: 'video/webm;codecs=vp9' });
    recordedChunksRef.current = [];

    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) recordedChunksRef.current.push(e.data);
    };

    recorder.onstop = () => {
      const blob = new Blob(recordedChunksRef.current, { type: 'video/webm' });
      const url = URL.createObjectURL(blob);
      const newRecording: Recording = {
        id: `rec-${Date.now()}`,
        fileName: `Broadcast_${new Date().toISOString().replace(/[:.]/g, '-')}.webm`,
        timestamp: new Date().toLocaleString(),
        duration: '00:00:10',
        size: `${(blob.size / (1024 * 1024)).toFixed(1)} MB`,
        thumbnail: url,
        url,
      };
      setRecordings(prev => [newRecording, ...prev]);
    };

    recorder.start();
    mediaRecorderRef.current = recorder;
    setIsRecording(true);
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current) {
      mediaRecorderRef.current.stop();
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
