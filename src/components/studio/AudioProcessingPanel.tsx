import React, { useState } from 'react';
import { Activity, ChevronDown, ChevronRight } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

interface NoiseGateConfig {
  enabled: boolean;
  threshold: number;
  attack: number;
  release: number;
}

interface CompressorConfig {
  enabled: boolean;
  threshold: number;
  ratio: number;
  attack: number;
  release: number;
  knee: number;
  makeupGain: number;
}

interface EQBand {
  gain: number;
  frequency: number;
}

interface EQConfig {
  enabled: boolean;
  low: EQBand;
  mid: EQBand;
  high: EQBand;
}

interface Props {
  channels: Array<{ name: string }>;
  loudness: { momentary: number; shortTerm: number; integrated: number; range: number; truePeak: number };
  channelMeters: Record<string, { peak: number; rms: number }>;
  onSetNoiseGate: (channelId: string, config: Partial<NoiseGateConfig>) => void;
  onSetCompressor: (channelId: string, config: Partial<CompressorConfig>) => void;
  onSetEQ: (channelId: string, config: Partial<EQConfig>) => void;
  onSetMasterLimiter: (config: Partial<{ enabled: boolean; threshold: number; release: number }>) => void;
}

const lufsColor = (value: number) => {
  if (value > -10) return 'bg-accent-red';
  if (value > -14) return 'bg-yellow-400';
  return 'bg-accent-green';
};

const lufsWidth = (value: number) => {
  const clamped = Math.max(-60, Math.min(0, value));
  return ((clamped + 60) / 60) * 100;
};

const CollapsibleSection: React.FC<{ title: string; defaultOpen?: boolean; children: React.ReactNode }> = ({ title, defaultOpen = false, children }) => {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border border-border rounded-sm overflow-hidden">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center gap-2 p-2 bg-gray-800/50 hover:bg-white/5 transition-colors text-[10px] font-bold uppercase tracking-wider text-gray-400"
      >
        {open ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
        {title}
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="p-3 space-y-3">{children}</div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

const Toggle: React.FC<{ enabled: boolean; onChange: (v: boolean) => void }> = ({ enabled, onChange }) => (
  <button
    onClick={() => onChange(!enabled)}
    className={`w-8 h-4 rounded-full p-0.5 transition-all ${enabled ? 'bg-accent-cyan' : 'bg-gray-700'}`}
  >
    <motion.div
      className="w-3 h-3 bg-white rounded-full shadow-lg"
      animate={{ x: enabled ? 16 : 0 }}
      transition={{ type: 'spring', stiffness: 500, damping: 30 }}
    />
  </button>
);

const SliderRow: React.FC<{ label: string; value: number; min: number; max: number; step: number; unit?: string; onChange: (v: number) => void }> = ({ label, value, min, max, step, unit = '', onChange }) => (
  <div className="space-y-1">
    <div className="flex justify-between text-[9px] text-gray-500 uppercase">
      <span>{label}</span>
      <span className="font-mono">{value.toFixed(step < 1 ? 3 : 0)}{unit}</span>
    </div>
    <input
      type="range"
      min={min}
      max={max}
      step={step}
      value={value}
      onChange={(e) => onChange(parseFloat(e.target.value))}
      className="w-full accent-accent-cyan h-1 bg-gray-800 rounded-lg appearance-none cursor-pointer"
    />
  </div>
);

export const AudioProcessingPanel: React.FC<Props> = ({
  channels,
  loudness,
  channelMeters,
  onSetNoiseGate,
  onSetCompressor,
  onSetEQ,
  onSetMasterLimiter,
}) => {
  const [expandedChannel, setExpandedChannel] = useState<string | null>(null);
  const [gateConfigs, setGateConfigs] = useState<Record<string, NoiseGateConfig>>({});
  const [compConfigs, setCompConfigs] = useState<Record<string, CompressorConfig>>({});
  const [eqConfigs, setEqConfigs] = useState<Record<string, EQConfig>>({});
  const [limiterEnabled, setLimiterEnabled] = useState(false);
  const [limiterThreshold, setLimiterThreshold] = useState(-3);
  const [limiterRelease, setLimiterRelease] = useState(0.1);

  const getGate = (ch: string): NoiseGateConfig => gateConfigs[ch] || { enabled: false, threshold: -40, attack: 0.01, release: 0.1 };
  const getComp = (ch: string): CompressorConfig => compConfigs[ch] || { enabled: false, threshold: -24, ratio: 4, attack: 0.01, release: 0.1, knee: 10, makeupGain: 0 };
  const getEQ = (ch: string): EQConfig => eqConfigs[ch] || { enabled: false, low: { gain: 0, frequency: 200 }, mid: { gain: 0, frequency: 1000 }, high: { gain: 0, frequency: 8000 } };

  const updateGate = (ch: string, patch: Partial<NoiseGateConfig>) => {
    const updated = { ...getGate(ch), ...patch };
    setGateConfigs(prev => ({ ...prev, [ch]: updated }));
    onSetNoiseGate(ch, patch);
  };

  const updateComp = (ch: string, patch: Partial<CompressorConfig>) => {
    const updated = { ...getComp(ch), ...patch };
    setCompConfigs(prev => ({ ...prev, [ch]: updated }));
    onSetCompressor(ch, patch);
  };

  const updateEQ = (ch: string, patch: Partial<EQConfig>) => {
    const updated = { ...getEQ(ch), ...patch };
    setEqConfigs(prev => ({ ...prev, [ch]: updated }));
    onSetEQ(ch, patch);
  };

  return (
    <div className="flex flex-col h-full">
      <div className="p-3 border-b border-border flex items-center gap-2 bg-white/5">
        <Activity size={14} className="text-accent-cyan" />
        <h3 className="text-[10px] font-bold uppercase tracking-widest text-gray-500">Pro Audio</h3>
      </div>

      <div className="flex-1 overflow-y-auto custom-scrollbar p-3 space-y-4">
        {/* LUFS Meter Section */}
        <div className="rack-module">
          <div className="bg-gray-800/50 p-2 border-b border-border flex items-center gap-2">
            <span className="text-[11px] font-bold uppercase tracking-wider">LUFS Meter</span>
          </div>
          <div className="p-3 space-y-3">
            {[
              { label: 'Momentary', value: loudness.momentary },
              { label: 'Short-Term', value: loudness.shortTerm },
              { label: 'Integrated', value: loudness.integrated },
            ].map(({ label, value }) => (
              <div key={label} className="space-y-1">
                <div className="flex justify-between text-[9px] uppercase">
                  <span className="text-gray-500">{label}</span>
                  <span className="font-mono text-white">{value.toFixed(1)} LUFS</span>
                </div>
                <div className="h-2 bg-black rounded-sm relative overflow-hidden">
                  <motion.div
                    className={`h-full ${lufsColor(value)} rounded-sm`}
                    initial={{ width: 0 }}
                    animate={{ width: `${lufsWidth(value)}%` }}
                    transition={{ duration: 0.15 }}
                  />
                </div>
              </div>
            ))}
            <div className="flex justify-between pt-2 border-t border-border/50">
              <div className="text-[9px]">
                <span className="text-gray-500 uppercase">True Peak </span>
                <span className={`font-mono font-bold ${loudness.truePeak > -1 ? 'text-accent-red' : 'text-white'}`}>
                  {loudness.truePeak.toFixed(1)} dBTP
                </span>
              </div>
              <div className="text-[9px]">
                <span className="text-gray-500 uppercase">Range </span>
                <span className="font-mono font-bold text-white">{loudness.range.toFixed(1)} LU</span>
              </div>
            </div>
          </div>
        </div>

        {/* Per-Channel Sections */}
        {channels.map(ch => {
          const isExpanded = expandedChannel === ch.name;
          const meter = channelMeters[ch.name] || { peak: 0, rms: 0 };
          const gate = getGate(ch.name);
          const comp = getComp(ch.name);
          const eq = getEQ(ch.name);

          return (
            <div key={ch.name} className="rack-module">
              <button
                onClick={() => setExpandedChannel(isExpanded ? null : ch.name)}
                className="w-full bg-gray-800/50 p-2 border-b border-border flex items-center justify-between hover:bg-white/5 transition-colors"
              >
                <div className="flex items-center gap-2">
                  {isExpanded ? <ChevronDown size={10} className="text-gray-400" /> : <ChevronRight size={10} className="text-gray-400" />}
                  <span className="text-[11px] font-bold uppercase tracking-wider">{ch.name}</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="w-16 h-1.5 bg-black rounded-sm overflow-hidden">
                    <motion.div
                      className="h-full bg-gradient-to-r from-accent-green via-yellow-400 to-accent-red"
                      animate={{ width: `${meter.rms * 100}%` }}
                      transition={{ duration: 0.1 }}
                    />
                  </div>
                  <span className="text-[8px] font-mono text-gray-500">{(meter.peak * 100).toFixed(0)}%</span>
                </div>
              </button>

              <AnimatePresence>
                {isExpanded && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.2 }}
                    className="overflow-hidden"
                  >
                    <div className="p-3 space-y-3">
                      {/* Noise Gate */}
                      <CollapsibleSection title="Noise Gate">
                        <div className="flex items-center justify-between mb-2">
                          <span className="text-[9px] text-gray-500 uppercase">Enable</span>
                          <Toggle enabled={gate.enabled} onChange={(v) => updateGate(ch.name, { enabled: v })} />
                        </div>
                        <SliderRow label="Threshold" value={gate.threshold} min={-60} max={0} step={1} unit=" dB" onChange={(v) => updateGate(ch.name, { threshold: v })} />
                        <SliderRow label="Attack" value={gate.attack} min={0.001} max={0.1} step={0.001} unit="s" onChange={(v) => updateGate(ch.name, { attack: v })} />
                        <SliderRow label="Release" value={gate.release} min={0.01} max={0.5} step={0.01} unit="s" onChange={(v) => updateGate(ch.name, { release: v })} />
                      </CollapsibleSection>

                      {/* Compressor */}
                      <CollapsibleSection title="Compressor">
                        <div className="flex items-center justify-between mb-2">
                          <span className="text-[9px] text-gray-500 uppercase">Enable</span>
                          <Toggle enabled={comp.enabled} onChange={(v) => updateComp(ch.name, { enabled: v })} />
                        </div>
                        <SliderRow label="Threshold" value={comp.threshold} min={-60} max={0} step={1} unit=" dB" onChange={(v) => updateComp(ch.name, { threshold: v })} />
                        <SliderRow label="Ratio" value={comp.ratio} min={1} max={20} step={0.5} unit=":1" onChange={(v) => updateComp(ch.name, { ratio: v })} />
                        <SliderRow label="Attack" value={comp.attack} min={0.001} max={0.1} step={0.001} unit="s" onChange={(v) => updateComp(ch.name, { attack: v })} />
                        <SliderRow label="Release" value={comp.release} min={0.01} max={1} step={0.01} unit="s" onChange={(v) => updateComp(ch.name, { release: v })} />
                        <SliderRow label="Knee" value={comp.knee} min={0} max={40} step={1} unit=" dB" onChange={(v) => updateComp(ch.name, { knee: v })} />
                        <SliderRow label="Makeup Gain" value={comp.makeupGain} min={0} max={24} step={0.5} unit=" dB" onChange={(v) => updateComp(ch.name, { makeupGain: v })} />
                      </CollapsibleSection>

                      {/* 3-Band EQ */}
                      <CollapsibleSection title="3-Band EQ">
                        <div className="flex items-center justify-between mb-2">
                          <span className="text-[9px] text-gray-500 uppercase">Enable</span>
                          <Toggle enabled={eq.enabled} onChange={(v) => updateEQ(ch.name, { enabled: v })} />
                        </div>
                        {(['low', 'mid', 'high'] as const).map(band => (
                          <div key={band} className="space-y-2 pt-2 border-t border-border/30">
                            <span className="text-[9px] font-bold uppercase text-accent-cyan">{band}</span>
                            <SliderRow
                              label="Gain"
                              value={eq[band].gain}
                              min={-12}
                              max={12}
                              step={0.5}
                              unit=" dB"
                              onChange={(v) => updateEQ(ch.name, { [band]: { ...eq[band], gain: v } } as Partial<EQConfig>)}
                            />
                            <div className="space-y-1">
                              <div className="flex justify-between text-[9px] text-gray-500 uppercase">
                                <span>Frequency</span>
                              </div>
                              <input
                                type="number"
                                value={eq[band].frequency}
                                onChange={(e) => updateEQ(ch.name, { [band]: { ...eq[band], frequency: parseInt(e.target.value) || 0 } } as Partial<EQConfig>)}
                                className="w-full bg-black border border-border rounded px-2 py-1 text-[10px] text-white focus:outline-none focus:border-accent-cyan transition-colors font-mono"
                              />
                            </div>
                          </div>
                        ))}
                      </CollapsibleSection>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          );
        })}

        {/* Master Limiter */}
        <div className="rack-module">
          <div className="bg-gray-800/50 p-2 border-b border-border flex items-center gap-2">
            <span className="text-[11px] font-bold uppercase tracking-wider">Master Limiter</span>
          </div>
          <div className="p-3 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-[9px] text-gray-500 uppercase">Enable</span>
              <Toggle
                enabled={limiterEnabled}
                onChange={(v) => {
                  setLimiterEnabled(v);
                  onSetMasterLimiter({ enabled: v });
                }}
              />
            </div>
            <SliderRow
              label="Threshold"
              value={limiterThreshold}
              min={-12}
              max={0}
              step={0.5}
              unit=" dB"
              onChange={(v) => {
                setLimiterThreshold(v);
                onSetMasterLimiter({ threshold: v });
              }}
            />
            <SliderRow
              label="Release"
              value={limiterRelease}
              min={0.01}
              max={1}
              step={0.01}
              unit="s"
              onChange={(v) => {
                setLimiterRelease(v);
                onSetMasterLimiter({ release: v });
              }}
            />
          </div>
        </div>
      </div>
    </div>
  );
};
