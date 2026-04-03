import React from 'react';
import { Home, ArrowLeftRight } from 'lucide-react';
import { motion } from 'motion/react';

interface MobileModeBarProps {
  roomId: string;
  onHome: () => void;
  homeLabel?: string;
}

export function MobileModeBar({ roomId, onHome, homeLabel = 'Back to Home' }: MobileModeBarProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: -12 }}
      animate={{ opacity: 1, y: 0 }}
      className="w-full max-w-sm flex items-center justify-between gap-3 mb-4"
    >
      <button
        onClick={onHome}
        className="flex items-center gap-2 px-4 py-2 rounded-full bg-white/6 border border-white/10 text-xs font-semibold text-white hover:bg-white/10 transition-colors"
      >
        <Home size={14} />
        {homeLabel}
      </button>

      <div className="flex items-center gap-2 px-4 py-2 rounded-full bg-white/6 border border-white/10 text-[11px] font-mono text-white/60">
        <ArrowLeftRight size={12} />
        {roomId}
      </div>
    </motion.div>
  );
}
