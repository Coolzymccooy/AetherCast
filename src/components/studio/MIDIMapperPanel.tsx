import React from 'react';
import { Sliders, AlertTriangle } from 'lucide-react';
import { motion } from 'motion/react';

interface MIDIDevice {
  name: string;
  manufacturer: string;
  id: string;
}

interface MIDIMapping {
  id: string;
  channel: number;
  note?: number;
  cc?: number;
  action: string;
  type: string;
}

interface Props {
  isSupported: boolean;
  isInitialized: boolean;
  devices: MIDIDevice[];
  selectedDevice: string | null;
  onSelectDevice: (id: string) => void;
  mappings: MIDIMapping[];
  onUpdateMappings: (mappings: MIDIMapping[]) => void;
  isLearning: boolean;
  onStartLearn: (action: string) => void;
  onStopLearn: (action: string) => void;
}

const QUICK_ACTIONS = [
  'Scene 1', 'Scene 2', 'Scene 3', 'Scene 4', 'Scene 5', 'Scene 6',
  'Cut', 'Fade', 'Mute Mic 1', 'Mute Mic 2', 'Emergency Wide',
];

export const MIDIMapperPanel: React.FC<Props> = ({
  isSupported,
  isInitialized,
  devices,
  selectedDevice,
  onSelectDevice,
  mappings,
  onUpdateMappings,
  isLearning,
  onStartLearn,
  onStopLearn,
}) => (
  <div className="flex flex-col h-full">
    <div className="p-3 border-b border-border flex items-center gap-2 bg-white/5">
      <Sliders size={14} className="text-accent-cyan" />
      <h3 className="text-[10px] font-bold uppercase tracking-widest text-gray-500">MIDI / Stream Deck</h3>
    </div>

    <div className="flex-1 overflow-y-auto custom-scrollbar p-3 space-y-4">
      {/* Not Supported Warning */}
      {!isSupported && (
        <div className="bg-accent-red/10 border border-accent-red/30 rounded-xl p-4 flex items-center gap-3">
          <AlertTriangle size={20} className="text-accent-red flex-shrink-0" />
          <div>
            <div className="text-[11px] font-bold text-accent-red uppercase">Not Available</div>
            <div className="text-[9px] text-gray-400 mt-1">Web MIDI not available in this browser. Use Chrome or Edge with MIDI hardware connected.</div>
          </div>
        </div>
      )}

      {isSupported && (
        <>
          {/* Learning Indicator */}
          {isLearning && (
            <motion.div
              animate={{ opacity: [1, 0.5, 1] }}
              transition={{ duration: 1.5, repeat: Infinity }}
              className="bg-accent-cyan/10 border border-accent-cyan/30 rounded-lg p-3 flex items-center gap-3"
            >
              <motion.div
                animate={{ scale: [1, 1.3, 1] }}
                transition={{ duration: 1, repeat: Infinity }}
                className="w-3 h-3 bg-accent-cyan rounded-full"
              />
              <span className="text-[10px] font-bold text-accent-cyan uppercase tracking-wider">
                Waiting for MIDI input...
              </span>
            </motion.div>
          )}

          {/* Device Selector */}
          <div className="rack-module">
            <div className="bg-gray-800/50 p-2 border-b border-border">
              <span className="text-[11px] font-bold uppercase tracking-wider">Device</span>
            </div>
            <div className="p-3 space-y-2">
              <select
                value={selectedDevice || ''}
                onChange={(e) => onSelectDevice(e.target.value)}
                className="w-full bg-black border border-border rounded-lg px-3 py-2.5 text-xs text-white focus:outline-none focus:border-accent-cyan transition-colors appearance-none cursor-pointer"
              >
                <option value="">Select MIDI Device...</option>
                {devices.map(d => (
                  <option key={d.id} value={d.id}>{d.name} ({d.manufacturer})</option>
                ))}
              </select>
              {devices.length === 0 && isInitialized && (
                <div className="text-[9px] text-gray-500 italic text-center">No MIDI devices detected</div>
              )}
            </div>
          </div>

          {/* Mapping List */}
          <div className="rack-module">
            <div className="bg-gray-800/50 p-2 border-b border-border flex items-center justify-between">
              <span className="text-[11px] font-bold uppercase tracking-wider">Mappings</span>
              <span className="text-[9px] text-gray-500 font-mono">{mappings.length}</span>
            </div>
            <div className="p-2 space-y-0.5 max-h-48 overflow-y-auto custom-scrollbar">
              {/* Table Header */}
              <div className="grid grid-cols-[40px_60px_1fr_50px_50px] gap-1 px-2 py-1 text-[8px] text-gray-600 uppercase font-bold border-b border-border/30">
                <span>Ch</span>
                <span>Note/CC</span>
                <span>Action</span>
                <span>Type</span>
                <span></span>
              </div>
              {mappings.length === 0 && (
                <div className="text-[9px] text-gray-600 italic p-4 text-center border border-dashed border-white/5 rounded mt-1">
                  No mappings configured
                </div>
              )}
              {mappings.map(mapping => (
                <div
                  key={mapping.id}
                  className="grid grid-cols-[40px_60px_1fr_50px_50px] gap-1 px-2 py-1.5 rounded-sm hover:bg-white/5 transition-colors items-center group"
                >
                  <span className="text-[10px] font-mono text-gray-400">{mapping.channel}</span>
                  <span className="text-[10px] font-mono text-white">
                    {mapping.note != null ? `N${mapping.note}` : mapping.cc != null ? `CC${mapping.cc}` : '-'}
                  </span>
                  <span className="text-[10px] text-gray-300 truncate">{mapping.action}</span>
                  <span className={`text-[8px] px-1 py-0.5 rounded font-bold uppercase text-center ${
                    mapping.type === 'button'
                      ? 'bg-accent-cyan/10 text-accent-cyan'
                      : 'bg-yellow-400/10 text-yellow-400'
                  }`}>
                    {mapping.type}
                  </span>
                  <button
                    onClick={() => {
                      if (isLearning) {
                        onStopLearn(mapping.action);
                      } else {
                        onStartLearn(mapping.action);
                      }
                    }}
                    className={`text-[8px] px-1.5 py-1 rounded border font-bold uppercase transition-all ${
                      isLearning
                        ? 'border-accent-cyan/50 text-accent-cyan bg-accent-cyan/10'
                        : 'border-border text-gray-500 hover:text-white hover:bg-white/5'
                    }`}
                  >
                    Learn
                  </button>
                </div>
              ))}
            </div>
          </div>

          {/* Quick Assign */}
          <div className="rack-module">
            <div className="bg-gray-800/50 p-2 border-b border-border">
              <span className="text-[11px] font-bold uppercase tracking-wider">Quick Assign</span>
            </div>
            <div className="p-3">
              <div className="grid grid-cols-3 gap-1.5">
                {QUICK_ACTIONS.map(action => (
                  <button
                    key={action}
                    onClick={() => onStartLearn(action)}
                    disabled={!selectedDevice}
                    className="btn-hardware text-[8px] py-2 font-bold disabled:opacity-30 hover:border-accent-cyan hover:text-accent-cyan transition-all"
                  >
                    {action}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  </div>
);
