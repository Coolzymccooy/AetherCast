import React, { useEffect, useRef, useState, useCallback } from 'react';
import Peer, { MediaConnection } from 'peerjs';
import { Camera, Wifi, WifiOff, Mic, MicOff, Sun, Moon, RefreshCcw } from 'lucide-react';
import { motion } from 'motion/react';
import { hostPeerId, clientPeerId } from '../utils/peerId';
import { getPeerEnv } from '../utils/peerEnv';

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
  const roomId = new URLSearchParams(window.location.search).get('room') ?? 'SLTN-1234';

  const [status, setStatus] = useState<'idle' | 'camera' | 'connecting' | 'connected' | 'error'>('idle');
  const [errorMsg, setErrorMsg] = useState('');
  const [isMuted, setIsMuted] = useState(false);
  const [facingMode, setFacingMode] = useState<'user' | 'environment'>('environment');
  const [logs, setLogs] = useState<string[]>([]);

  const peerRef = useRef<Peer | null>(null);
  const callRef = useRef<MediaConnection | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const hostCheckTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const addLog = useCallback((msg: string) => {
    setLogs(prev => [msg, ...prev].slice(0, 3));
  }, []);

  const cleanup = useCallback(() => {
    if (hostCheckTimerRef.current) clearTimeout(hostCheckTimerRef.current);
    callRef.current?.close();
    peerRef.current?.destroy();
    streamRef.current?.getTracks().forEach(t => t.stop());
    callRef.current = null;
    peerRef.current = null;
    streamRef.current = null;
  }, []);

  useEffect(() => () => cleanup(), [cleanup]);

  const startHostChecker = useCallback((peer: Peer, stream: MediaStream) => {
    const hostId = hostPeerId(roomId);

    const attempt = () => {
      addLog('Searching for Studio...');
      const conn = peer.connect(hostId, { reliable: true });

      const timeout = setTimeout(() => {
        try { conn.close(); } catch { /* ok */ }
        hostCheckTimerRef.current = setTimeout(attempt, 1500);
      }, 2000);

      conn.on('open', () => {
        clearTimeout(timeout);
        try { conn.close(); } catch { /* ok */ }
        addLog('Studio found — calling...');

        const call = peer.call(hostId, stream, { metadata: { role: 'camera', room: roomId } });
        callRef.current = call;

        // Host answers without a return stream so 'stream' event may never fire.
        // Watch the underlying RTCPeerConnection for the actual connected state.
        const peerConn: RTCPeerConnection | undefined = (call as any).peerConnection;
        if (peerConn) {
          const onConnState = () => {
            if (peerConn.connectionState === 'connected') {
              setStatus('connected');
              addLog('Connected!');
              peerConn.removeEventListener('connectionstatechange', onConnState);
            }
          };
          peerConn.addEventListener('connectionstatechange', onConnState);
        }

        call.on('stream', () => {
          // Host sent a return stream (optional) — mark connected if not already
          setStatus('connected');
          addLog('Connected!');
        });
        call.on('close', () => {
          setStatus('connecting');
          addLog('Call ended, retrying...');
          hostCheckTimerRef.current = setTimeout(attempt, 2000);
        });
        call.on('error', (err) => {
          setStatus('connecting');
          addLog(`Call error: ${err.message}`);
          hostCheckTimerRef.current = setTimeout(attempt, 2000);
        });
      });

      conn.on('error', () => {
        clearTimeout(timeout);
        hostCheckTimerRef.current = setTimeout(attempt, 1500);
      });
    };

    attempt();
  }, [roomId, addLog]);

  const start = useCallback(async (facing: 'user' | 'environment' = facingMode) => {
    cleanup();
    setStatus('camera');
    setErrorMsg('');

    let stream: MediaStream | null = null;
    const attempts: MediaStreamConstraints[] = [
      { video: { facingMode: facing, width: { ideal: 1280 }, height: { ideal: 720 } }, audio: true },
      { video: { facingMode: facing }, audio: true },
      { video: { facingMode: facing }, audio: false },
    ];

    for (const constraints of attempts) {
      try {
        stream = await navigator.mediaDevices.getUserMedia(constraints);
        break;
      } catch { /* try next */ }
    }

    if (!stream) {
      setStatus('error');
      setErrorMsg('Camera permission denied or not available.');
      return;
    }

    streamRef.current = stream;
    stream.getAudioTracks().forEach(t => (t.enabled = !isMuted));

    if (videoRef.current) {
      videoRef.current.srcObject = stream;
      videoRef.current.play().catch(() => { /* autoplay ok */ });
    }

    setStatus('connecting');
    addLog('Connecting to PeerJS cloud...');

    const myId = clientPeerId(roomId);
    const peerEnv = getPeerEnv();
    const peer = new Peer(myId, {
      host: peerEnv.host,
      port: peerEnv.port,
      path: peerEnv.path,
      secure: peerEnv.secure,
      debug: 0,
      config: {
        iceServers: [
          { urls: 'stun:stun.l.google.com:19302' },
          { urls: 'stun:stun1.l.google.com:19302' },
        ],
      },
    });
    peerRef.current = peer;

    peer.on('open', () => {
      addLog('Cloud ready');
      startHostChecker(peer, stream!);
    });

    peer.on('disconnected', () => {
      addLog('Cloud disconnected, reconnecting...');
      try { (peer as any).reconnect?.(); } catch { /* ok */ }
    });

    peer.on('error', (err: any) => {
      addLog(`Peer error: ${err.type || err.message}`);
      if (err.type !== 'peer-unavailable') {
        setStatus('error');
        setErrorMsg(`PeerJS error: ${err.type || err.message}`);
      }
    });
  }, [facingMode, isMuted, cleanup, addLog, startHostChecker, roomId]);

  useEffect(() => { start(); }, []);

  const toggleMute = () => {
    if (!streamRef.current) return;
    const next = !isMuted;
    streamRef.current.getAudioTracks().forEach(t => (t.enabled = !next));
    setIsMuted(next);
  };

  const flipCamera = async () => {
    const next = facingMode === 'user' ? 'environment' : 'user';
    setFacingMode(next);
    await start(next);
  };

  const statusLabel = {
    idle: 'Initializing...',
    camera: 'Starting camera...',
    connecting: 'Searching for Studio...',
    connected: 'LIVE — Studio Connected',
    error: 'Connection failed',
  }[status];

  return (
    <div className="h-screen bg-black flex flex-col items-center justify-center text-white">
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
                : status === 'error'
                ? 'bg-red-900/80 border-red-700/50 text-red-300'
                : 'bg-black/60 border-white/20 text-gray-300'
            }`}
          >
            {status === 'connected'
              ? <><div className="w-2 h-2 bg-white rounded-full animate-pulse" /> LIVE</>
              : status === 'error'
              ? <><WifiOff size={12} /> Error</>
              : <><Wifi size={12} className="animate-pulse" /> {statusLabel}</>
            }
          </motion.div>
        </div>

        {/* Live log */}
        {logs.length > 0 && status !== 'connected' && (
          <div className="absolute top-16 left-0 right-0 flex flex-col items-center gap-1 px-4">
            {logs.map((l, i) => (
              <span key={i} className="text-[10px] text-white/50 font-mono">{l}</span>
            ))}
          </div>
        )}

        <div className="absolute bottom-20 left-0 right-0 text-center">
          <p className="text-[10px] text-white/40 font-mono uppercase tracking-widest">Room: {roomId}</p>
        </div>

        {/* Controls */}
        <div className="absolute bottom-6 left-0 right-0 flex justify-center gap-6">
          <button
            onClick={toggleMute}
            className={`w-14 h-14 rounded-full flex items-center justify-center border-2 backdrop-blur-md transition-colors ${
              isMuted ? 'bg-red-600/80 border-red-500' : 'bg-black/60 border-white/30 hover:bg-white/20'
            }`}
          >
            {isMuted ? <MicOff size={22} /> : <Mic size={22} />}
          </button>
          <button
            onClick={flipCamera}
            className="w-14 h-14 rounded-full bg-black/60 border-2 border-white/30 flex items-center justify-center backdrop-blur-md hover:bg-white/20 transition-colors"
          >
            {facingMode === 'user' ? <Moon size={22} /> : <Sun size={22} />}
          </button>
        </div>
      </div>

      <p className="mt-6 text-xs text-gray-500 text-center max-w-xs leading-relaxed">
        Your phone is broadcasting to Aether Studio.<br />
        Keep this screen open to stay connected.
      </p>

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
