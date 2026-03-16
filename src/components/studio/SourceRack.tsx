import React from 'react';
import { Settings } from 'lucide-react';
import { motion } from 'motion/react';
import { Source } from '../../types';

interface SourceRackProps {
  sources: Source[];
  onSourceClick: (s: Source) => void;
}

export const SourceRack: React.FC<SourceRackProps> = ({ sources, onSourceClick }) => (
  <div className="w-64 border-r border-border flex flex-col bg-bg">
    <div className="p-3 border-b border-border flex items-center justify-between">
      <h3 className="text-[10px] font-bold uppercase tracking-widest text-gray-500">Source Rack</h3>
      <button className="text-gray-500 hover:text-white active:rotate-90 transition-transform">
        <Settings size={12} />
      </button>
    </div>
    <div className="flex-1 overflow-y-auto p-2 space-y-1">
      {sources.map(source => (
        <div
          key={source.id}
          onClick={() => onSourceClick(source)}
          className="rack-module p-2 group cursor-pointer hover:border-gray-600 transition-colors active:bg-white/5"
        >
          <div className="flex items-center justify-between mb-1">
            <div className="flex items-center gap-2">
              <div className={`led-indicator ${
                source.status === 'active' ? 'bg-accent-green'
                : source.status === 'standby' ? 'bg-orange-500'
                : 'bg-gray-700'
              }`} />
              <span className="text-xs font-medium text-gray-200">{source.name}</span>
            </div>
            <span className="text-[9px] text-gray-500 font-mono">{source.resolution}</span>
          </div>
          <div className="flex items-center justify-between">
            <div className="flex-1 h-1 bg-gray-900 rounded-full overflow-hidden mr-4">
              <motion.div
                className="h-full bg-accent-green"
                initial={{ width: 0 }}
                animate={{ width: `${source.audioLevel * 100}%` }}
                transition={{ duration: 0.1 }}
              />
            </div>
            <span className="text-[9px] text-gray-600 font-mono">{source.fps} FPS</span>
          </div>
        </div>
      ))}
    </div>
  </div>
);
