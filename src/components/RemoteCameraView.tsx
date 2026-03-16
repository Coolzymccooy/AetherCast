import React, { useEffect, useRef, useState } from 'react';
import { io, Socket } from 'socket.io-client';
import SimplePeer from 'simple-peer';
import { Camera, Wifi, WifiOff, Mic, MicOff, Sun, Moon } from 'lucide-react';
import { motion } from 'motion/react';

/**
 * RemoteCameraView — renders when `?mode=remote` is in the URL.
 * Connects via WebRTC as a remote camera source for the Studio.
 */
export default function RemoteCameraView() {
  const [status, setStatus] = useState<'idle' | 'connecting' | 'connected' | 'error'>('idle');
  const [isMuted, setIsMuted] = useState(false);
  const [facingMode, setFacingMode] = useState<'user' | 'environment'>('user');
  const socketRef = useRef<Socket | null>(null);
  const peerRef = useRef<SimplePeer.Instance | null>(null);
  const localVideoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const roomId = new URLSearchParams(window.location.search).get('room') ?? 'SLTN-1234';

  useEffect(() => {
    startCamera();
    return () => cleanup();
  }, []);

  const startCamera = async () => {
    try {
      setStatus('connecting');
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode, width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: true,
      });
      streamRef.current = stream;
      if (localVideoRef.current) {
        localVideoRef.current.srcObject = stream;
      }

      const socket = io();
      socketRef.current = socket;
      socket.emit('join-room', roomId);

      socket.on('user-joined', (peerId: string) => {
        const peer = new SimplePeer({ initiator: true, trickle: false, stream });
        peerRef.current = peer;

        peer.on('signal', (signal) => {
          socket.emit('signal', { to: peerId, signal, roomId });
        });

        peer.on('connect', () => setStatus('connected'));
        peer.on('error', () => setStatus('error'));
      });

      socket.on('signal', ({ from, signal }: { from: string; signal: SimplePeer.SignalData }) => {
        if (peerRef.current) {
          peerRef.current.signal(signal);
        } else {
          const peer = new SimplePeer({ initiator: false, trickle: false, stream });
          peerRef.current = peer;
          peer.signal(signal);

          peer.on('signal', (s) => socket.emit('signal', { to: from, signal: s, roomId }));
          peer.on('connect', () => setStatus('connected'));
          peer.on('error', () => setStatus('error'));
        }
      });
    } catch (err) {
      console.error('Camera access failed:', err);
      setStatus('error');
    }
  };

  const cleanup = () => {
    streamRef.current?.getTracks().forEach(t => t.stop());
    peerRef.current?.destroy();
    socketRef.current?.disconnect();
  };

  const toggleMute = () => {
    if (!streamRef.current) return;
    streamRef.current.getAudioTracks().forEach(t => (t.enabled = isMuted));
    setIsMuted(!isMuted);
  };

  const flipCamera = async () => {
    const newMode = facingMode === 'user' ? 'environment' : 'user';
    setFacingMode(newMode);
    streamRef.current?.getTracks().forEach(t => t.stop());
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: newMode },
        audio: true,
      });
      streamRef.current = stream;
      if (localVideoRef.current) localVideoRef.current.srcObject = stream;
      peerRef.current?.['_pc']?.getSenders()?.forEach((sender: RTCRtpSender) => {
        const track = stream.getTracks().find(t => t.kind === sender.track?.kind);
        if (track) sender.replaceTrack(track);
      });
    } catch (err) {
      console.error('Camera flip failed:', err);
    }
  };

  const statusLabel = {
    idle: 'Initializing...',
    connecting: 'Connecting to Studio...',
    connected: 'Live — Studio Connected',
    error: 'Connection failed',
  }[status];

  return (
    <div className="h-screen bg-black flex flex-col items-center justify-center text-white">
      {/* Viewfinder */}
      <div className="relative w-full max-w-sm aspect-[9/16] bg-gray-900 rounded-2xl overflow-hidden shadow-2xl border border-white/10">
        <video
          ref={localVideoRef}
          autoPlay
          muted
          playsInline
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
                ? 'bg-accent-red/80 border-accent-red/50 text-white'
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

        {/* Room ID */}
        <div className="absolute bottom-20 left-0 right-0 text-center">
          <p className="text-[10px] text-white/40 font-mono uppercase tracking-widest">Room: {roomId}</p>
        </div>

        {/* Controls overlay */}
        <div className="absolute bottom-6 left-0 right-0 flex justify-center gap-6">
          <button
            onClick={toggleMute}
            className={`w-14 h-14 rounded-full flex items-center justify-center border-2 backdrop-blur-md transition-colors ${
              isMuted ? 'bg-accent-red/80 border-accent-red' : 'bg-black/60 border-white/30 hover:bg-white/20'
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

      {/* Instructions */}
      <p className="mt-6 text-xs text-gray-500 text-center max-w-xs leading-relaxed">
        Your phone is now broadcasting to Aether Studio.<br />
        Keep this screen open to stay connected.
      </p>

      {status === 'error' && (
        <button
          onClick={() => { cleanup(); startCamera(); }}
          className="mt-4 px-6 py-2 bg-accent-cyan text-black text-xs font-bold rounded-full hover:bg-cyan-400 transition-colors"
        >
          Retry Connection
        </button>
      )}
    </div>
  );
}
