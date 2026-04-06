import React from 'react';
import { X, Github, ExternalLink, Tv2 } from 'lucide-react';
import { motion } from 'motion/react';

interface AboutModalProps {
  onClose: () => void;
}

const APP_VERSION = (window as { __APP_VERSION__?: string }).__APP_VERSION__ ?? '1.0.16';

export const AboutModal: React.FC<AboutModalProps> = ({ onClose }) => {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
      <motion.div
        initial={{ scale: 0.95, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.95, opacity: 0 }}
        className="bg-panel border border-border w-full max-w-sm rounded-2xl shadow-2xl overflow-hidden flex flex-col"
      >
        {/* Header */}
        <div className="p-5 border-b border-border flex items-center justify-between bg-white/5">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-full bg-accent-cyan/10 flex items-center justify-center">
              <Tv2 size={16} className="text-accent-cyan" />
            </div>
            <div>
              <h2 className="text-sm font-bold uppercase tracking-widest text-white">About</h2>
              <p className="text-[10px] text-gray-400">Aether Studio</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 text-gray-500 hover:text-white hover:bg-white/10 rounded-full transition-colors"
          >
            <X size={18} />
          </button>
        </div>

        {/* Body */}
        <div className="p-6 space-y-5 text-center">
          {/* Logo area */}
          <div className="flex flex-col items-center gap-2">
            <div className="w-16 h-16 rounded-2xl bg-accent-cyan/10 border border-accent-cyan/20 flex items-center justify-center">
              <Tv2 size={32} className="text-accent-cyan" />
            </div>
            <div>
              <p className="text-white font-bold text-base tracking-wide">Aether Studio</p>
              <p className="text-[10px] text-gray-500 font-mono mt-0.5">Version {APP_VERSION}</p>
            </div>
          </div>

          <p className="text-[11px] text-gray-400 leading-relaxed">
            Professional live-broadcast studio for desktop. Stream to RTMP, record locally,
            connect phones as wireless cameras — all in one app.
          </p>

          {/* Links */}
          <div className="flex flex-col gap-2">
            <a
              href="https://github.com/Coolzymccooy/AetherCast"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-white/5 hover:bg-white/10 border border-border text-[11px] text-gray-300 hover:text-white transition-colors"
            >
              <Github size={13} />
              View on GitHub
              <ExternalLink size={11} className="text-gray-500" />
            </a>
            <a
              href="https://github.com/Coolzymccooy/AetherCast/releases"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-white/5 hover:bg-white/10 border border-border text-[11px] text-gray-300 hover:text-white transition-colors"
            >
              <ExternalLink size={13} />
              Release Notes
            </a>
          </div>

          <p className="text-[9px] text-gray-600">
            Built with Tauri · React · Rust · FFmpeg
          </p>
        </div>

        {/* Footer */}
        <div className="px-6 pb-5 flex justify-center">
          <button
            onClick={onClose}
            className="px-6 py-2 bg-transparent hover:bg-white/5 text-white font-bold rounded-lg transition-all uppercase tracking-widest text-[10px] border border-border"
          >
            Close
          </button>
        </div>
      </motion.div>
    </div>
  );
};
