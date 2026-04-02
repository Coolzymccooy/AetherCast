import React, { useEffect, useRef, useState, useCallback } from 'react';
import Peer, { MediaConnection } from 'peerjs';
import { Monitor, Wifi, WifiOff, Share2 } from 'lucide-react';
import { motion } from 'motion/react';
import { hostPeerId, clientPeerId } from '../utils/peerId';

/**
 * PhoneScreenView — renders when `?mode=screen` is in the URL.
 *
 * Uses PeerJS cloud signaling (0.peerjs.com) so no LAN IP is needed.
 *
 * Flow:
 *   1. User taps "Start Screen Share" → getDisplayMedia
 *   2. Create PeerJS client peer
 *   3. Poll for host peer until found
 *   4. Call host with screen stream → WebRTC connected
 */
export default function PhoneScreenView() {
  const roomId = new URLSearchParams(window.location.search).get('room') ?? 'SLTN-1234';

  const [status, setStatus] = useState<'idle' | 'requesting' | 'connecting' | 'connected' | 'error'>('idle');
  const [errorMsg, setErrorMsg] = useState('');
  const [logs, setLogs] = useState<string[]>([]);

  const peerRef = useRef<Peer | null>(null);
  const callRef = useRef<MediaConnection | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const previewRef = useRef<HTMLVideoElement>(null);
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

        const call = peer.call(hostId, stream, { metadata: { role: 'screen', room: roomId } });
        callRef.current = call;

        call.on('stream', () => {
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

  const startSharing = async () => {
    if (typeof navigator.mediaDevices?.getDisplayMedia !== 'function') {
      setStatus('error');
      setErrorMsg('Screen sharing is not supported on this device. Please use desktop Chrome, Firefox, or Safari on iOS 16.4+.');
      return;
    }

    cleanup();
    setStatus('requesting');
    setErrorMsg('');

    let stream: MediaStream | null = null;
    try {
      stream = await navigator.mediaDevices.getDisplayMedia({
        video: { frameRate: { ideal: 30 }, width: { ideal: 1280 }, height: { ideal: 720 } } as MediaTrackConstraints,
        audio: false,
      });
    } catch (err: unknown) {
      setStatus('error');
      setErrorMsg(err instanceof Error ? err.message : 'Screen share was denied or not supported.');
      return;
    }

    streamRef.current = stream;
    if (previewRef.current) {
      previewRef.current.srcObject = stream;
      previewRef.current.play().catch(() => { /* autoplay ok */ });
    }

    // If user stops from browser UI
    stream.getVideoTracks()[0]?.addEventListener('ended', () => {
      cleanup();
      setStatus('idle');
    });

    setStatus('connecting');
    addLog('Connecting to PeerJS cloud...');

    const myId = clientPeerId(roomId);
    const peer = new Peer(myId, {
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
  };

  const stopSharing = () => {
    cleanup();
    setStatus('idle');
  };

  const statusLabel = {
    idle: 'Not sharing',
    requesting: 'Requesting permission...',
    connecting: 'Searching for Studio...',
    connected: 'LIVE — Screen is being shared',
    error: 'Error',
  }[status];

  return (
    <div className="min-h-screen bg-bg text-white flex flex-col items-center justify-center p-6">
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        className="max-w-sm w-full space-y-6"
      >
        <div className="text-center">
          <div className="w-16 h-16 bg-blue-500/10 rounded-full flex items-center justify-center mx-auto mb-4 border border-blue-500/30">
            <Monitor size={32} className="text-blue-400" />
          </div>
          <h1 className="text-2xl font-bold">Screen Share</h1>
          <p className="text-gray-400 text-sm mt-2">Broadcast your screen to Aether Studio.</p>
          <p className="text-[11px] text-yellow-500/80 mt-2">
            Requires desktop Chrome / Firefox, or Safari on iOS 16.4+.<br />
            Not supported on Android Chrome.
          </p>
        </div>

        {/* Status */}
        <div className={`flex items-center justify-center gap-2 text-sm font-medium ${
          status === 'connected' ? 'text-green-400' :
          status === 'error' ? 'text-red-400' : 'text-gray-400'
        }`}>
          {status === 'connected' ? <Wifi size={16} /> : <WifiOff size={16} />}
          <span>{statusLabel}</span>
        </div>

        {/* Live log */}
        {logs.length > 0 && status === 'connecting' && (
          <div className="flex flex-col items-center gap-1">
            {logs.map((l, i) => (
              <span key={i} className="text-[10px] text-white/50 font-mono">{l}</span>
            ))}
          </div>
        )}

        {/* Preview */}
        {(status === 'connecting' || status === 'connected') && (
          <div className="rounded-xl overflow-hidden border border-border bg-black aspect-video">
            <video ref={previewRef} autoPlay muted playsInline className="w-full h-full object-contain" />
          </div>
        )}

        {status === 'error' && errorMsg && (
          <div className="p-4 bg-red-500/10 border border-red-500/30 rounded-xl text-red-400 text-sm text-center">
            {errorMsg}
          </div>
        )}

        {/* Controls */}
        {(status === 'idle' || status === 'error') ? (
          <button
            onClick={startSharing}
            className="w-full py-4 rounded-xl font-bold text-lg bg-blue-600 hover:bg-blue-700 text-white transition-colors flex items-center justify-center gap-2"
          >
            <Share2 size={20} />
            Start Screen Share
          </button>
        ) : status === 'connected' ? (
          <button
            onClick={stopSharing}
            className="w-full py-4 rounded-xl font-bold text-lg bg-red-600 hover:bg-red-700 text-white transition-colors"
          >
            Stop Sharing
          </button>
        ) : null}

        <p className="text-[11px] text-gray-600 text-center">Room: {roomId}</p>
      </motion.div>
    </div>
  );
}
