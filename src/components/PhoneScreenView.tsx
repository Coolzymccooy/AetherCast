import React, { useEffect, useRef, useState, useCallback } from 'react';
import Peer, { MediaConnection } from 'peerjs';
import { Monitor, Wifi, WifiOff, Share2 } from 'lucide-react';
import { motion } from 'motion/react';
import { hostPeerId, clientPeerId } from '../utils/peerId';
import { getPeerEnv } from '../utils/peerEnv';
import { useScreenCapture } from '../hooks/useScreenCapture';

/** True when running inside the Capacitor Android APK */
const isNativeAndroid = (): boolean =>
  typeof (window as Window & { Capacitor?: { isNative?: boolean; platform?: string } }).Capacitor !== 'undefined' &&
  !!(window as Window & { Capacitor?: { isNative?: boolean } }).Capacitor?.isNative;

/**
 * PhoneScreenView — renders when `?mode=screen` is in the URL.
 *
 * Two paths:
 *  • Native Android APK  → useScreenCapture hook (MediaProjection via Java plugin)
 *  • Browser (desktop)   → getDisplayMedia (works on Chrome/Firefox desktop)
 *
 * Both paths hand a MediaStream to PeerJS for WebRTC delivery to the Studio.
 */
export default function PhoneScreenView() {
  const roomId = new URLSearchParams(window.location.search).get('room') ?? 'SLTN-1234';
  const isNative = isNativeAndroid();

  const [status, setStatus] = useState<'idle' | 'requesting' | 'connecting' | 'connected' | 'error'>('idle');
  const [errorMsg, setErrorMsg] = useState('');
  const [logs, setLogs] = useState<string[]>([]);

  const peerRef = useRef<Peer | null>(null);
  const callRef = useRef<MediaConnection | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const previewRef = useRef<HTMLVideoElement>(null);
  const hostCheckTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Native screen capture hook — only active inside the APK
  const { stream: nativeStream, isCapturing, error: captureError, startCapture, stopCapture } = useScreenCapture();

  const addLog = useCallback((msg: string) => {
    setLogs(prev => [msg, ...prev].slice(0, 3));
  }, []);

  const cleanup = useCallback(() => {
    if (hostCheckTimerRef.current) clearTimeout(hostCheckTimerRef.current);
    callRef.current?.close();
    peerRef.current?.destroy();
    if (!isNative) {
      // On web we own the stream tracks; on native the hook owns them
      streamRef.current?.getTracks().forEach(t => t.stop());
    }
    callRef.current = null;
    peerRef.current = null;
    streamRef.current = null;
  }, [isNative]);

  useEffect(() => () => cleanup(), [cleanup]);

  // When native stream becomes available, connect to Studio
  useEffect(() => {
    if (isNative && nativeStream && status === 'requesting') {
      streamRef.current = nativeStream;
      if (previewRef.current) {
        previewRef.current.srcObject = nativeStream;
        previewRef.current.play().catch(() => { /* autoplay ok */ });
      }
      connectToStudio(nativeStream);
    }
  }, [nativeStream, isNative, status]); // eslint-disable-line react-hooks/exhaustive-deps

  // Surface native capture errors
  useEffect(() => {
    if (captureError) {
      setStatus('error');
      setErrorMsg(captureError);
    }
  }, [captureError]);

  const connectToStudio = useCallback((stream: MediaStream) => {
    setStatus('connecting');
    addLog('Connecting to PeerJS cloud...');

    const myId = clientPeerId(roomId);
    const peerEnv = getPeerEnv();
    const peer = new Peer(myId, {
      host: peerEnv.host, port: peerEnv.port, path: peerEnv.path, secure: peerEnv.secure, debug: 0,
      config: { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }, { urls: 'stun:stun1.l.google.com:19302' }] },
    });
    peerRef.current = peer;

    peer.on('open', () => {
      addLog('Cloud ready');
      startHostChecker(peer, stream);
    });
    peer.on('disconnected', () => {
      addLog('Cloud disconnected, reconnecting...');
      try { (peer as unknown as { reconnect?: () => void }).reconnect?.(); } catch { /* ok */ }
    });
    peer.on('error', (err: unknown) => {
      const e = err as { type?: string; message?: string };
      addLog(`Peer error: ${e.type ?? e.message ?? 'unknown'}`);
      if (e.type !== 'peer-unavailable') {
        setStatus('error');
        setErrorMsg(`PeerJS error: ${e.type ?? e.message ?? 'unknown'}`);
      }
    });
  }, [roomId, addLog]); // eslint-disable-line react-hooks/exhaustive-deps

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

        const peerConn: RTCPeerConnection | undefined = (call as unknown as { peerConnection?: RTCPeerConnection }).peerConnection;
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

        call.on('stream', () => { setStatus('connected'); addLog('Connected!'); });
        call.on('close', () => { setStatus('connecting'); addLog('Call ended, retrying...'); hostCheckTimerRef.current = setTimeout(attempt, 2000); });
        call.on('error', (err) => { setStatus('connecting'); addLog(`Call error: ${err.message}`); hostCheckTimerRef.current = setTimeout(attempt, 2000); });
      });

      conn.on('error', () => { clearTimeout(timeout); hostCheckTimerRef.current = setTimeout(attempt, 1500); });
    };

    attempt();
  }, [roomId, addLog]);

  const startSharing = async () => {
    cleanup();
    setStatus('requesting');
    setErrorMsg('');

    if (isNative) {
      // Trigger native MediaProjection permission — the useEffect above picks up the stream
      await startCapture();
      return;
    }

    // Browser path
    if (typeof navigator.mediaDevices?.getDisplayMedia !== 'function') {
      setStatus('error');
      setErrorMsg(
        'Screen sharing is not supported on mobile browsers. ' +
        'Install the AetherCast app from the Studio QR code for Android screen sharing.'
      );
      return;
    }

    let stream: MediaStream | null = null;
    try {
      stream = await navigator.mediaDevices.getDisplayMedia({
        video: { frameRate: { ideal: 30 }, width: { ideal: 1280 }, height: { ideal: 720 } } as MediaTrackConstraints,
        audio: false,
      });
    } catch (err: unknown) {
      setStatus('error');
      const msg = err instanceof Error ? err.message : '';
      if (msg.toLowerCase().includes('permission') || msg.toLowerCase().includes('denied') || msg.toLowerCase().includes('not allowed')) {
        setErrorMsg('Screen share was denied. Please allow it and try again.');
      } else if (msg.toLowerCase().includes('not supported') || msg.toLowerCase().includes('not implemented')) {
        setErrorMsg('Screen sharing is not supported in this browser. Use the AetherCast Android app instead.');
      } else {
        setErrorMsg(msg || 'Screen share failed. Try a different browser.');
      }
      return;
    }

    streamRef.current = stream;
    if (previewRef.current) {
      previewRef.current.srcObject = stream;
      previewRef.current.play().catch(() => { /* autoplay ok */ });
    }
    stream.getVideoTracks()[0]?.addEventListener('ended', () => { cleanup(); setStatus('idle'); });
    connectToStudio(stream);
  };

  const stopSharing = () => {
    if (isNative) stopCapture();
    cleanup();
    setStatus('idle');
  };

  const statusLabel = {
    idle: isNative ? 'Ready to share screen' : 'Not sharing',
    requesting: isNative ? 'Requesting permission...' : 'Requesting permission...',
    connecting: 'Searching for Studio...',
    connected: 'LIVE — Screen is being shared',
    error: 'Error',
  }[status];

  return (
    <div className="h-screen overflow-y-auto bg-bg text-white flex flex-col items-center justify-center p-6">
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
          {!isNative && (
            <p className="text-[11px] text-gray-500 mt-2">
              Works on desktop Chrome, Firefox, Edge, and Safari (Mac).<br />
              On Android, use the AetherCast app for full screen sharing.
            </p>
          )}
          {isNative && (
            <p className="text-[11px] text-green-600 mt-2 font-medium">
              AetherCast app — native screen capture active
            </p>
          )}
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
            {isNative ? 'Share My Screen' : 'Start Screen Share'}
          </button>
        ) : status === 'connected' || (isNative && isCapturing) ? (
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
