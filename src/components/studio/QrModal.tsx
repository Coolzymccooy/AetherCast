import React from 'react';
import { X, Smartphone, ExternalLink, Copy } from 'lucide-react';
import { motion } from 'motion/react';
import { QrMode } from '../../types';

interface QrModalProps {
  qrMode: QrMode;
  setQrMode: (m: QrMode) => void;
  onClose: () => void;
}

export const QrModal: React.FC<QrModalProps> = ({ qrMode, setQrMode, onClose }) => {
  const appUrl = (mode: 'remote' | 'audience') =>
    `${window.location.origin}?mode=${mode}&room=SLTN-1234`;

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
        <button onClick={onClose} className="absolute top-4 right-4 text-gray-400 hover:text-white transition-colors">
          <X size={20} />
        </button>

        <div className="flex flex-col items-center mb-6">
          <div className="w-16 h-16 bg-accent-cyan/10 rounded-full flex items-center justify-center mb-4 border border-accent-cyan/30">
            <Smartphone size={32} className="text-accent-cyan" />
          </div>
          <h2 className="text-xl font-bold text-white mb-2">
            {qrMode === 'camera' ? 'Connect Mobile Camera' : 'Audience Message Portal'}
          </h2>
          <p className="text-sm text-gray-400 mb-4 text-center max-w-md">
            {qrMode === 'camera'
              ? 'Scan this code to link your phone wirelessly.'
              : 'Scan this code to send messages to the Studio.'}
          </p>

          <div className="flex bg-black/40 rounded-full p-1 border border-border">
            <button
              onClick={() => setQrMode('camera')}
              className={`px-4 py-1.5 rounded-full text-xs font-bold transition-colors ${qrMode === 'camera' ? 'bg-accent-cyan text-bg' : 'text-gray-400 hover:text-white'}`}
            >
              Camera Mode
            </button>
            <button
              onClick={() => setQrMode('audience')}
              className={`px-4 py-1.5 rounded-full text-xs font-bold transition-colors ${qrMode === 'audience' ? 'bg-orange-500 text-white' : 'text-gray-400 hover:text-white'}`}
            >
              Audience Mode
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
          <div className="flex flex-col items-center border-r border-border pr-8">
            <h3 className="text-xs font-bold uppercase tracking-wider text-gray-400 mb-4">Option 1: Scan QR</h3>
            {/* Placeholder QR — a real impl would use qrcode.react */}
            <div className="bg-white p-4 rounded-lg inline-block mb-6">
              <div className="w-48 h-48 bg-gray-200 border-4 border-white flex items-center justify-center relative overflow-hidden">
                <div className="absolute top-0 left-0 w-8 h-8 border-t-4 border-l-4 border-black m-2" />
                <div className="absolute top-0 right-0 w-8 h-8 border-t-4 border-r-4 border-black m-2" />
                <div className="absolute bottom-0 left-0 w-8 h-8 border-b-4 border-l-4 border-black m-2" />
                <span className="relative z-10 text-xs font-bold text-black bg-white/80 px-2 py-1 rounded">QR CODE</span>
              </div>
            </div>

            <div className="w-full">
              <label className="text-[10px] font-bold uppercase tracking-wider text-gray-500 mb-1 block text-left">APP URL</label>
              <input
                type="text"
                readOnly
                value={appUrl(qrMode === 'camera' ? 'remote' : 'audience')}
                className="w-full bg-black/40 border border-border rounded px-3 py-2 text-xs text-gray-300 mb-2"
              />
              <div className="flex gap-2">
                <button
                  onClick={() => navigator.clipboard.writeText(appUrl(qrMode === 'camera' ? 'remote' : 'audience'))}
                  className="flex-1 px-3 py-2 bg-transparent border border-border hover:bg-white/5 rounded text-xs font-bold transition-colors flex items-center justify-center gap-1"
                >
                  <Copy size={12} /> Copy Link
                </button>
                <button
                  onClick={() => window.open(appUrl(qrMode === 'camera' ? 'remote' : 'audience'), '_blank')}
                  className={`flex-1 px-3 py-2 rounded text-xs font-bold transition-colors flex items-center justify-center gap-1 ${
                    qrMode === 'camera' ? 'bg-gradient-to-r from-accent-cyan to-blue-500 text-white' : 'bg-gradient-to-r from-orange-400 to-orange-600 text-white'
                  }`}
                >
                  <ExternalLink size={12} /> Launch App
                </button>
              </div>
            </div>
          </div>

          <div className="flex flex-col">
            <h3 className="text-xs font-bold uppercase tracking-wider text-orange-500 mb-4">Option 2: Manual Code</h3>
            <p className="text-sm text-gray-300 mb-4">If the QR code fails:</p>
            <ol className="text-xs text-gray-400 space-y-2 mb-6 list-decimal list-inside">
              <li>Open this app on your phone manually.</li>
              <li>Tap <strong>"{qrMode === 'camera' ? 'Use Phone as Camera' : 'Join Audience'}"</strong>.</li>
              <li>Enter the code below:</li>
            </ol>
            <div className="bg-black/40 border border-border rounded-xl p-6 text-center mb-6">
              <span className="text-[10px] font-bold uppercase tracking-widest text-gray-500 block mb-2">Connection Code</span>
              <span className="text-3xl font-mono font-bold tracking-[0.2em] text-white">e 3 j p</span>
            </div>
          </div>
        </div>
      </motion.div>
    </motion.div>
  );
};
