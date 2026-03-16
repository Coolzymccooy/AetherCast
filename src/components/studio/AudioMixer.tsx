import React from 'react';
import { Volume2, Settings, Mic, MicOff } from 'lucide-react';
import { motion } from 'motion/react';
import { AudioChannel } from '../../types';

interface AudioMixerProps {
  channels: AudioChannel[];
  onToggleMute: (name: string) => void;
  onLevelChange: (name: string, val: number) => void;
  onOpenSettings?: () => void;
}

export const AudioMixer: React.FC<AudioMixerProps> = ({ channels, onToggleMute, onLevelChange, onOpenSettings }) => (
  <div className="flex-1 bg-panel p-3 flex flex-col min-w-0 overflow-hidden">
    <div className="flex items-center justify-between mb-3">
      <h3 className="text-[10px] font-bold uppercase tracking-widest text-gray-500">Audio Mixer</h3>
      <div className="flex gap-2">
        <Volume2 size={12} className="text-gray-500" />
        <button onClick={onOpenSettings} title="Audio Processing Settings">
          <Settings size={12} className="text-gray-500 hover:text-accent-cyan transition-colors cursor-pointer" />
        </button>
      </div>
    </div>

    <div className="flex-1 overflow-y-auto custom-scrollbar pr-1 space-y-3">
      {channels.map(ch => (
        <div key={ch.name} className="space-y-1">
          <div className="flex justify-between items-center text-[10px] uppercase font-medium">
            <span className={ch.muted ? 'text-gray-600' : 'text-gray-300'}>{ch.name}</span>
            <button
              onClick={() => onToggleMute(ch.name)}
              className={`p-1 rounded-sm transition-colors ${ch.muted ? 'text-accent-red bg-accent-red/10' : 'text-gray-500 hover:text-white hover:bg-white/5'}`}
            >
              {ch.muted ? <MicOff size={10} /> : <Mic size={10} />}
            </button>
          </div>
          <div className="flex items-center gap-2">
            <div className="flex-1 space-y-1">
              <div className="h-1.5 bg-black rounded-sm relative overflow-hidden">
                <motion.div
                  className={`h-full bg-gradient-to-r from-accent-green via-yellow-400 to-accent-red transition-opacity ${ch.muted ? 'opacity-20' : 'opacity-100'}`}
                  initial={{ width: 0 }}
                  animate={{ width: `${ch.level * 100}%` }}
                  transition={{ duration: 0.1 }}
                />
                <div className="absolute top-0 bottom-0 w-0.5 bg-white/40" style={{ left: `${ch.peak * 100}%` }} />
              </div>
              <input
                type="range"
                className="w-full h-1 bg-gray-800 rounded-lg appearance-none cursor-pointer accent-accent-cyan"
                value={ch.volume * 100}
                onChange={(e) => onLevelChange(ch.name, parseInt(e.target.value) / 100)}
              />
            </div>
            <div className="flex flex-col gap-0.5">
              <button
                onClick={() => onToggleMute(ch.name)}
                className={`px-1 py-0.5 text-[7px] border border-border rounded-sm transition-colors ${ch.muted ? 'bg-accent-red/20 text-accent-red border-accent-red/30' : 'hover:bg-white/5 text-gray-500 hover:text-white'}`}
              >M</button>
              <button className="px-1 py-0.5 text-[7px] border border-border rounded-sm hover:bg-white/5 text-gray-500 hover:text-white transition-colors">S</button>
            </div>
          </div>
        </div>
      ))}
    </div>
  </div>
);
