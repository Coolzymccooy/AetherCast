import { useState, useEffect, useRef, useCallback } from 'react';
import { io, Socket } from 'socket.io-client';
import Peer from 'simple-peer';
import PeerJS, { MediaConnection } from 'peerjs';
import { Scene, Source, ServerLog, AudioChannel } from '../types';
import { ROOM_ID, CLOUD_URL } from '../constants';
import { hostPeerId } from '../utils/peerId';
import { getPeerEnv } from '../utils/peerEnv';
import { DEFAULT_ICE_SERVERS } from '../utils/iceServers';
import { audioEngine } from '../lib/audioEngine';

export type PeerConnectionState = 'connecting' | 'connected' | 'disconnected' | 'failed';

interface UseWebRTCOptions {
  scenes: Scene[];
  setActiveScene: (s: Scene) => void;
  setServerLogs: React.Dispatch<React.SetStateAction<ServerLog[]>>;
  setAudienceMessages: React.Dispatch<React.SetStateAction<any[]>>;
  audioChannels: AudioChannel[];
  setAudioChannels: React.Dispatch<React.SetStateAction<AudioChannel[]>>;
  setSources: React.Dispatch<React.SetStateAction<Source[]>>;
  onError?: (message: string) => void;
  onPhoneConnected?: (role: string) => void;
}

export function useWebRTC({
  scenes,
  setActiveScene,
  setServerLogs,
  setAudienceMessages,
  audioChannels,
  setAudioChannels,
  setSources,
  onError,
  onPhoneConnected,
}: UseWebRTCOptions) {
  const roomId = ROOM_ID;
  const [webcamStream, setWebcamStream] = useState<MediaStream | null>(null);
  const [screenStream, setScreenStream] = useState<MediaStream | null>(null);
  const [remoteStreams, setRemoteStreams] = useState<Map<string, MediaStream>>(new Map());
  const [isSocketConnected, setIsSocketConnected] = useState(false);
  const [isRemoteConnected, setIsRemoteConnected] = useState(false);
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [selectedVideoDevice, setSelectedVideoDevice] = useState('');
  const [selectedVideoDevice2, setSelectedVideoDevice2] = useState('');
  const [selectedAudioDevice, setSelectedAudioDevice] = useState('');
  const [peerStates, setPeerStates] = useState<Map<string, PeerConnectionState>>(new Map());

  const socketRef = useRef<Socket | null>(null);
  const hostPeerRef = useRef<PeerJS | null>(null);
  // Second socket that bridges audience messages from the cloud when running in Tauri desktop.
  // Tauri's main socket connects to localhost:3001 (no audience phones reach that).
  // Phones send messages to the cloud Socket.io — this bridge subscribes there and forwards locally.
  const audienceBridgeSocketRef = useRef<Socket | null>(null);
  const peersRef = useRef<Map<string, Peer.Instance>>(new Map());
  const iceTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  // Stable refs for callbacks used inside reconnectSocket to avoid stale closures
  // without adding them as dependencies (which would cause reconnect loops)
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;
  const onPhoneConnectedRef = useRef(onPhoneConnected);
  onPhoneConnectedRef.current = onPhoneConnected;
  // Track which peer IDs have already triggered the connect notification to avoid spam
  const notifiedPeersRef = useRef<Set<string>>(new Set());
  const setServerLogsRef = useRef(setServerLogs);
  setServerLogsRef.current = setServerLogs;
  const setAudienceMessagesRef = useRef(setAudienceMessages);
  setAudienceMessagesRef.current = setAudienceMessages;

  // --- Helper: update peer state ---
  const updatePeerState = useCallback((peerId: string, state: PeerConnectionState) => {
    setPeerStates(prev => {
      const next = new Map(prev);
      next.set(peerId, state);
      return next;
    });
  }, []);

  const removePeerState = useCallback((peerId: string) => {
    setPeerStates(prev => {
      const next = new Map(prev);
      next.delete(peerId);
      return next;
    });
    // Clear any ICE restart timers for this peer
    const timer = iceTimersRef.current.get(peerId);
    if (timer) {
      clearTimeout(timer);
      iceTimersRef.current.delete(peerId);
    }
  }, []);

  // --- Helper: attach ICE restart logic to a peer ---
  const attachIceRestartLogic = useCallback((peer: Peer.Instance, peerId: string) => {
    // simple-peer exposes the underlying RTCPeerConnection as _pc
    const pc = (peer as any)._pc as RTCPeerConnection | undefined;
    if (!pc) return;

    // Watch connectionState for 'failed' or 'disconnected'
    const handleConnectionStateChange = () => {
      const state = pc.connectionState;
      if (state === 'failed' || state === 'disconnected') {
        setServerLogs(prev => [
          { message: `Peer connection ${state}, attempting ICE restart...`, type: 'warning', id: Date.now() } as ServerLog,
          ...prev,
        ]);
        updatePeerState(peerId, state as PeerConnectionState);

        try {
          pc.restartIce();
        } catch (err) {
          console.error('ICE restart failed:', err);
        }

        // If peer doesn't recover within 10 seconds, destroy it
        const existingTimer = iceTimersRef.current.get(`${peerId}-recovery`);
        if (existingTimer) clearTimeout(existingTimer);

        const recoveryTimer = setTimeout(() => {
          if (pc.connectionState === 'failed' || pc.connectionState === 'disconnected') {
            setServerLogs(prev => [
              { message: `Peer ${peerId} did not recover after ICE restart, destroying`, type: 'error', id: Date.now() } as ServerLog,
              ...prev,
            ]);
            onError?.(`Peer connection to ${peerId} failed and could not be recovered.`);
            try { peer.destroy(); } catch { /* already destroyed */ }
            peersRef.current.delete(peerId);
            removePeerState(peerId);
            setRemoteStreams(prev => {
              const next = new Map(prev);
              next.delete(peerId);
              return next;
            });
          }
          iceTimersRef.current.delete(`${peerId}-recovery`);
        }, 10000);
        iceTimersRef.current.set(`${peerId}-recovery`, recoveryTimer);
      } else if (state === 'connected') {
        updatePeerState(peerId, 'connected');
        // Clear recovery timer if connection restored
        const existingTimer = iceTimersRef.current.get(`${peerId}-recovery`);
        if (existingTimer) {
          clearTimeout(existingTimer);
          iceTimersRef.current.delete(`${peerId}-recovery`);
        }
      }
    };

    pc.addEventListener('connectionstatechange', handleConnectionStateChange);

    // Watch iceConnectionState for 'disconnected' with 5-second timer
    const handleIceConnectionStateChange = () => {
      const iceState = pc.iceConnectionState;
      if (iceState === 'disconnected') {
        // Start a 5-second timer; if not reconnected, restart ICE
        const existingTimer = iceTimersRef.current.get(`${peerId}-ice`);
        if (existingTimer) clearTimeout(existingTimer);

        const iceTimer = setTimeout(() => {
          if (pc.iceConnectionState !== 'connected' && pc.iceConnectionState !== 'completed') {
            setServerLogs(prev => [
              { message: `Peer ${peerId} ICE disconnected for 5s, restarting ICE...`, type: 'warning', id: Date.now() } as ServerLog,
              ...prev,
            ]);
            try {
              pc.restartIce();
            } catch (err) {
              console.error('ICE restart on disconnect timeout failed:', err);
            }
          }
          iceTimersRef.current.delete(`${peerId}-ice`);
        }, 5000);
        iceTimersRef.current.set(`${peerId}-ice`, iceTimer);
      } else if (iceState === 'connected' || iceState === 'completed') {
        // Clear the 5-second timer if we reconnected
        const existingTimer = iceTimersRef.current.get(`${peerId}-ice`);
        if (existingTimer) {
          clearTimeout(existingTimer);
          iceTimersRef.current.delete(`${peerId}-ice`);
        }
      }
    };

    pc.addEventListener('iceconnectionstatechange', handleIceConnectionStateChange);
  }, [setServerLogs, updatePeerState, removePeerState, onError]);

  // --- Device Enumeration ---
  // Browsers require a getUserMedia() call before enumerateDevices() returns labels.
  // We request a temporary stream to trigger the permission prompt, enumerate, then release it.
  const refreshDevices = useCallback(async () => {
    try {
      // First, request a temporary stream to trigger permission prompt
      // This is the ONLY way to get device labels on most browsers
      let tempStream: MediaStream | null = null;
      try {
        tempStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      } catch {
        // User denied or no devices — try video-only
        try {
          tempStream = await navigator.mediaDevices.getUserMedia({ video: true });
        } catch {
          // Try audio-only
          try {
            tempStream = await navigator.mediaDevices.getUserMedia({ audio: true });
          } catch {
            // No permission at all — enumerate anyway (will get unlabeled results)
          }
        }
      }

      // Now enumerate — labels will be populated if permission was granted
      const devs = await navigator.mediaDevices.enumerateDevices();
      setDevices(devs);

      // Release the temporary stream immediately
      if (tempStream) {
        tempStream.getTracks().forEach(t => t.stop());
      }

      // Auto-select first device of each type if none selected
      const videoDevs = devs.filter(d => d.kind === 'videoinput');
      const audioDevs = devs.filter(d => d.kind === 'audioinput');

      if (videoDevs.length > 0 && !selectedVideoDevice) {
        setSelectedVideoDevice(videoDevs[0].deviceId);
      }
      if (audioDevs.length > 0 && !selectedAudioDevice) {
        setSelectedAudioDevice(audioDevs[0].deviceId);
      }

      // Listen for device changes (plugging in / unplugging cameras/mics)
      navigator.mediaDevices.ondevicechange = async () => {
        const updated = await navigator.mediaDevices.enumerateDevices();
        setDevices(updated);
      };

      return devs;
    } catch (err) {
      console.error('Error enumerating devices:', err);
      onError?.('Could not detect media devices. Check browser permissions.');
      return [];
    }
  }, [selectedVideoDevice, selectedAudioDevice, onError]);

  useEffect(() => {
    refreshDevices();
    return () => { navigator.mediaDevices.ondevicechange = null; };
  }, []);

  // --- Audio Engine Sync ---
  useEffect(() => {
    audioEngine.init();

    if (webcamStream) {
      audioEngine.addStream('Local Mic', webcamStream);
      const ch = audioChannels.find(c => c.name === 'Mic 1');
      if (ch) {
        audioEngine.setVolume('Local Mic', ch.volume);
        audioEngine.setMuted('Local Mic', ch.muted);
      }
    }
    if (screenStream) {
      audioEngine.addStream('Screen Share', screenStream);
      const ch = audioChannels.find(c => c.name === 'System');
      if (ch) {
        audioEngine.setVolume('Screen Share', ch.volume);
        audioEngine.setMuted('Screen Share', ch.muted);
      }
    }
    remoteStreams.forEach((stream, id) => {
      audioEngine.addStream(id, stream);
    });

    const currentIds = new Set(['Local Mic', 'Screen Share', ...Array.from(remoteStreams.keys())]);
    if (!webcamStream) currentIds.delete('Local Mic');
    if (!screenStream) currentIds.delete('Screen Share');

    Array.from(audioEngine.sources.keys()).forEach(id => {
      if (!currentIds.has(id)) audioEngine.removeStream(id);
    });

    setAudioChannels(prev => {
      const next = [...prev];
      remoteStreams.forEach((_, id) => {
        if (!next.find(c => c.name === id)) {
          next.push({ name: id, level: 0, volume: 1.0, peak: 0, muted: false });
        }
      });
      return next.filter(c => {
        if (['Mic 1', 'Mic 2', 'System', 'Media'].includes(c.name)) return true;
        return remoteStreams.has(c.name);
      });
    });
  }, [webcamStream, screenStream, remoteStreams]);

  // --- Audio Level Polling ---
  useEffect(() => {
    const interval = setInterval(() => {
      const levels = audioEngine.getLevels();

      setAudioChannels(prev => prev.map(c => {
        let level = 0;
        if (c.name === 'Mic 1' && levels['Local Mic']) level = levels['Local Mic'];
        else if (c.name === 'System' && levels['Screen Share']) level = levels['Screen Share'];
        else if (levels[c.name]) level = levels[c.name];
        return { ...c, level: Math.max(0, Math.min(1, level)), peak: Math.max(c.peak || 0, level) };
      }));

      setSources(prev => prev.map(s => {
        let level = 0;
        if (s.name === 'Cam 1' && levels['Local Mic']) level = levels['Local Mic'];
        else if (s.name === 'Screen Share' && levels['Screen Share']) level = levels['Screen Share'];
        else if (levels[s.name]) level = levels[s.name];
        return { ...s, audioLevel: Math.max(0, Math.min(1, level)) };
      }));
    }, 100);
    return () => clearInterval(interval);
  }, []);

  // --- Destroy all peer connections ---
  const destroyAllPeers = useCallback(() => {
    peersRef.current.forEach(peer => {
      try { peer.destroy(); } catch { /* already destroyed */ }
    });
    peersRef.current.clear();
    setPeerStates(new Map());
    // Clear all ICE timers
    iceTimersRef.current.forEach(timer => clearTimeout(timer));
    iceTimersRef.current.clear();
  }, []);

  // --- PeerJS Host (answers calls from phone camera / phone screen) ---
  const setupHostPeer = useCallback(() => {
    if (hostPeerRef.current) {
      hostPeerRef.current.destroy();
      hostPeerRef.current = null;
    }

    const hostId = hostPeerId(roomId);
    const peerEnv = getPeerEnv();
    const hostPeer = new PeerJS(hostId, {
      host: peerEnv.host,
      port: peerEnv.port,
      path: peerEnv.path,
      secure: peerEnv.secure,
      debug: 0,
      config: {
        iceServers: DEFAULT_ICE_SERVERS,
      },
    });
    hostPeerRef.current = hostPeer;

    hostPeer.on('open', () => {
      setServerLogsRef.current(prev => [
        { message: `PeerJS host ready — waiting for phone connections`, type: 'info', id: Date.now() } as ServerLog,
        ...prev,
      ]);
    });

    hostPeer.on('call', (call: MediaConnection) => {
      call.answer(); // answer without sending a stream back
      const peerId = call.peer;

      call.on('stream', (stream: MediaStream) => {
        setRemoteStreams(prev => {
          const next = new Map(prev);
          next.set(peerId, stream);
          return next;
        });
        setIsRemoteConnected(true);
        const role = call.metadata?.role ?? 'camera';
        setServerLogsRef.current(prev => [
          { message: `Phone connected: ${role} (${peerId.slice(-8)})`, type: 'info', id: Date.now() } as ServerLog,
          ...prev,
        ]);
        // Only fire notification once per peer to avoid spam on reconnects
        if (!notifiedPeersRef.current.has(peerId)) {
          notifiedPeersRef.current.add(peerId);
          onPhoneConnectedRef.current?.(role);
        }
      });

      call.on('close', () => {
        setRemoteStreams(prev => {
          const next = new Map(prev);
          next.delete(peerId);
          return next;
        });
        // Clear notification guard on disconnect so genuine reconnects notify again
        notifiedPeersRef.current.delete(peerId);
      });

      call.on('error', (err: Error) => {
        console.error('PeerJS call error:', err);
      });
    });

    hostPeer.on('disconnected', () => {
      try { (hostPeer as any).reconnect?.(); } catch { /* ok */ }
    });

    hostPeer.on('error', (err: any) => {
      // unavailable-id means another Studio instance already has this ID — retry after a delay
      if (err.type === 'unavailable-id') {
        setTimeout(setupHostPeer, 5000);
      } else {
        setServerLogsRef.current(prev => [
          { message: `PeerJS error: ${err.type || err.message}`, type: 'error', id: Date.now() } as ServerLog,
          ...prev,
        ]);
      }
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps -- Intentionally stable
  }, []);

  // --- Socket Signaling ---
  const reconnectSocket = useCallback(() => {
    // Clean up previous peers before reconnecting
    destroyAllPeers();

    if (socketRef.current) socketRef.current.disconnect();

    // In Tauri desktop mode, connect to the production server for signaling
    // In browser mode, connect to same origin (default)
    // Connect to the server:
    // - In browser: same origin (default)
    // - In Tauri dev: localhost:3001 (the local dev server)
    // - In Tauri production: the production URL
    let serverUrl: string | undefined = undefined;

    if (window.__TAURI_INTERNALS__) {
      // tauri.localhost is the hostname in production Tauri builds (not just dev)
      const isLocal = ['localhost', '127.0.0.1', 'tauri.localhost'].includes(window.location.hostname);
      serverUrl = isLocal ? 'http://localhost:3001' : CLOUD_URL;
    }

    // Audience bridge: when Tauri connects to localhost, audience phones reach the cloud.
    // Open a second connection to the cloud to relay those audience messages into Studio.
    if (audienceBridgeSocketRef.current) {
      audienceBridgeSocketRef.current.disconnect();
      audienceBridgeSocketRef.current = null;
    }
    if (serverUrl === 'http://localhost:3001') {
      const bridge = io(CLOUD_URL, { reconnection: true, reconnectionAttempts: Infinity, reconnectionDelay: 3000 });
      audienceBridgeSocketRef.current = bridge;
      bridge.on('connect', () => {
        bridge.emit('join-room', roomId);
      });
      bridge.on('audience-message', (message: any) => {
        setAudienceMessagesRef.current(prev => [message, ...prev].slice(0, 50));
      });
    }

    const socket = io(serverUrl, {
      reconnection: true,
      reconnectionAttempts: 10,
      reconnectionDelay: 2000,
      timeout: 10000,
    });
    socketRef.current = socket;

    socket.on('connect', () => {
      setIsSocketConnected(true);
      socket.emit('join-room', roomId);
    });
    socket.on('disconnect', () => {
      setIsSocketConnected(false);
      // Clean up peers on disconnect to prevent stale references
      destroyAllPeers();
    });

    socket.on('signal', (data: { from: string; signal: any }) => {
      // Destroy existing peer for this remote user to prevent duplicates
      const existingPeer = peersRef.current.get(data.from);
      if (existingPeer) {
        try { existingPeer.destroy(); } catch { /* ok */ }
        peersRef.current.delete(data.from);
        removePeerState(data.from);
      }

      const peer = new Peer({ initiator: false, trickle: false });
      peersRef.current.set(data.from, peer);
      updatePeerState(data.from, 'connecting');

      peer.on('signal', (signal) => {
        socket.emit('signal', { roomId, signal, to: data.from });
      });
      peer.on('stream', (stream) => {
        setRemoteStreams(prev => {
          const next = new Map(prev);
          next.set(data.from, stream);
          return next;
        });
        setIsRemoteConnected(true);
        updatePeerState(data.from, 'connected');
      });
      peer.on('connect', () => {
        updatePeerState(data.from, 'connected');
        // Attach ICE restart logic once the peer connection is established
        attachIceRestartLogic(peer, data.from);
      });
      peer.on('error', (err) => {
        console.error('Studio: Peer error:', err);
        onErrorRef.current?.(`WebRTC peer error: ${err.message}`);
        peersRef.current.delete(data.from);
        updatePeerState(data.from, 'failed');
      });
      peer.on('close', () => {
        peersRef.current.delete(data.from);
        removePeerState(data.from);
        setRemoteStreams(prev => {
          const next = new Map(prev);
          next.delete(data.from);
          return next;
        });
      });
      peer.signal(data.signal);
    });

    socket.on('server-log', (log: Omit<ServerLog, 'id'>) => {
      setServerLogsRef.current(prev => [{ ...log, id: Date.now() + Math.random() } as ServerLog, ...prev].slice(0, 20));
    });

    socket.on('audience-message', (message: any) => {
      setAudienceMessagesRef.current(prev => [message, ...prev].slice(0, 50));
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps -- Intentionally stable: reconnectSocket should only run on mount.
  // All callbacks inside use refs or are stable (setX dispatchers). Including them as deps
  // would cause an infinite connect/disconnect loop because onError and attachIceRestartLogic
  // change identity on every render.
  }, []);

  useEffect(() => {
    reconnectSocket();
    setupHostPeer();
    return () => {
      destroyAllPeers();
      if (socketRef.current) socketRef.current.disconnect();
      if (audienceBridgeSocketRef.current) audienceBridgeSocketRef.current.disconnect();
      if (hostPeerRef.current) { hostPeerRef.current.destroy(); hostPeerRef.current = null; }
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps -- Must only run once on mount
  }, []);

  // --- Camera ---
  const startCamera = async (videoId?: string, audioId?: string, videoId2?: string) => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: videoId ? { deviceId: { exact: videoId }, width: 1920, height: 1080 } : { width: 1920, height: 1080 },
        audio: audioId ? { deviceId: { exact: audioId } } : true,
      });
      setWebcamStream(stream);

      if (videoId2) {
        const stream2 = await navigator.mediaDevices.getUserMedia({
          video: { deviceId: { exact: videoId2 }, width: 1920, height: 1080 },
        });
        setRemoteStreams(prev => { const next = new Map(prev); next.set('local-cam-2', stream2); return next; });
      }

      setSources(prev => prev.map(s => s.name === 'Cam 1' ? { ...s, status: 'active' as const } : s));
    } catch (err: any) {
      console.error('App: Error accessing camera:', err);
      if (err?.name === 'NotAllowedError') {
        onError?.('Camera permission denied. Please allow camera access in your browser settings.');
      } else if (err?.name === 'NotFoundError') {
        onError?.('No camera found. Please connect a camera and try again.');
      } else {
        onError?.(`Camera error: ${err?.message || 'Unknown error'}`);
      }
    }
  };

  const stopCamera = () => {
    if (webcamStream) {
      webcamStream.getTracks().forEach(t => t.stop());
      setWebcamStream(null);
      setSources(prev => prev.map(s => s.name === 'Cam 1' ? { ...s, status: 'standby' as const } : s));
    }
    // Also stop second local camera if active
    const cam2 = remoteStreams.get('local-cam-2');
    if (cam2) {
      cam2.getTracks().forEach(t => t.stop());
      setRemoteStreams(prev => {
        const next = new Map(prev);
        next.delete('local-cam-2');
        return next;
      });
    }
  };

  const startScreenShare = async () => {
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({ video: { cursor: 'always' } as any, audio: true });
      setScreenStream(stream);
      setSources(prev => prev.map(s => s.name === 'Screen Share' ? { ...s, status: 'active' as const } : s));

      const screenScene = scenes.find(s => s.type === 'SCREEN');
      if (screenScene) setActiveScene(screenScene);

      stream.getVideoTracks()[0].onended = () => {
        setScreenStream(null);
        setSources(prev => prev.map(s => s.name === 'Screen Share' ? { ...s, status: 'standby' as const } : s));
      };
    } catch (err: any) {
      console.error('App: Error starting screen share:', err);
      if (err?.name === 'NotAllowedError') {
        onError?.('Screen share was cancelled or denied.');
      } else {
        onError?.(`Screen share error: ${err?.message || 'Unknown error'}`);
      }
    }
  };

  return {
    webcamStream,
    screenStream,
    remoteStreams,
    isSocketConnected,
    isRemoteConnected,
    setIsRemoteConnected,
    devices,
    selectedVideoDevice, setSelectedVideoDevice,
    selectedVideoDevice2, setSelectedVideoDevice2,
    selectedAudioDevice, setSelectedAudioDevice,
    socketRef,
    reconnectSocket,
    startCamera,
    stopCamera,
    startScreenShare,
    refreshDevices,
    peerStates,
  };
}
