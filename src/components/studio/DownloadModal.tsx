import React from 'react';
import { X, Monitor, Apple, Download, ExternalLink, Shield, Zap, Cpu } from 'lucide-react';
import { motion } from 'motion/react';

interface DownloadModalProps {
  onClose: () => void;
}

const GITHUB_REPO = 'https://github.com/Coolzymccooy/AetherCast';
const LATEST_TAG = 'v1.0.5';
const DL = `${GITHUB_REPO}/releases/download/${LATEST_TAG}`;

const downloads = [
  {
    platform: 'Windows',
    icon: <Monitor size={24} />,
    description: 'Windows 10/11 (64-bit)',
    files: [
      { label: 'Installer (.exe)', url: `${DL}/Selton.Studio_1.0.0_x64-setup.exe`, size: '~2 MB' },
      { label: 'MSI Package', url: `${DL}/Selton.Studio_1.0.0_x64_en-US.msi`, size: '~3 MB' },
    ],
    features: ['GPU encoding (NVIDIA NVENC, Intel QSV, AMD AMF)', 'Direct RTMP output — no server needed', 'Lower CPU usage than browser mode'],
    color: 'accent-cyan',
  },
  {
    platform: 'macOS',
    icon: <Apple size={24} />,
    description: 'Coming soon',
    files: [],
    features: ['macOS build is in progress — check back soon'],
    color: 'gray-300',
  },
];

export const DownloadModal: React.FC<DownloadModalProps> = ({ onClose }) => {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
      <motion.div
        initial={{ scale: 0.95, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.95, opacity: 0 }}
        className="bg-panel border border-border w-full max-w-3xl rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]"
      >
        <div className="p-5 border-b border-border flex items-center justify-between bg-white/5">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-accent-cyan/10 flex items-center justify-center">
              <Download size={20} className="text-accent-cyan" />
            </div>
            <div>
              <h2 className="text-sm font-bold uppercase tracking-widest text-white">Download Desktop App</h2>
              <p className="text-[10px] text-gray-400">GPU-accelerated streaming — no browser limitations</p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 text-gray-500 hover:text-white hover:bg-white/10 rounded-full transition-colors">
            <X size={20} />
          </button>
        </div>

        {/* Why Desktop */}
        <div className="px-6 py-4 bg-accent-cyan/5 border-b border-border">
          <div className="grid grid-cols-3 gap-4">
            <div className="flex items-center gap-2 text-[10px]">
              <Zap size={14} className="text-accent-cyan shrink-0" />
              <span className="text-gray-300">GPU encoding — 10x faster than browser</span>
            </div>
            <div className="flex items-center gap-2 text-[10px]">
              <Cpu size={14} className="text-accent-cyan shrink-0" />
              <span className="text-gray-300">2-5% CPU vs 15-30% in browser</span>
            </div>
            <div className="flex items-center gap-2 text-[10px]">
              <Shield size={14} className="text-accent-cyan shrink-0" />
              <span className="text-gray-300">No Socket.io — direct RTMP output</span>
            </div>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-4">
          {downloads.map(platform => (
            <div key={platform.platform} className="bg-black/40 border border-border rounded-xl p-5 hover:border-white/20 transition-all">
              <div className="flex items-start gap-4">
                <div className="w-12 h-12 bg-white/5 rounded-xl flex items-center justify-center text-gray-400 shrink-0">
                  {platform.icon}
                </div>
                <div className="flex-1">
                  <h3 className="text-sm font-bold text-white">{platform.platform}</h3>
                  <p className="text-[10px] text-gray-500 mt-0.5">{platform.description}</p>

                  <div className="flex flex-wrap gap-2 mt-3">
                    {platform.files.map(file => (
                      <a
                        key={file.label}
                        href={file.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-2 px-4 py-2 bg-accent-cyan hover:bg-cyan-400 text-black text-[10px] font-bold uppercase rounded-lg transition-all active:scale-95"
                      >
                        <Download size={12} />
                        {file.label}
                        <span className="text-[8px] opacity-60">{file.size}</span>
                      </a>
                    ))}
                  </div>

                  <div className="flex flex-wrap gap-x-4 gap-y-1 mt-3">
                    {platform.features.map(f => (
                      <span key={f} className="text-[9px] text-gray-500">• {f}</span>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>

        <div className="p-5 border-t border-border bg-black/20 flex items-center justify-between">
          <a
            href={`${GITHUB_REPO}/releases`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-[10px] text-gray-500 hover:text-accent-cyan flex items-center gap-1 transition-colors"
          >
            <ExternalLink size={10} /> View all releases on GitHub
          </a>
          <button
            onClick={onClose}
            className="px-6 py-2.5 bg-transparent hover:bg-white/5 text-white font-bold rounded-lg transition-all uppercase tracking-widest text-[10px] border border-border"
          >
            Close
          </button>
        </div>
      </motion.div>
    </div>
  );
};
