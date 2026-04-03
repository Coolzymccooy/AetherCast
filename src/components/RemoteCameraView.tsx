import React, { useEffect, useRef, useState, useCallback } from 'react';
import Peer, { MediaConnection } from 'peerjs';
import { Wifi, WifiOff, Mic, MicOff, Sun, Moon, RefreshCcw, ZoomIn, ZoomOut } from 'lucide-react';
import { motion } from 'motion/react';
import { hostPeerId, clientPeerId } from '../utils/peerId';
import { getPeerEnv } from '../utils/peerEnv';
import { DEFAULT_ICE_SERVERS } from '../utils/iceServers';
import { resolveRoomId } from '../utils/roomId';
import { useKeepAwake } from '../hooks/useKeepAwake';
import { MobileModeBar } from './MobileModeBar';
import { applyVideoTrackProfile, tuneOutgoingVideoPeerConnection } from '../utils/videoQuality';

type Resolution = '720p' | '1080p';
const RESOLUTIONS: Record<Resolution, { width: number; height: number }> = {
  '720p': { width: 1280, height: 720 },
  '1080p': { width: 1920, height: 1080 },
};

/**
 * RemoteCameraView — renders when `?mode=remote` is in the URL.
 *
 * Uses PeerJS cloud signaling (0.peerjs.com) so no LAN IP or Socket.io
 * server URL is needed — works from any network.
 *
 * Flow:
 *   1. Get camera stream via getUserMedia
 *   2. Create PeerJS client peer (unique ID each session)
 *   3. Poll for host peer (aether-{room}-host) until found
 *   4. Call host with stream → host answers → WebRTC connected
 */
export default function RemoteCameraView() {
  const roomId = resolveRoomId(new URLSearchParams(window.location.search).get('room'));
  const initialHostId = hostPeerId(roomId);
  useKeepAwake(true);

  const [status, setStatus] = useState<'idle' | 'camera' | 'connecting' | 'ready' | 'connected' | 'error'>('idle');
  const [errorMsg, setErrorMsg] = useState('');
  const [searchSecs, setSearchSecs] = useState(0);
  const [isMuted, setIsMuted] = useState(false);
  const [facingMode, setFacingMode] = useState<'user' | 'environment'>('environment');
  const [resolution, setResolution] = useState<Resolution>('1080p');
  const [zoom, setZoom] = useState(1);
  const [maxZoom, setMaxZoom] = useState(1);
  const [logs, setLogs] = useState<string[]>([]);
  const [debugInfo, setDebugInfo] = useState({
    hostId: initialHostId,
    clientId: '',
    peerServer: '',
    lastEvent: 'idle',
  });

  const searchTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const broadcastFnRef = useRef<(() => void) | null>(null);
  const peerRef = useRef<Peer | null>(null);
  const callRef = useRef<MediaConnection | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const hostCheckTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const shouldAutoBroadcastRef = useRef(false);

  const addLog = useCallback((msg: string) => {
    setLogs(prev => [msg, ...prev].slice(0, 3));
  }, []);

  const resetTransport = useCallback(() => {
    if (hostCheckTimerRef.current) { clearTimeout(hostCheckTimerRef.current); hostCheckTimerRef.current = null; }
    if (searchTimerRef.current) { clearInterval(searchTimerRef.current); searchTimerRef.current = null; }
    if (reconnectTimerRef.current) { clearTimeout(reconnectTimerRef.current); reconnectTimerRef.current = null; }
    callRef.current?.close();
    peerRef.current?.destroy();
    callRef.current = null;
    peerRef.current = null;
  }, []);

  const cleanup = useCallback(() => {
    resetTransport();
    streamRef.current?.getTracks().forEach(t => t.stop());
    streamRef.current = null;
  }, [resetTransport]);

  useEffect(() => () => cleanup(), [cleanup]);

  // Track how long we've been searching so we can show a helpful hint
  useEffect(() => {
    if (status === 'connecting') {
      setSearchSecs(0);
      searchTimerRef.current = setInterval(() => setSearchSecs(s => s + 1), 1000);
    } else {
      if (searchTimerRef.current) { clearInterval(searchTimerRef.current); searchTimerRef.current = null; }
      if (status !== 'error') setSearchSecs(0);
    }
    return () => {
      if (searchTimerRef.current) { clearInterval(searchTimerRef.current); searchTimerRef.current = null; }
    };
  }, [status]);

  const doCall = useCallback((peer: Peer, stream: MediaStream, attempt: () => void) => {
    const hostId = hostPeerId(roomId);
    setDebugInfo(prev => ({ ...prev, hostId, lastEvent: 'calling-host' }));
    addLog('Calling Studio...');
    shouldAutoBroadcastRef.current = true;

    const call = peer.call(hostId, stream, { metadata: { role: 'camera', room: roomId } });
    callRef.current = call;

    const peerConn: RTCPeerConnection | undefined = (call as any).peerConnection;
    if (peerConn) {
      void tuneOutgoingVideoPeerConnection(peerConn, 'camera');
      const onConnState = () => {
        if (peerConn.connectionState === 'connected') {
          setStatus('connected');
          addLog('Connected!');
          setDebugInfo(prev => ({ ...prev, lastEvent: 'webrtc-connected' }));
          peerConn.removeEventListener('connectionstatechange', onConnState);
        }
      };
      peerConn.addEventListener('connectionstatechange', onConnState);
    }
    call.on('stream', () => {
      setStatus('connected');
      addLog('Connected!');
      setDebugInfo(prev => ({ ...prev, lastEvent: 'remote-stream-active' }));
    });
    call.on('close', () => {
      setStatus('connecting');
      addLog('Call ended, retrying...');
      broadcastFnRef.current = null;
      callRef.current = null;
      setDebugInfo(prev => ({ ...prev, lastEvent: 'call-closed-retrying' }));
      hostCheckTimerRef.current = setTimeout(attempt, 2000);
    });
    call.on('error', (err) => {
      setStatus('connecting');
      addLog(`Call error: ${err.message}`);
      broadcastFnRef.current = null;
      callRef.current = null;
      setDebugInfo(prev => ({ ...prev, lastEvent: `call-error:${err.message}` }));
      hostCheckTimerRef.current = setTimeout(attempt, 2000);
    });
  }, [roomId, addLog]);

  const startHostChecker = useCallback((peer: Peer, stream: MediaStream) => {
    const hostId = hostPeerId(roomId);

    const attempt = () => {
      addLog('Searching for Studio...');
      setDebugInfo(prev => ({ ...prev, hostId, lastEvent: 'probing-studio-host' }));
      const conn = peer.connect(hostId, { reliable: true });

      const timeout = setTimeout(() => {
        try { conn.close(); } catch { /* ok */ }
        setDebugInfo(prev => ({ ...prev, lastEvent: 'host-probe-timeout' }));
        hostCheckTimerRef.current = setTimeout(attempt, 1500);
      }, 2000);

      conn.on('open', () => {
        clearTimeout(timeout);
        try { conn.close(); } catch { /* ok */ }
        addLog('Studio found!');
        setDebugInfo(prev => ({ ...prev, lastEvent: 'studio-host-ready' }));
        if (shouldAutoBroadcastRef.current) {
          setStatus('connecting');
          addLog('Restoring live feed...');
          doCall(peer, stream, attempt);
        } else {
          // Park here — wait for user to tap "Start Broadcasting"
          setStatus('ready');
          broadcastFnRef.current = () => doCall(peer, stream, attempt);
        }
      });

      conn.on('error', () => {
        clearTimeout(timeout);
        setDebugInfo(prev => ({ ...prev, lastEvent: 'host-probe-retrying' }));
        hostCheckTimerRef.current = setTimeout(attempt, 1500);
      });
    };

    attempt();
  }, [roomId, addLog, doCall]);

  const connectPeerTransport = useCallback((stream: MediaStream, lastEvent: string = 'connecting-peerjs') => {
    streamRef.current = stream;
    resetTransport();
    setStatus('connecting');
    setErrorMsg('');
    addLog('Connecting to PeerJS cloud...');

    const myId = clientPeerId(roomId, 'camera');
    const peerEnv = getPeerEnv();
    const peerServer = `${peerEnv.secure ? 'https' : 'http'}://${peerEnv.host}:${peerEnv.port}${peerEnv.path}`;
    setDebugInfo({
      hostId: hostPeerId(roomId),
      clientId: myId,
      peerServer,
      lastEvent,
    });

    const peer = new Peer(myId, {
      host: peerEnv.host, port: peerEnv.port, path: peerEnv.path, secure: peerEnv.secure, debug: 0,
      config: { iceServers: DEFAULT_ICE_SERVERS },
    });
    peerRef.current = peer;

    peer.on('open', () => {
      addLog('Cloud ready');
      setDebugInfo(prev => ({ ...prev, lastEvent: 'peerjs-open' }));
      startHostChecker(peer, streamRef.current ?? stream);
    });
    peer.on('disconnected', () => {
      addLog('Cloud disconnected, reconnecting...');
      setDebugInfo(prev => ({ ...prev, lastEvent: 'peerjs-disconnected' }));
      try { (peer as any).reconnect?.(); } catch { /* ok */ }
    });
    peer.on('error', (err: any) => {
      addLog(`Peer error: ${err.type || err.message}`);
      setDebugInfo(prev => ({ ...prev, lastEvent: `peer-error:${err.type || err.message}` }));

      if (err.type === 'network' || err.type === 'disconnected') {
        const existingStream = streamRef.current ?? stream;
        if (existingStream) {
          setStatus('connecting');
          setErrorMsg('');
          if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
          reconnectTimerRef.current = setTimeout(() => {
            connectPeerTransport(existingStream, 'reconnecting-peerjs');
          }, 1500);
          return;
        }
      }

      if (err.type !== 'peer-unavailable') {
        setStatus('error');
        setErrorMsg(`PeerJS error: ${err.type || err.message}`);
      }
    });
  }, [addLog, resetTransport, roomId, startHostChecker]);

  const returnHome = () => {
    shouldAutoBroadcastRef.current = false;
    cleanup();
    window.location.href = '/?mode=app';
  };

  /** Acquire a camera stream only — no PeerJS side effects */
  const acquireStream = useCallback(async (facing: 'user' | 'environment', res: Resolution): Promise<MediaStream | null> => {
    const { width, height } = RESOLUTIONS[res];
    const attempts: MediaStreamConstraints[] = [
      { video: { facingMode: facing, width: { ideal: width }, height: { ideal: height }, frameRate: { ideal: 30, max: 30 } }, audio: true },
      { video: { facingMode: facing, width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30, max: 30 } }, audio: true },
      { video: { facingMode: facing }, audio: true },
      { video: { facingMode: facing }, audio: false },
    ];
    for (const constraints of attempts) {
      try {
        const stream = await navigator.mediaDevices.getUserMedia(constraints);
        applyVideoTrackProfile(stream.getVideoTracks()[0], 'camera');
        return stream;
      } catch { /* try next */ }
    }
    return null;
  }, []);

  /** Apply a new stream to preview + update zoom state */
  const applyStreamLocally = useCallback((stream: MediaStream) => {
    if (videoRef.current) {
      videoRef.current.srcObject = stream;
      videoRef.current.play().catch(() => { /* autoplay ok */ });
    }
    setZoom(1);
    const videoTrack = stream.getVideoTracks()[0];
    if (videoTrack) {
      const caps = videoTrack.getCapabilities?.() as any;
      setMaxZoom(caps?.zoom?.max ?? 1);
    }
  }, []);

  /**
   * Swap camera without dropping the WebRTC connection.
   * Uses RTCPeerConnection.replaceTrack() when connected.
   * Falls back to full restart only if not yet connected.
   */
  const swapCamera = useCallback(async (facing: 'user' | 'environment', res: Resolution) => {
    const call = callRef.current;
    const pc: RTCPeerConnection | undefined = (call as any)?.peerConnection;

    if (pc && pc.connectionState === 'connected') {
      const newStream = await acquireStream(facing, res);
      if (!newStream) return;

      const newVideo = newStream.getVideoTracks()[0];
      const newAudio = newStream.getAudioTracks()[0];

      const videoSender = pc.getSenders().find(s => s.track?.kind === 'video');
      const audioSender = pc.getSenders().find(s => s.track?.kind === 'audio');

      try {
        if (videoSender && newVideo) await videoSender.replaceTrack(newVideo);
        if (audioSender && newAudio) await audioSender.replaceTrack(newAudio);
        if (newVideo) applyVideoTrackProfile(newVideo, 'camera');
        void tuneOutgoingVideoPeerConnection(pc, 'camera');
      } catch { /* replaceTrack not supported — fall through below */ }

      // Stop old tracks, swap ref
      streamRef.current?.getTracks().forEach(t => t.stop());
      streamRef.current = newStream;
      newStream.getAudioTracks().forEach(t => (t.enabled = !isMuted));
      applyStreamLocally(newStream);
      return;
    }

    // Not connected yet — full restart
    cleanup();
    setStatus('camera');
    setErrorMsg('');

    const stream = await acquireStream(facing, res);
    if (!stream) { setStatus('error'); setErrorMsg('Camera permission denied or not available.'); return; }

    streamRef.current = stream;
    stream.getAudioTracks().forEach(t => (t.enabled = !isMuted));
    applyStreamLocally(stream);
    connectPeerTransport(stream);
  }, [acquireStream, applyStreamLocally, cleanup, connectPeerTransport, isMuted]);

  const start = useCallback(async (facing: 'user' | 'environment' = facingMode, res: Resolution = resolution) => {
    await swapCamera(facing, res);
  }, [facingMode, resolution, swapCamera]);

  useEffect(() => { start(); }, []);

  useEffect(() => {
    const handleResume = () => {
      if (document.visibilityState === 'hidden') return;
      const existingStream = streamRef.current;
      if (!existingStream || status === 'connected' || status === 'ready' || status === 'camera') return;
      addLog('Restoring camera link...');
      connectPeerTransport(existingStream, 'reconnecting-peerjs');
    };

    window.addEventListener('online', handleResume);
    window.addEventListener('focus', handleResume);
    window.addEventListener('pageshow', handleResume);
    document.addEventListener('visibilitychange', handleResume);

    return () => {
      window.removeEventListener('online', handleResume);
      window.removeEventListener('focus', handleResume);
      window.removeEventListener('pageshow', handleResume);
      document.removeEventListener('visibilitychange', handleResume);
    };
  }, [addLog, connectPeerTransport, status]);

  const toggleMute = () => {
    if (!streamRef.current) return;
    const next = !isMuted;
    streamRef.current.getAudioTracks().forEach(t => (t.enabled = !next));
    setIsMuted(next);
  };

  const flipCamera = async () => {
    const next = facingMode === 'user' ? 'environment' : 'user';
    setFacingMode(next);
    await swapCamera(next, resolution);
  };

  const toggleResolution = async () => {
    const next: Resolution = resolution === '720p' ? '1080p' : '720p';
    setResolution(next);
    await swapCamera(facingMode, next);
  };

  const applyZoom = async (value: number) => {
    setZoom(value);
    const videoTrack = streamRef.current?.getVideoTracks()[0];
    if (videoTrack && typeof videoTrack.applyConstraints === 'function') {
      try {
        await videoTrack.applyConstraints({ advanced: [{ zoom: value } as any] });
      } catch { /* zoom not supported on this device */ }
    }
  };

  const statusLabel = {
    idle: 'Initializing...',
    camera: 'Starting camera...',
    connecting: 'Searching for Studio...',
    ready: 'Studio Ready',
    connected: 'LIVE — Studio Connected',
    error: 'Connection failed',
  }[status];

  return (
    <div className="h-screen bg-black flex flex-col items-center justify-center text-white px-4">
      <MobileModeBar roomId={roomId} onHome={returnHome} />
      <div className="relative w-full max-w-sm aspect-[9/16] bg-gray-900 rounded-2xl overflow-hidden shadow-2xl border border-white/10">
        <video
          ref={videoRef}
          autoPlay muted playsInline
          className="w-full h-full object-cover"
          style={{ transform: facingMode === 'user' ? 'scaleX(-1)' : 'none' }}
        />

        {/* Status badge */}
        <div className="absolute top-4 left-0 right-0 flex justify-center">
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            className={`flex items-center gap-2 px-4 py-1.5 rounded-full text-xs font-bold backdrop-blur-md border ${
              status === 'connected'
                ? 'bg-red-600/80 border-red-500/50 text-white'
                : status === 'ready'
                ? 'bg-green-600/80 border-green-500/50 text-white'
                : status === 'error'
                ? 'bg-red-900/80 border-red-700/50 text-red-300'
                : 'bg-black/60 border-white/20 text-gray-300'
            }`}
          >
            {status === 'connected'
              ? <><div className="w-2 h-2 bg-white rounded-full animate-pulse" /> LIVE</>
              : status === 'ready'
              ? <><div className="w-2 h-2 bg-green-300 rounded-full" /> Studio Ready</>
              : status === 'error'
              ? <><WifiOff size={12} /> Error</>
              : <><Wifi size={12} className="animate-pulse" /> {statusLabel}</>
            }
          </motion.div>
        </div>

        {/* Start Broadcasting overlay */}
        {status === 'ready' && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="absolute inset-0 flex flex-col items-center justify-center bg-black/50 backdrop-blur-sm"
          >
            <motion.button
              initial={{ scale: 0.85 }}
              animate={{ scale: 1 }}
              whileTap={{ scale: 0.95 }}
              onClick={() => {
                shouldAutoBroadcastRef.current = true;
                broadcastFnRef.current?.();
              }}
              className="flex flex-col items-center gap-3 px-10 py-6 rounded-3xl bg-red-600 hover:bg-red-700 active:bg-red-800 text-white font-bold shadow-2xl shadow-red-900/60"
            >
              <div className="w-16 h-16 rounded-full bg-white/20 flex items-center justify-center">
                <div className="w-8 h-8 rounded-full bg-white" />
              </div>
              <span className="text-lg tracking-wide">Start Broadcasting</span>
              <span className="text-xs font-normal text-red-200">Studio is connected and waiting</span>
            </motion.button>
          </motion.div>
        )}

        {/* Live log */}
        {logs.length > 0 && status !== 'connected' && (
          <div className="absolute top-16 left-0 right-0 flex flex-col items-center gap-1 px-4">
            {logs.map((l, i) => (
              <span key={i} className="text-[10px] text-white/50 font-mono">{l}</span>
            ))}
            {status === 'connecting' && searchSecs >= 10 && (
              <span className="text-[10px] text-yellow-400/80 font-mono mt-1 text-center px-4">
                Make sure AetherCast Studio is open and running on the desktop.
              </span>
            )}
          </div>
        )}

        {/* Zoom slider — only visible when zoom is supported */}
        {maxZoom > 1 && (
          <div className="absolute left-3 top-1/2 -translate-y-1/2 flex flex-col items-center gap-1">
            <button onClick={() => applyZoom(Math.min(zoom + 0.5, maxZoom))} className="w-8 h-8 rounded-full bg-black/60 flex items-center justify-center border border-white/20">
              <ZoomIn size={14} />
            </button>
            <input
              type="range" min={1} max={maxZoom} step={0.1} value={zoom}
              onChange={e => applyZoom(Number(e.target.value))}
              className="h-24 appearance-none cursor-pointer"
              style={{ writingMode: 'vertical-lr', direction: 'rtl' } as React.CSSProperties}
            />
            <button onClick={() => applyZoom(Math.max(zoom - 0.5, 1))} className="w-8 h-8 rounded-full bg-black/60 flex items-center justify-center border border-white/20">
              <ZoomOut size={14} />
            </button>
            <span className="text-[9px] text-white/50 font-mono">{zoom.toFixed(1)}x</span>
          </div>
        )}

        <div className="absolute bottom-20 left-0 right-0 text-center">
          <p className="text-[10px] text-white/40 font-mono uppercase tracking-widest">Room: {roomId}</p>
        </div>

        {/* Controls */}
        <div className="absolute bottom-6 left-0 right-0 flex justify-center gap-4">
          <button
            onClick={toggleMute}
            className={`w-12 h-12 rounded-full flex items-center justify-center border-2 backdrop-blur-md transition-colors ${
              isMuted ? 'bg-red-600/80 border-red-500' : 'bg-black/60 border-white/30 hover:bg-white/20'
            }`}
          >
            {isMuted ? <MicOff size={20} /> : <Mic size={20} />}
          </button>
          <button
            onClick={flipCamera}
            className="w-12 h-12 rounded-full bg-black/60 border-2 border-white/30 flex items-center justify-center backdrop-blur-md hover:bg-white/20 transition-colors"
            title={facingMode === 'user' ? 'Switch to rear camera' : 'Switch to front camera'}
          >
            {facingMode === 'user' ? <Moon size={20} /> : <Sun size={20} />}
          </button>
          <button
            onClick={toggleResolution}
            className="h-12 px-3 rounded-full bg-black/60 border-2 border-white/30 flex items-center justify-center backdrop-blur-md hover:bg-white/20 transition-colors text-[11px] font-bold"
          >
            {resolution}
          </button>
        </div>
      </div>

      <p className="mt-6 text-xs text-gray-500 text-center max-w-xs leading-relaxed">
        Your phone is broadcasting to Aether Studio.<br />
        Keep this screen open to stay connected.
      </p>

      <div className="mt-3 w-full max-w-sm rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-[10px] font-mono text-white/55 space-y-1">
        <div>Host: {debugInfo.hostId}</div>
        <div>Client: {debugInfo.clientId || 'pending'}</div>
        <div>Peer server: {debugInfo.peerServer || 'pending'}</div>
        <div>State: {debugInfo.lastEvent}</div>
      </div>

      {status === 'error' && (
        <div className="mt-4 text-center space-y-3">
          {errorMsg && <p className="text-xs text-red-400 max-w-xs">{errorMsg}</p>}
          <button
            onClick={() => start()}
            className="px-6 py-2 bg-accent-cyan text-black text-xs font-bold rounded-full hover:bg-cyan-400 transition-colors flex items-center gap-2 mx-auto"
          >
            <RefreshCcw size={14} /> Retry
          </button>
        </div>
      )}
    </div>
  );
}
