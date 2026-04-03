import React, { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Camera, Monitor, MessageSquare, QrCode, ArrowRight, X } from 'lucide-react';
import MobileOnboarding from './MobileOnboarding';

type Mode = 'remote' | 'screen' | 'audience';

interface ModeCard {
  mode: Mode;
  icon: React.ReactNode;
  title: string;
  subtitle: string;
  description: string;
  color: string;
  border: string;
  iconBg: string;
}

const MODES: ModeCard[] = [
  {
    mode: 'remote',
    icon: <Camera size={28} />,
    title: 'Phone Camera',
    subtitle: 'Wireless camera source',
    description: 'Stream your phone camera directly into AetherCast Studio as a live video source.',
    color: 'text-blue-400',
    border: 'border-blue-500/30 hover:border-blue-500/60',
    iconBg: 'bg-blue-500/10',
  },
  {
    mode: 'screen',
    icon: <Monitor size={28} />,
    title: 'Screen Share',
    subtitle: 'Broadcast your screen',
    description: 'Share your Android screen to Studio in real-time using native screen capture.',
    color: 'text-purple-400',
    border: 'border-purple-500/30 hover:border-purple-500/60',
    iconBg: 'bg-purple-500/10',
  },
  {
    mode: 'audience',
    icon: <MessageSquare size={28} />,
    title: 'Audience Portal',
    subtitle: 'Messages, Q&A & prayer',
    description: 'Send questions, prayer requests, or messages to the live broadcast.',
    color: 'text-green-400',
    border: 'border-green-500/30 hover:border-green-500/60',
    iconBg: 'bg-green-500/10',
  },
];

export default function MobileHome() {
  const [onboarded, setOnboarded] = useState(() => !!localStorage.getItem('ac_onboarded'));
  const [selected, setSelected] = useState<ModeCard | null>(null);
  const [roomCode, setRoomCode] = useState('');

  if (!onboarded) {
    return <MobileOnboarding onComplete={() => setOnboarded(true)} />;
  }

  const connect = () => {
    if (!selected) return;
    const room = roomCode.trim().toUpperCase() || 'SLTN-1234';
    window.location.href = `/?mode=${selected.mode}&room=${room}`;
  };

  return (
    <div className="min-h-screen bg-bg text-white flex flex-col">
      {/* Header */}
      <div className="px-6 pt-12 pb-6 text-center">
        <div className="w-14 h-14 bg-blue-500/10 border border-blue-500/30 rounded-2xl flex items-center justify-center mx-auto mb-4">
          <QrCode size={28} className="text-blue-400" />
        </div>
        <h1 className="text-2xl font-bold tracking-tight">AetherCast Camera</h1>
        <p className="text-gray-400 text-sm mt-1">
          Scan the QR code in Studio — or tap a mode below to connect manually.
        </p>
      </div>

      {/* Mode cards */}
      <div className="flex-1 px-4 space-y-3 pb-8">
        {MODES.map((card, i) => (
          <motion.button
            key={card.mode}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.07 }}
            onClick={() => { setSelected(card); setRoomCode(''); }}
            className={`w-full text-left p-4 rounded-2xl bg-white/5 border transition-colors ${card.border}`}
          >
            <div className="flex items-center gap-4">
              <div className={`w-12 h-12 rounded-xl flex items-center justify-center shrink-0 ${card.iconBg} ${card.color}`}>
                {card.icon}
              </div>
              <div className="flex-1 min-w-0">
                <div className={`font-semibold text-base ${card.color}`}>{card.title}</div>
                <div className="text-gray-400 text-xs mt-0.5">{card.subtitle}</div>
              </div>
              <ArrowRight size={16} className="text-gray-600 shrink-0" />
            </div>
          </motion.button>
        ))}

        {/* QR scan hint */}
        <div className="pt-4 text-center">
          <p className="text-xs text-gray-600">
            Studio QR codes connect automatically — no room code needed.
          </p>
        </div>
      </div>

      {/* Room code modal */}
      <AnimatePresence>
        {selected && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 bg-black/60 z-40"
              onClick={() => setSelected(null)}
            />
            <motion.div
              initial={{ y: '100%' }}
              animate={{ y: 0 }}
              exit={{ y: '100%' }}
              transition={{ type: 'spring', damping: 28, stiffness: 300 }}
              className="fixed bottom-0 left-0 right-0 z-50 bg-[#1a1a2e] border-t border-white/10 rounded-t-3xl p-6"
            >
              <div className="flex items-center justify-between mb-5">
                <div className="flex items-center gap-3">
                  <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${selected.iconBg} ${selected.color}`}>
                    {selected.icon}
                  </div>
                  <div>
                    <div className="font-semibold">{selected.title}</div>
                    <div className="text-xs text-gray-400">{selected.description}</div>
                  </div>
                </div>
                <button onClick={() => setSelected(null)} className="text-gray-500 hover:text-white p-1">
                  <X size={20} />
                </button>
              </div>

              <label className="block text-xs text-gray-400 mb-1.5 font-medium">
                Room Code <span className="text-gray-600">(from Studio — leave blank for default)</span>
              </label>
              <input
                type="text"
                value={roomCode}
                onChange={e => setRoomCode(e.target.value.toUpperCase())}
                onKeyDown={e => e.key === 'Enter' && connect()}
                placeholder="e.g. SLTN-1234"
                maxLength={12}
                autoFocus
                className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white placeholder-gray-600 font-mono tracking-widest text-lg focus:outline-none focus:border-blue-500/50 mb-4"
              />

              <button
                onClick={connect}
                className={`w-full py-4 rounded-xl font-bold text-white transition-colors flex items-center justify-center gap-2 ${
                  selected.mode === 'remote' ? 'bg-blue-600 hover:bg-blue-700' :
                  selected.mode === 'screen' ? 'bg-purple-600 hover:bg-purple-700' :
                  'bg-green-600 hover:bg-green-700'
                }`}
              >
                Connect to Studio
                <ArrowRight size={18} />
              </button>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}
