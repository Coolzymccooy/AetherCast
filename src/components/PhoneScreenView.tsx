import React, { useEffect, useRef, useState } from 'react';
import { io, Socket } from 'socket.io-client';
import SimplePeer from 'simple-peer';
import { Monitor, Wifi, WifiOff, Share2 } from 'lucide-react';
import { motion } from 'motion/react';

/**
 * PhoneScreenView — renders when `?mode=screen` is in the URL.
 * Captures the phone screen via getDisplayMedia and streams it to the Studio
 * via WebRTC (same signalling as RemoteCameraView but with screen capture).
 */
export default function PhoneScreenView() {
  const [status, setStatus] = useState<'idle' | 'requesting' | 'connecting' | 'connected' | 'error'>('idle');
  const [errorMsg, setErrorMsg] = useState('');
  const socketRef = useRef<Socket | null>(null);
  const peerRef = useRef<SimplePeer.Instance | null>(null);
  const previewRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const roomId = new URLSearchParams(window.location.search).get('room') ?? 'SLTN-1234';

  const cleanup = () => {
    streamRef.current?.getTracks().forEach(t => t.stop());
    peerRef.current?.destroy();
    socketRef.current?.disconnect();
  };

  useEffect(() => () => cleanup(), []);

  const startSharing = async () => {
    setStatus('requesting');
    setErrorMsg('');

    // getDisplayMedia is only available on desktop browsers and iOS Safari 16.4+.
    // Android Chrome does not support it at all.
    if (typeof navigator.mediaDevices?.getDisplayMedia !== 'function') {
      setStatus('error');
      setErrorMsg('Screen sharing is not supported on this device. Please use desktop Chrome, Firefox, or Safari on iOS 16.4 or later.');
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: { frameRate: { ideal: 30 }, width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false,
      });

      streamRef.current = stream;
      if (previewRef.current) {
        previewRef.current.srcObject = stream;
      }

      setStatus('connecting');

      // Use the same origin as the page — the QR code always encodes the LAN IP,
      // so io() here connects to the local server that the Studio also uses.
      const socket = io(window.location.origin);
      socketRef.current = socket;
      socket.emit('join-room', roomId);

      const iceServers = [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
      ];

      socket.on('user-joined', (peerId: string) => {
        const peer = new SimplePeer({ initiator: true, trickle: false, stream, config: { iceServers } });
        peerRef.current = peer;
        peer.on('signal', (signal) => socket.emit('signal', { to: peerId, signal, roomId }));
        peer.on('connect', () => setStatus('connected'));
        peer.on('error', (err) => { setStatus('error'); setErrorMsg(err.message); });
      });

      socket.on('signal', ({ from, signal }: { from: string; signal: SimplePeer.SignalData }) => {
        if (peerRef.current) {
          peerRef.current.signal(signal);
        } else {
          const peer = new SimplePeer({ initiator: false, trickle: false, stream, config: { iceServers } });
          peerRef.current = peer;
          peer.signal(signal);
          peer.on('signal', (s) => socket.emit('signal', { to: from, signal: s, roomId }));
          peer.on('connect', () => setStatus('connected'));
          peer.on('error', (err) => { setStatus('error'); setErrorMsg(err.message); });
        }
      });

      // If user stops screen share from the browser UI
      stream.getVideoTracks()[0]?.addEventListener('ended', () => {
        setStatus('idle');
        cleanup();
      });
    } catch (err: any) {
      setStatus('error');
      setErrorMsg(err?.message || 'Screen share was denied or not supported.');
    }
  };

  const stopSharing = () => {
    cleanup();
    setStatus('idle');
  };

  const statusColor = {
    idle: 'text-gray-400',
    requesting: 'text-yellow-400',
    connecting: 'text-yellow-400 animate-pulse',
    connected: 'text-green-400',
    error: 'text-red-400',
  }[status];

  const statusLabel = {
    idle: 'Not sharing',
    requesting: 'Requesting permission...',
    connecting: 'Connecting to Studio...',
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
          <p className="text-gray-400 text-sm mt-2">Broadcast your phone screen to the Studio.</p>
          <p className="text-[11px] text-yellow-500/80 mt-2">
            Requires desktop Chrome / Firefox, or Safari on iOS 16.4+.<br />
            Not supported on Android Chrome.
          </p>
        </div>

        {/* Status */}
        <div className={`flex items-center justify-center gap-2 text-sm font-medium ${statusColor}`}>
          {status === 'connected' ? <Wifi size={16} /> : <WifiOff size={16} />}
          <span>{statusLabel}</span>
        </div>

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
        {status === 'idle' || status === 'error' ? (
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
