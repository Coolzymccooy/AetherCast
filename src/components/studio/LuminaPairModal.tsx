import React, { useCallback, useEffect, useRef, useState } from 'react';
import { X, Copy, Check, RefreshCw, Link, Wifi, WifiOff } from 'lucide-react';
import { motion } from 'motion/react';
import { getRoomIdFromSearch, isValidRoomId } from '../../utils/roomId';
import { CLOUD_URL } from '../../constants';

interface LuminaPairModalProps {
  onClose: () => void;
}

const UNAMBIGUOUS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function generateRoomCode(): string {
  const pick = () => UNAMBIGUOUS[Math.floor(Math.random() * UNAMBIGUOUS.length)];
  return `${pick()}${pick()}${pick()}${pick()}-${pick()}${pick()}${pick()}${pick()}`;
}

function buildPairingUrl(baseUrl: string, roomId: string): string {
  return `${baseUrl.replace(/\/+$/, '')}/api/lumina/bridge?room=${roomId}`;
}

export const LuminaPairModal: React.FC<LuminaPairModalProps> = ({ onClose }) => {
  const [roomId, setRoomId] = useState(() => getRoomIdFromSearch());
  const [baseUrl, setBaseUrl] = useState('');
  const [connected, setConnected] = useState(false);
  const [lastSeenMs, setLastSeenMs] = useState<number | null>(null);
  const [copied, setCopied] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // In Tauri production the webview origin is http://tauri.localhost — no local server
  // is reachable, so always use the cloud URL for both the pairing link and API calls.
  const isTauri = !!(window as any).__TAURI_INTERNALS__;
  const apiBase = isTauri ? CLOUD_URL : '';

  // Resolve base URL from server (same logic as QrModal)
  useEffect(() => {
    if (isTauri) {
      setBaseUrl(CLOUD_URL);
      return;
    }
    fetch('/api/local-ip')
      .then(r => r.json())
      .then(({ lanUrl, publicUrl }: { lanUrl?: string; publicUrl?: string | null }) => {
        setBaseUrl(publicUrl || lanUrl || window.location.origin);
      })
      .catch(() => setBaseUrl(window.location.origin));
  }, [isTauri]);

  // Poll Lumina connection status every 5 s
  const pollStatus = useCallback(() => {
    if (!roomId) return;
    fetch(`${apiBase}/api/lumina/rooms/${encodeURIComponent(roomId)}/status`)
      .then(r => r.json())
      .then(({ connected: c, lastSeenMs: ts }: { connected: boolean; lastSeenMs: number | null }) => {
        setConnected(c);
        setLastSeenMs(ts);
      })
      .catch(() => {/* ignore */});
  }, [roomId, apiBase]);

  useEffect(() => {
    pollStatus();
    pollRef.current = setInterval(pollStatus, 5_000);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [pollStatus]);

  const pairingUrl = baseUrl ? buildPairingUrl(baseUrl, roomId) : '';

  const handleCopy = () => {
    if (!pairingUrl) return;
    navigator.clipboard.writeText(pairingUrl).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  const handleNewRoom = () => {
    const code = generateRoomCode();
    // Navigate to new room — this reloads the page with ?room=CODE
    const url = new URL(window.location.href);
    url.searchParams.set('room', code);
    window.location.href = url.toString();
  };

  const timeSince = lastSeenMs
    ? Math.round((Date.now() - lastSeenMs) / 1000)
    : null;

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <motion.div
        initial={{ scale: 0.95, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.95, opacity: 0 }}
        transition={{ type: 'spring', stiffness: 300, damping: 25 }}
        className="w-full max-w-md bg-[#0d0d0d] border border-white/10 rounded-2xl shadow-2xl overflow-hidden"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/10">
          <div className="flex items-center gap-2.5">
            <Link size={15} className="text-cyan-400" />
            <span className="text-[13px] font-bold uppercase tracking-[0.15em] text-white">
              Lumina Pair
            </span>
          </div>
          <button onClick={onClose} className="p-1 rounded-lg hover:bg-white/10 text-zinc-400 hover:text-white transition-colors">
            <X size={16} />
          </button>
        </div>

        <div className="p-5 space-y-5">
          {/* Connection status */}
          <div className={`flex items-center gap-3 px-4 py-3 rounded-xl border ${
            connected
              ? 'border-emerald-600/40 bg-emerald-950/30'
              : 'border-zinc-700/50 bg-zinc-900/40'
          }`}>
            {connected
              ? <Wifi size={16} className="text-emerald-400 flex-shrink-0" />
              : <WifiOff size={16} className="text-zinc-500 flex-shrink-0" />
            }
            <div className="flex-1 min-w-0">
              <p className={`text-[12px] font-semibold ${connected ? 'text-emerald-300' : 'text-zinc-400'}`}>
                {connected ? 'Lumina is connected' : 'Waiting for Lumina...'}
              </p>
              {lastSeenMs && timeSince !== null && (
                <p className="text-[10px] text-zinc-500 mt-0.5">
                  Last seen {timeSince < 5 ? 'just now' : `${timeSince}s ago`}
                </p>
              )}
            </div>
            {connected && (
              <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse flex-shrink-0" />
            )}
          </div>

          {/* Room code */}
          <div className="space-y-2">
            <label className="text-[10px] uppercase tracking-widest text-zinc-500 font-semibold">
              Your Room Code
            </label>
            <div className="flex items-center gap-2">
              <div className="flex-1 px-3 py-2.5 rounded-lg border border-zinc-700 bg-black/50 font-mono text-[18px] font-bold tracking-[0.25em] text-cyan-300 text-center">
                {roomId}
              </div>
              <button
                onClick={handleNewRoom}
                title="Generate new room (opens new URL)"
                className="p-2.5 rounded-lg border border-zinc-700 bg-zinc-900 hover:border-zinc-500 hover:bg-zinc-800 text-zinc-400 hover:text-white transition-colors"
              >
                <RefreshCw size={14} />
              </button>
            </div>
            <p className="text-[10px] text-zinc-500 leading-relaxed">
              Aether joins this room automatically when you open{' '}
              <span className="text-zinc-400 font-mono">?room={roomId}</span> in the URL.
              Tap refresh to generate a new code.
            </p>
          </div>

          {/* Pairing URL */}
          <div className="space-y-2">
            <label className="text-[10px] uppercase tracking-widest text-zinc-500 font-semibold">
              Paste this into Lumina › Connect › Aether › Bridge URL
            </label>
            <div className="flex items-center gap-2">
              <div className="flex-1 px-3 py-2 rounded-lg border border-zinc-700 bg-black/50 text-[11px] font-mono text-zinc-300 break-all min-h-[38px] flex items-center">
                {pairingUrl || <span className="text-zinc-600">Loading…</span>}
              </div>
              <button
                onClick={handleCopy}
                disabled={!pairingUrl}
                className={`flex items-center gap-1.5 px-3 py-2 rounded-lg border text-[11px] font-semibold transition-all flex-shrink-0 ${
                  copied
                    ? 'border-emerald-600 bg-emerald-950 text-emerald-300'
                    : 'border-zinc-700 bg-zinc-900 hover:border-cyan-600 hover:bg-cyan-950/30 hover:text-cyan-300 text-zinc-300 disabled:opacity-40'
                }`}
              >
                {copied ? <Check size={13} /> : <Copy size={13} />}
                {copied ? 'Copied' : 'Copy'}
              </button>
            </div>
          </div>

          {/* Instructions */}
          <div className="rounded-xl border border-zinc-800 bg-zinc-900/30 p-4 space-y-2">
            <p className="text-[10px] uppercase tracking-widest text-zinc-500 font-semibold">How to pair</p>
            <ol className="space-y-1.5 text-[11px] text-zinc-400 list-none">
              {[
                'Click Copy above',
                'In Lumina → Connect modal → Aether tab → Bridge URL field',
                'Paste the URL — room is detected automatically',
                'Click Ping Bridge — this indicator turns green',
              ].map((step, i) => (
                <li key={i} className="flex items-start gap-2.5">
                  <span className="flex-shrink-0 w-4 h-4 rounded-full bg-zinc-800 border border-zinc-700 text-[9px] font-bold text-zinc-400 flex items-center justify-center mt-0.5">
                    {i + 1}
                  </span>
                  <span>{step}</span>
                </li>
              ))}
            </ol>
          </div>
        </div>
      </motion.div>
    </motion.div>
  );
};
