import React, { useState } from 'react';
import { X, Zap, Wind, Layers, Circle } from 'lucide-react';
import { motion } from 'motion/react';

export type TransitionType = 'cut' | 'fade' | 'dissolve' | 'slide-left' | 'slide-right';

export interface TransitionConfig {
  type: TransitionType;
  durationMs: number;
}

interface SceneTransitionsModalProps {
  config: TransitionConfig;
  onSave: (config: TransitionConfig) => void;
  onClose: () => void;
}

const TRANSITIONS: { type: TransitionType; label: string; description: string; icon: React.ReactNode }[] = [
  {
    type: 'cut',
    label: 'Cut',
    description: 'Instant switch — no animation',
    icon: <Zap size={16} />,
  },
  {
    type: 'fade',
    label: 'Fade to Black',
    description: 'Fade out, then fade in',
    icon: <Circle size={16} />,
  },
  {
    type: 'dissolve',
    label: 'Cross-Dissolve',
    description: 'Blend between scenes',
    icon: <Layers size={16} />,
  },
  {
    type: 'slide-left',
    label: 'Slide Left',
    description: 'New scene slides in from right',
    icon: <Wind size={16} className="scale-x-[-1]" />,
  },
  {
    type: 'slide-right',
    label: 'Slide Right',
    description: 'New scene slides in from left',
    icon: <Wind size={16} />,
  },
];

const DURATIONS = [250, 500, 750, 1000, 1500, 2000];

export const SceneTransitionsModal: React.FC<SceneTransitionsModalProps> = ({
  config,
  onSave,
  onClose,
}) => {
  const [selectedType, setSelectedType] = useState<TransitionType>(config.type);
  const [duration, setDuration] = useState<number>(config.durationMs);

  const handleSave = () => {
    onSave({ type: selectedType, durationMs: duration });
    onClose();
  };

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
              <Layers size={16} className="text-accent-cyan" />
            </div>
            <div>
              <h2 className="text-sm font-bold uppercase tracking-widest text-white">Scene Transitions</h2>
              <p className="text-[10px] text-gray-400">Configure scene switching animation</p>
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
        <div className="p-5 space-y-5">
          {/* Transition type selector */}
          <div className="space-y-2">
            <p className="text-[10px] text-gray-500 uppercase tracking-wider">Transition Type</p>
            <div className="space-y-1">
              {TRANSITIONS.map(({ type, label, description, icon }) => (
                <button
                  key={type}
                  onClick={() => setSelectedType(type)}
                  className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg border transition-all text-left ${
                    selectedType === type
                      ? 'bg-accent-cyan/10 border-accent-cyan/40 text-accent-cyan'
                      : 'bg-white/3 border-border text-gray-400 hover:bg-white/5 hover:text-white'
                  }`}
                >
                  <span className="shrink-0">{icon}</span>
                  <div>
                    <p className="text-[11px] font-semibold">{label}</p>
                    <p className={`text-[9px] ${selectedType === type ? 'text-accent-cyan/70' : 'text-gray-600'}`}>
                      {description}
                    </p>
                  </div>
                  {selectedType === type && (
                    <div className="ml-auto w-2 h-2 rounded-full bg-accent-cyan shrink-0" />
                  )}
                </button>
              ))}
            </div>
          </div>

          {/* Duration — only shown for animated transitions */}
          {selectedType !== 'cut' && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <p className="text-[10px] text-gray-500 uppercase tracking-wider">Duration</p>
                <span className="text-[10px] font-mono text-white">{duration}ms</span>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {DURATIONS.map(ms => (
                  <button
                    key={ms}
                    onClick={() => setDuration(ms)}
                    className={`px-3 py-1 rounded-md text-[10px] font-mono border transition-all ${
                      duration === ms
                        ? 'bg-accent-cyan/10 border-accent-cyan/40 text-accent-cyan'
                        : 'bg-white/3 border-border text-gray-500 hover:text-white hover:bg-white/5'
                    }`}
                  >
                    {ms}ms
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 pb-5 flex justify-end gap-2">
          <button
            onClick={onClose}
            className="px-4 py-2 bg-transparent hover:bg-white/5 text-white font-bold rounded-lg transition-all uppercase tracking-widest text-[10px] border border-border"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            className="px-4 py-2 bg-accent-cyan hover:bg-cyan-400 text-black font-bold rounded-lg transition-all uppercase tracking-widest text-[10px]"
          >
            Save
          </button>
        </div>
      </motion.div>
    </div>
  );
};
