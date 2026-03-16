import React from 'react';
import { Rewind, Play, Trash2, Circle } from 'lucide-react';
import { motion } from 'motion/react';

interface ReplayClip {
  id: string;
  startTime: number;
  endTime: number;
  duration: number;
}

interface Props {
  isBuffering: boolean;
  clips: ReplayClip[];
  bufferStats: { bufferSizeMB: number; frameCount: number; oldestFrameAge: number };
  onStartBuffer: () => void;
  onStopBuffer: () => void;
  onCaptureReplay: (durationSec: number, playbackRate?: number) => void;
  onPlayReplay: (clip: ReplayClip) => void;
  onDeleteClip: (id: string) => void;
}

const formatDuration = (seconds: number): string => {
  if (seconds < 60) return `${seconds.toFixed(1)}s`;
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}m ${s}s`;
};

export const ReplayPanel: React.FC<Props> = ({
  isBuffering,
  clips,
  bufferStats,
  onStartBuffer,
  onStopBuffer,
  onCaptureReplay,
  onPlayReplay,
  onDeleteClip,
}) => (
  <div className="flex flex-col h-full">
    <div className="p-3 border-b border-border flex items-center gap-2 bg-white/5">
      <Rewind size={14} className="text-accent-cyan" />
      <h3 className="text-[10px] font-bold uppercase tracking-widest text-gray-500">Instant Replay</h3>
    </div>

    <div className="flex-1 overflow-y-auto custom-scrollbar p-3 space-y-4">
      {/* Buffer Status */}
      <div className="rack-module">
        <div className="bg-gray-800/50 p-2 border-b border-border flex items-center justify-between">
          <div className="flex items-center gap-2">
            {isBuffering ? (
              <motion.div
                animate={{ opacity: [1, 0.3, 1] }}
                transition={{ duration: 1.2, repeat: Infinity }}
              >
                <Circle size={10} fill="#ff4444" className="text-accent-red" />
              </motion.div>
            ) : (
              <Circle size={10} className="text-gray-600" />
            )}
            <span className="text-[11px] font-bold uppercase tracking-wider">
              {isBuffering ? 'Recording' : 'Idle'}
            </span>
          </div>
          <span className={`text-[9px] px-1.5 rounded-full font-bold ${isBuffering ? 'bg-accent-red/20 text-accent-red' : 'bg-gray-700 text-gray-400'}`}>
            {isBuffering ? 'LIVE' : 'OFF'}
          </span>
        </div>
        <div className="p-3 space-y-2">
          <div className="grid grid-cols-3 gap-2">
            <div className="text-center">
              <div className="text-[8px] text-gray-500 uppercase">Buffer</div>
              <div className="text-[11px] font-mono font-bold text-white">{bufferStats.bufferSizeMB.toFixed(1)} MB</div>
            </div>
            <div className="text-center">
              <div className="text-[8px] text-gray-500 uppercase">Frames</div>
              <div className="text-[11px] font-mono font-bold text-white">{bufferStats.frameCount}</div>
            </div>
            <div className="text-center">
              <div className="text-[8px] text-gray-500 uppercase">Age</div>
              <div className="text-[11px] font-mono font-bold text-white">{bufferStats.oldestFrameAge.toFixed(0)}s</div>
            </div>
          </div>

          <button
            onClick={isBuffering ? onStopBuffer : onStartBuffer}
            className={`w-full py-2 rounded text-[10px] font-bold uppercase border transition-all ${
              isBuffering
                ? 'bg-accent-red/10 border-accent-red/30 text-accent-red hover:bg-accent-red/20'
                : 'bg-accent-cyan/10 border-accent-cyan/30 text-accent-cyan hover:bg-accent-cyan/20'
            }`}
          >
            {isBuffering ? 'Stop Buffer' : 'Start Buffer'}
          </button>
        </div>
      </div>

      {/* Capture Controls */}
      <div className="rack-module">
        <div className="bg-gray-800/50 p-2 border-b border-border">
          <span className="text-[11px] font-bold uppercase tracking-wider">Capture</span>
        </div>
        <div className="p-3 space-y-3">
          <div className="space-y-2">
            <span className="text-[9px] text-gray-500 uppercase font-bold">Duration</span>
            <div className="grid grid-cols-4 gap-1">
              {[
                { label: '10s', value: 10 },
                { label: '30s', value: 30 },
                { label: '60s', value: 60 },
                { label: '5min', value: 300 },
              ].map(({ label, value }) => (
                <button
                  key={value}
                  onClick={() => onCaptureReplay(value)}
                  disabled={!isBuffering}
                  className="btn-hardware text-[9px] py-2 font-bold disabled:opacity-30"
                >
                  Last {label}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-2">
            <span className="text-[9px] text-gray-500 uppercase font-bold">Speed</span>
            <div className="grid grid-cols-3 gap-1">
              {[
                { label: '1x', rate: 1 },
                { label: '0.5x Slow-Mo', rate: 0.5 },
                { label: '0.25x Super Slow', rate: 0.25 },
              ].map(({ label, rate }) => (
                <button
                  key={rate}
                  onClick={() => onCaptureReplay(10, rate)}
                  disabled={!isBuffering}
                  className="btn-hardware text-[8px] py-2 font-bold disabled:opacity-30"
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Clips List */}
      <div className="rack-module">
        <div className="bg-gray-800/50 p-2 border-b border-border flex items-center justify-between">
          <span className="text-[11px] font-bold uppercase tracking-wider">Clips</span>
          <span className="text-[9px] text-gray-500 font-mono">{clips.length}</span>
        </div>
        <div className="p-2 space-y-1 max-h-60 overflow-y-auto custom-scrollbar">
          {clips.length === 0 && (
            <div className="text-[9px] text-gray-600 italic p-4 text-center border border-dashed border-white/5 rounded">
              No replay clips captured
            </div>
          )}
          {clips.map(clip => (
            <motion.div
              key={clip.id}
              initial={{ opacity: 0, x: -8 }}
              animate={{ opacity: 1, x: 0 }}
              className="flex items-center gap-2 p-2 rounded-sm border border-transparent hover:bg-white/5 group transition-all"
            >
              <div className="flex-1 min-w-0">
                <div className="text-[10px] font-medium text-gray-300 truncate">
                  Replay - {formatDuration(clip.duration)}
                </div>
                <div className="text-[8px] font-mono text-gray-500">
                  {new Date(clip.startTime).toLocaleTimeString()}
                </div>
              </div>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => onPlayReplay(clip)}
                  className="p-1.5 text-accent-cyan hover:bg-accent-cyan/10 rounded transition-colors"
                >
                  <Play size={12} fill="currentColor" />
                </button>
                <button
                  onClick={() => onDeleteClip(clip.id)}
                  className="p-1.5 opacity-0 group-hover:opacity-100 text-gray-600 hover:text-accent-red hover:bg-accent-red/10 rounded transition-all"
                >
                  <Trash2 size={12} />
                </button>
              </div>
            </motion.div>
          ))}
        </div>
      </div>
    </div>
  </div>
);
