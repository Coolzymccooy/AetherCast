import React, { useEffect, useState } from 'react';
import { X, Smartphone, ExternalLink, Copy, Monitor, Users, CheckCircle, Download } from 'lucide-react';
import { motion } from 'motion/react';
import { QRCodeSVG } from 'qrcode.react';
import { QrMode } from '../../types';
import { CLOUD_URL } from '../../constants';
import { buildPeerQueryParams } from '../../utils/peerEnv';

interface QrModalProps {
  qrMode: QrMode;
  setQrMode: (m: QrMode) => void;
  onClose: () => void;
}

type PhoneMode = 'camera' | 'screen' | 'audience';

const MODE_CONFIG: Record<PhoneMode, { label: string; description: string; icon: React.ReactNode; color: string; urlMode: string }> = {
  camera: {
    label: 'Phone Camera',
    description: 'Use your phone as a wireless camera source.',
    icon: <Smartphone size={20} />,
    color: 'accent-cyan',
    urlMode: 'remote',
  },
  screen: {
    label: 'Phone Screen',
    description: 'Share your phone screen live into the Studio.',
    icon: <Monitor size={20} />,
    color: 'blue-400',
    urlMode: 'screen',
  },
  audience: {
    label: 'Audience Portal',
    description: 'Send messages and reactions to the Studio.',
    icon: <Users size={20} />,
    color: 'orange-400',
    urlMode: 'audience',
  },
};

export const QrModal: React.FC<QrModalProps> = ({ qrMode, setQrMode, onClose }) => {
  const [activeMode, setActiveMode] = useState<PhoneMode>(
    qrMode === 'camera' ? 'camera' : 'audience'
  );
  const [lanUrl, setLanUrl] = useState<string>('');
  const [publicUrl, setPublicUrl] = useState<string>('');
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    fetch('/api/local-ip')
      .then(r => r.json())
      .then(({ ip, port, lanUrl: lan, publicUrl: pub }: { ip: string; port: number; lanUrl?: string; publicUrl?: string | null }) => {
        setLanUrl(lan ?? `http://${ip}:${port}`);
        setPublicUrl(pub ?? '');
      })
      .catch(() => {
        // If server unreachable (e.g. Tauri production), fall back to origin
        setLanUrl(window.location.origin);
      });
  }, []);

  const isTauri = !!(window as any).__TAURI_INTERNALS__;
  const cfg = MODE_CONFIG[activeMode];

  // Camera: phone must load the React app from a reachable URL.
  //   - publicUrl set (cloud deploy) → use it (phones anywhere can connect)
  //   - Tauri desktop → publicUrl or CLOUD_URL (tauri.localhost unreachable)
  //   - Local browser → LAN IP (http://10.x.x.x:3001, reachable on same WiFi)
  // Screen Share: getDisplayMedia requires a secure context (HTTPS) — always use cloud URL.
  // Audience Portal uses Socket.io → needs cloud server URL.
  const cameraBase = publicUrl || (isTauri ? CLOUD_URL : (lanUrl || window.location.origin));
  const screenBase = publicUrl || CLOUD_URL;
  const audienceBase = isTauri ? (publicUrl || CLOUD_URL) : window.location.origin;
  const baseUrl = activeMode === 'audience' ? audienceBase : activeMode === 'screen' ? screenBase : cameraBase;
  const peerParams = activeMode !== 'audience' ? buildPeerQueryParams() : '';
  const appUrl = `${baseUrl}?mode=${cfg.urlMode}&room=SLTN-1234${peerParams ? `&${peerParams}` : ''}`;

  const handleCopy = () => {
    if (!appUrl) return;
    navigator.clipboard.writeText(appUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleModeChange = (m: PhoneMode) => {
    setActiveMode(m);
    setQrMode(m === 'audience' ? 'audience' : 'camera');
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm"
      onClick={onClose}
    >
      <motion.div
        initial={{ scale: 0.9, y: 20 }}
        animate={{ scale: 1, y: 0 }}
        exit={{ scale: 0.9, y: 20 }}
        className="bg-gray-900 border border-border rounded-xl p-8 max-w-2xl w-full shadow-2xl relative"
        onClick={e => e.stopPropagation()}
      >
        <button
          onClick={onClose}
          className="absolute top-4 right-4 text-gray-400 hover:text-white transition-colors"
        >
          <X size={20} />
        </button>

        <div className="flex flex-col items-center mb-6">
          <div className="w-16 h-16 bg-accent-cyan/10 rounded-full flex items-center justify-center mb-4 border border-accent-cyan/30">
            <Smartphone size={32} className="text-accent-cyan" />
          </div>
          <h2 className="text-xl font-bold text-white mb-2">Connect Your Phone</h2>
          <p className="text-sm text-gray-400 text-center max-w-md">
            Scan the QR code below — works on any network.
          </p>
        </div>

        {/* Mode selector */}
        <div className="flex bg-black/40 rounded-full p-1 border border-border mb-8 w-fit mx-auto gap-1">
          {(Object.keys(MODE_CONFIG) as PhoneMode[]).map(m => (
            <button
              key={m}
              onClick={() => handleModeChange(m)}
              className={`px-4 py-1.5 rounded-full text-xs font-bold transition-colors flex items-center gap-1.5 ${
                activeMode === m
                  ? m === 'audience'
                    ? 'bg-orange-500 text-white'
                    : m === 'screen'
                    ? 'bg-blue-500 text-white'
                    : 'bg-accent-cyan text-bg'
                  : 'text-gray-400 hover:text-white'
              }`}
            >
              {MODE_CONFIG[m].icon}
              {MODE_CONFIG[m].label}
            </button>
          ))}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
          {/* QR Code */}
          <div className="flex flex-col items-center border-r border-border pr-8">
            <h3 className="text-xs font-bold uppercase tracking-wider text-gray-400 mb-4">Scan QR Code</h3>
            <div className="bg-white p-4 rounded-lg inline-block mb-4">
              {appUrl ? (
                <QRCodeSVG
                  value={appUrl}
                  size={192}
                  bgColor="#ffffff"
                  fgColor="#000000"
                  level="M"
                />
              ) : (
                <div className="w-48 h-48 bg-gray-100 flex items-center justify-center text-gray-400 text-xs">
                  Loading...
                </div>
              )}
            </div>

            <div className="w-full">
              <label className="text-[10px] font-bold uppercase tracking-wider text-gray-500 mb-1 block">URL</label>
              <input
                type="text"
                readOnly
                value={appUrl}
                className="w-full bg-black/40 border border-border rounded px-3 py-2 text-xs text-gray-300 mb-2 truncate"
              />
              <div className="flex gap-2">
                <button
                  onClick={handleCopy}
                  disabled={!appUrl}
                  className="flex-1 px-3 py-2 bg-transparent border border-border hover:bg-white/5 rounded text-xs font-bold transition-colors flex items-center justify-center gap-1 disabled:opacity-50"
                >
                  {copied ? <CheckCircle size={12} className="text-green-400" /> : <Copy size={12} />}
                  {copied ? 'Copied!' : 'Copy Link'}
                </button>
                <button
                  onClick={() => appUrl && window.open(appUrl, '_blank')}
                  disabled={!appUrl}
                  className={`flex-1 px-3 py-2 rounded text-xs font-bold transition-colors flex items-center justify-center gap-1 disabled:opacity-50 ${
                    activeMode === 'audience'
                      ? 'bg-gradient-to-r from-orange-400 to-orange-600 text-white'
                      : activeMode === 'screen'
                      ? 'bg-gradient-to-r from-blue-400 to-blue-600 text-white'
                      : 'bg-gradient-to-r from-accent-cyan to-blue-500 text-white'
                  }`}
                >
                  <ExternalLink size={12} /> Test in Browser
                </button>
              </div>
            </div>
          </div>

          {/* Instructions */}
          <div className="flex flex-col">
            <h3 className="text-xs font-bold uppercase tracking-wider text-gray-400 mb-4">
              {cfg.label} Instructions
            </h3>
            <p className="text-sm text-gray-300 mb-4">{cfg.description}</p>

            <ol className="text-xs text-gray-400 space-y-3 mb-6 list-decimal list-inside">
              <li>Open your phone camera and scan the QR code.</li>
              {activeMode === 'camera' && <li>Tap <strong className="text-white">Allow</strong> when asked for camera access.</li>}
              {activeMode === 'screen' && <li>Tap <strong className="text-white">Share Screen</strong> and select what to share.</li>}
              {activeMode === 'audience' && <li>Type your message and tap <strong className="text-white">Submit</strong>.</li>}
              <li>The studio will connect automatically.</li>
            </ol>

            <div className="bg-black/40 border border-border rounded-xl p-4 text-center">
              <span className="text-[10px] font-bold uppercase tracking-widest text-gray-500 block mb-2">Room Code</span>
              <span className="text-2xl font-mono font-bold tracking-[0.3em] text-white">SLTN-1234</span>
            </div>

            {/* APK download strip */}
            <div className="mt-4 flex items-center justify-between gap-3 bg-blue-500/5 border border-blue-500/20 rounded-xl px-4 py-3">
              <div className="min-w-0">
                <p className="text-[11px] font-semibold text-blue-300">Android app required for screen share</p>
                <p className="text-[10px] text-gray-500 mt-0.5">Camera &amp; audience work in any browser</p>
              </div>
              <a
                href="/downloads/aethercast-camera.apk"
                download
                className="shrink-0 flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold rounded-lg transition-colors"
              >
                <Download size={12} /> APK
              </a>
            </div>
          </div>
        </div>
      </motion.div>
    </motion.div>
  );
};
