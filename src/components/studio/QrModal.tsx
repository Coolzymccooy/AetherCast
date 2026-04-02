import React, { useEffect, useState } from 'react';
import { X, Smartphone, ExternalLink, Copy, Monitor, Users, CheckCircle } from 'lucide-react';
import { motion } from 'motion/react';
import { QRCodeSVG } from 'qrcode.react';
import { QrMode } from '../../types';
import { CLOUD_URL } from '../../constants';

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

  // Fetch LAN IP and optional public URL from server.
  // Camera/screen modes MUST use LAN IP — WebRTC signalling requires phone and
  // Studio to reach the same Socket.io server (always localhost:3001).
  // Only the Audience Portal (pure HTTP) can use the cloud public URL.
  useEffect(() => {
    fetch('/api/local-ip')
      .then(r => r.json())
      .then(({ ip, port, lanUrl: lan, publicUrl: pub }: { ip: string; port: number; lanUrl?: string; publicUrl?: string | null }) => {
        setLanUrl(lan ?? `http://${ip}:${port}`);
        setPublicUrl(pub ?? '');
      })
      .catch(() => {
        setLanUrl(window.location.origin);
      });
  }, []);

  const isTauri = !!(window as any).__TAURI_INTERNALS__;
  // localhost / 127.0.0.1 means the user is running the dev server locally in a browser;
  // phones can't reach "localhost" so we use the LAN IP instead.
  const isLocalhost = ['localhost', '127.0.0.1'].includes(window.location.hostname);
  const cfg = MODE_CONFIG[activeMode];

  // Pick the right base URL for camera/screen (WebRTC modes):
  //   Tauri desktop or browser-at-localhost → LAN IP  (server is on this machine)
  //   Browser at cloud URL                  → same origin (server is the cloud host)
  // Audience:
  //   Tauri → cloud URL  (bridge socket relays from cloud to local Studio)
  //   browser → publicUrl if available, else LAN
  const webrtcBase = (isTauri || isLocalhost) ? lanUrl : window.location.origin;
  const audienceBase = isTauri ? (publicUrl || CLOUD_URL) : (publicUrl || lanUrl);
  const baseUrl = activeMode === 'audience' ? audienceBase : webrtcBase;
  const appUrl = baseUrl ? `${baseUrl}?mode=${cfg.urlMode}&room=SLTN-1234` : '';

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
            Make sure your phone is on the same Wi-Fi network, then scan the code below.
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
              <li>Connect your phone to the <strong className="text-white">same Wi-Fi</strong> as this computer.</li>
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
          </div>
        </div>
      </motion.div>
    </motion.div>
  );
};
