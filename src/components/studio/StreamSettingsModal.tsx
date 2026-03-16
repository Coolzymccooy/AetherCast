import React, { useState } from 'react';
import { X, Radio, Plus, Trash2, Youtube, Twitch, Globe, Shield, Eye, EyeOff } from 'lucide-react';
import { motion } from 'motion/react';
import { StreamDestination } from '../../types';

interface StreamSettingsModalProps {
  destinations: StreamDestination[];
  setDestinations: React.Dispatch<React.SetStateAction<StreamDestination[]>>;
  onClose: () => void;
  onStart: () => void;
}

const PRESETS = [
  { name: 'YouTube', url: 'rtmp://a.rtmp.youtube.com/live2', icon: '🔴', color: 'text-red-500' },
  { name: 'YouTube (RTMPS)', url: 'rtmps://a.rtmp.youtube.com:443/live2', icon: '🔴', color: 'text-red-500' },
  { name: 'Twitch', url: 'rtmp://live.twitch.tv/app', icon: '🟣', color: 'text-purple-500' },
  { name: 'Facebook', url: 'rtmps://live-api-s.facebook.com:443/rtmp/', icon: '🔵', color: 'text-blue-500' },
  { name: 'Custom RTMP', url: '', icon: '🌐', color: 'text-gray-400' },
  { name: 'Custom SRT', url: 'srt://', icon: '📡', color: 'text-cyan-400' },
];

function detectProtocol(url: string): string {
  if (/^rtmps:\/\//.test(url)) return 'RTMPS';
  if (/^rtmp:\/\//.test(url)) return 'RTMP';
  if (/^srt:\/\//.test(url)) return 'SRT';
  if (/^rist:\/\//.test(url)) return 'RIST';
  return 'Unknown';
}

function getProtocolColor(protocol: string): string {
  switch (protocol) {
    case 'RTMPS': return 'bg-green-500/20 text-green-400';
    case 'RTMP': return 'bg-yellow-500/20 text-yellow-400';
    case 'SRT': return 'bg-cyan-500/20 text-cyan-400';
    case 'RIST': return 'bg-purple-500/20 text-purple-400';
    default: return 'bg-gray-500/20 text-gray-400';
  }
}

export const StreamSettingsModal: React.FC<StreamSettingsModalProps> = ({
  destinations, setDestinations, onClose, onStart,
}) => {
  const [showPresets, setShowPresets] = useState(false);
  const [visibleKeys, setVisibleKeys] = useState<Set<string>>(new Set());

  const update = (id: string, patch: Partial<StreamDestination>) =>
    setDestinations(prev => prev.map(d => d.id === id ? { ...d, ...patch } : d));

  const addPreset = (preset: typeof PRESETS[number]) => {
    setDestinations(prev => [...prev, {
      id: `dest-${Date.now()}`,
      name: preset.name,
      rtmpUrl: preset.url,
      streamKey: '',
      enabled: true,
    }]);
    setShowPresets(false);
  };

  const toggleKeyVisibility = (id: string) => {
    setVisibleKeys(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const hasValidDestination = destinations.some(d => d.enabled && d.rtmpUrl && d.streamKey);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
      <motion.div
        initial={{ scale: 0.95, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.95, opacity: 0 }}
        className="bg-panel border border-border w-full max-w-2xl rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[85vh]"
      >
        <div className="p-5 border-b border-border flex items-center justify-between bg-white/5">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-accent-red/10 flex items-center justify-center">
              <Radio size={20} className="text-accent-red" />
            </div>
            <div>
              <h2 className="text-sm font-bold uppercase tracking-widest text-white">Stream Destinations</h2>
              <p className="text-[10px] text-gray-400">Configure RTMP, RTMPS, or SRT endpoints for broadcasting</p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 text-gray-500 hover:text-white hover:bg-white/10 rounded-full transition-colors">
            <X size={20} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-4">
          {destinations.map(dest => {
            const protocol = detectProtocol(dest.rtmpUrl);
            const isKeyVisible = visibleKeys.has(dest.id);

            return (
              <div key={dest.id} className="bg-black/40 border border-border rounded-xl p-5 relative group transition-all hover:border-white/10">
                <div className="absolute top-5 right-5 flex items-center gap-3">
                  <span className={`text-[8px] font-bold px-2 py-0.5 rounded-full ${getProtocolColor(protocol)}`}>
                    {protocol}
                  </span>
                  <button
                    onClick={() => update(dest.id, { enabled: !dest.enabled })}
                    className={`w-10 h-5 rounded-full relative transition-colors ${dest.enabled ? 'bg-accent-cyan' : 'bg-gray-700'}`}
                  >
                    <div className={`absolute top-0.5 bottom-0.5 w-4 bg-white rounded-full transition-all ${dest.enabled ? 'left-[22px]' : 'left-0.5'}`} />
                  </button>
                  <button
                    onClick={() => setDestinations(prev => prev.filter(d => d.id !== dest.id))}
                    className="p-1.5 text-gray-500 hover:text-accent-red hover:bg-accent-red/10 rounded-md transition-colors opacity-0 group-hover:opacity-100"
                  >
                    <Trash2 size={16} />
                  </button>
                </div>

                <div className="space-y-4 pr-32">
                  <div className="grid grid-cols-2 gap-5">
                    <div className="space-y-1.5">
                      <label className="text-[10px] font-bold text-gray-500 uppercase tracking-wider">Name</label>
                      <input
                        type="text"
                        value={dest.name}
                        onChange={(e) => update(dest.id, { name: e.target.value })}
                        className="w-full bg-black border border-border rounded-lg px-3 py-2.5 text-xs text-white focus:outline-none focus:border-accent-cyan transition-colors"
                        placeholder="e.g., YouTube Main"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-[10px] font-bold text-gray-500 uppercase tracking-wider">
                        Server URL
                      </label>
                      <input
                        type="text"
                        value={dest.rtmpUrl}
                        onChange={(e) => update(dest.id, { rtmpUrl: e.target.value })}
                        className="w-full bg-black border border-border rounded-lg px-3 py-2.5 text-xs text-white focus:outline-none focus:border-accent-cyan transition-colors font-mono"
                        placeholder="rtmp:// or rtmps:// or srt://"
                      />
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-bold text-gray-500 uppercase tracking-wider flex items-center gap-1">
                      <Shield size={10} /> Stream Key
                    </label>
                    <div className="relative">
                      <input
                        type={isKeyVisible ? 'text' : 'password'}
                        value={dest.streamKey}
                        onChange={(e) => update(dest.id, { streamKey: e.target.value })}
                        className="w-full bg-black border border-border rounded-lg px-3 py-2.5 pr-10 text-xs text-white focus:outline-none focus:border-accent-cyan transition-colors font-mono"
                        placeholder="Paste your stream key here"
                      />
                      <button
                        onClick={() => toggleKeyVisibility(dest.id)}
                        className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-gray-500 hover:text-white"
                      >
                        {isKeyVisible ? <EyeOff size={14} /> : <Eye size={14} />}
                      </button>
                    </div>
                  </div>

                  {/* Validation warnings */}
                  {dest.enabled && !dest.rtmpUrl && (
                    <p className="text-[10px] text-yellow-400">Missing server URL</p>
                  )}
                  {dest.enabled && !dest.streamKey && (
                    <p className="text-[10px] text-yellow-400">Missing stream key</p>
                  )}
                  {dest.enabled && dest.rtmpUrl && protocol === 'RTMP' && dest.rtmpUrl.includes('youtube') && (
                    <p className="text-[10px] text-yellow-400">YouTube recommends RTMPS. Change rtmp:// to rtmps:// and add port :443</p>
                  )}
                </div>
              </div>
            );
          })}

          {/* Add destination */}
          {showPresets ? (
            <div className="bg-black/40 border border-accent-cyan/30 rounded-xl p-4 space-y-3">
              <h4 className="text-xs font-bold text-accent-cyan uppercase tracking-wider">Choose Platform</h4>
              <div className="grid grid-cols-2 gap-2">
                {PRESETS.map(preset => (
                  <button
                    key={preset.name}
                    onClick={() => addPreset(preset)}
                    className="flex items-center gap-2 p-3 bg-black/40 border border-border rounded-lg hover:border-accent-cyan/50 hover:bg-white/5 transition-all text-left"
                  >
                    <span className="text-lg">{preset.icon}</span>
                    <span className="text-xs font-medium text-gray-300">{preset.name}</span>
                  </button>
                ))}
              </div>
              <button onClick={() => setShowPresets(false)} className="w-full text-[10px] text-gray-500 hover:text-white py-1">Cancel</button>
            </div>
          ) : (
            <button
              onClick={() => setShowPresets(true)}
              className="w-full py-4 border border-dashed border-border rounded-xl text-gray-500 hover:text-white hover:border-gray-500 hover:bg-white/5 transition-all flex items-center justify-center gap-2 text-xs uppercase font-bold"
            >
              <Plus size={16} /> Add Destination
            </button>
          )}
        </div>

        <div className="p-5 border-t border-border bg-black/20 flex gap-3 justify-between">
          <div className="text-[10px] text-gray-500 flex items-center gap-2">
            {destinations.filter(d => d.enabled).length} destination(s) enabled
          </div>
          <div className="flex gap-3">
            <button onClick={onClose} className="px-6 py-2.5 bg-transparent hover:bg-white/5 text-white font-bold rounded-lg transition-all uppercase tracking-widest text-[10px] border border-border">
              Cancel
            </button>
            <button
              onClick={() => { onClose(); onStart(); }}
              disabled={!hasValidDestination}
              className="px-8 py-2.5 bg-accent-red hover:bg-red-500 text-white font-bold rounded-lg transition-all uppercase tracking-widest text-[10px] shadow-[0_0_15px_rgba(255,68,68,0.3)] flex items-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <Radio size={14} /> Start Broadcast
            </button>
          </div>
        </div>
      </motion.div>
    </div>
  );
};
