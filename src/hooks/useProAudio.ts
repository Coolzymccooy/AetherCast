import { useState, useEffect, useRef, useCallback } from 'react';
import { ProAudioProcessor } from '../lib/audioProcessing';
import { audioEngine } from '../lib/audioEngine';
import type { NoiseGateConfig, CompressorConfig, EQConfig, LimiterConfig, LoudnessReading } from '../types';

const STORAGE_KEY = 'aether_audio_processing';

const DEFAULT_NOISE_GATE: NoiseGateConfig = { threshold: -40, attack: 0.001, release: 0.05, enabled: false };
const DEFAULT_COMPRESSOR: CompressorConfig = { threshold: -24, ratio: 4, attack: 0.003, release: 0.25, knee: 10, makeupGain: 0, enabled: true };
const DEFAULT_EQ: EQConfig = { lowGain: 0, lowFreq: 150, midGain: 0, midFreq: 1000, highGain: 0, highFreq: 8000, enabled: false };
const DEFAULT_LIMITER: LimiterConfig = { threshold: -1, release: 0.05, enabled: true };

interface SavedAudioConfig {
  noiseGate: Record<string, NoiseGateConfig>;
  compressor: Record<string, CompressorConfig>;
  eq: Record<string, EQConfig>;
  masterLimiter: LimiterConfig;
}

function loadSavedConfig(): SavedAudioConfig | null {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    return saved ? JSON.parse(saved) : null;
  } catch { return null; }
}

function saveConfig(config: SavedAudioConfig) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
  } catch { /* localStorage full — non-critical */ }
}

export function useProAudio() {
  const processorRef = useRef<ProAudioProcessor | null>(null);
  const initializedRef = useRef(false);
  const [loudness, setLoudness] = useState<LoudnessReading>({ momentary: -Infinity, shortTerm: -Infinity, integrated: -Infinity, range: 0, truePeak: -Infinity });
  const [channelMeters, setChannelMeters] = useState<Record<string, { peak: number; rms: number }>>({});

  // Load saved configs or use defaults
  const saved = loadSavedConfig();
  const [noiseGateConfigs, setNoiseGateConfigs] = useState<Record<string, NoiseGateConfig>>(saved?.noiseGate || {});
  const [compressorConfigs, setCompressorConfigs] = useState<Record<string, CompressorConfig>>(saved?.compressor || {});
  const [eqConfigs, setEQConfigs] = useState<Record<string, EQConfig>>(saved?.eq || {});
  const [masterLimiter, setMasterLimiter] = useState<LimiterConfig>(saved?.masterLimiter || DEFAULT_LIMITER);

  // Initialize processor — connects to audio engine's context
  // Uses a polling approach since audioEngine.context is set lazily
  useEffect(() => {
    const tryInit = () => {
      if (initializedRef.current) return;
      if (!audioEngine.context) return;

      const processor = new ProAudioProcessor(audioEngine.context);
      processorRef.current = processor;
      initializedRef.current = true;

      // Apply master limiter (always on by default for broadcast safety)
      processor.setMasterLimiter(masterLimiter);

      // Apply any saved per-channel configs
      for (const [id, config] of Object.entries(noiseGateConfigs)) {
        processor.setNoiseGate(id, config);
      }
      for (const [id, config] of Object.entries(compressorConfigs)) {
        processor.setCompressor(id, config);
      }
      for (const [id, config] of Object.entries(eqConfigs)) {
        processor.setEQ(id, config);
      }
    };

    // Try immediately, then poll until context is available
    tryInit();
    const pollInterval = setInterval(tryInit, 500);

    // LUFS tap retry — keeps trying until audio engine has audio tracks
    let lufsTapInterval: ReturnType<typeof setInterval> | null = null;
    let lufsTapDone = false;
    lufsTapInterval = setInterval(() => {
      if (lufsTapDone || !processorRef.current || !audioEngine.context || !audioEngine.destination) return;
      try {
        const mixedStream = audioEngine.destination.stream;
        if (mixedStream && mixedStream.getAudioTracks().length > 0) {
          const tapSource = audioEngine.context.createMediaStreamSource(mixedStream);
          tapSource.connect(processorRef.current.getMasterInput());
          lufsTapDone = true;
          console.log('[ProAudio] LUFS metering connected');
          if (lufsTapInterval) clearInterval(lufsTapInterval);
        }
      } catch {}
    }, 2000);

    // Poll meters at 10Hz
    const meterInterval = setInterval(() => {
      if (processorRef.current) {
        setLoudness(processorRef.current.getLoudness());
        setChannelMeters(processorRef.current.getChannelMeters());
      }
    }, 100);

    return () => {
      clearInterval(pollInterval);
      clearInterval(meterInterval);
      if (lufsTapInterval) clearInterval(lufsTapInterval);
      if (processorRef.current) {
        processorRef.current.destroy();
        processorRef.current = null;
        initializedRef.current = false;
      }
    };
  }, []);

  // Persist configs whenever they change
  useEffect(() => {
    saveConfig({ noiseGate: noiseGateConfigs, compressor: compressorConfigs, eq: eqConfigs, masterLimiter });
  }, [noiseGateConfigs, compressorConfigs, eqConfigs, masterLimiter]);

  const setChannelNoiseGate = useCallback((channelId: string, config: Partial<NoiseGateConfig>) => {
    setNoiseGateConfigs(prev => {
      const merged = { ...(prev[channelId] || DEFAULT_NOISE_GATE), ...config };
      processorRef.current?.setNoiseGate(channelId, merged);
      return { ...prev, [channelId]: merged };
    });
  }, []);

  const setChannelCompressor = useCallback((channelId: string, config: Partial<CompressorConfig>) => {
    setCompressorConfigs(prev => {
      const merged = { ...(prev[channelId] || DEFAULT_COMPRESSOR), ...config };
      processorRef.current?.setCompressor(channelId, merged);
      return { ...prev, [channelId]: merged };
    });
  }, []);

  const setChannelEQ = useCallback((channelId: string, config: Partial<EQConfig>) => {
    setEQConfigs(prev => {
      const merged = { ...(prev[channelId] || DEFAULT_EQ), ...config };
      processorRef.current?.setEQ(channelId, merged);
      return { ...prev, [channelId]: merged };
    });
  }, []);

  const updateMasterLimiter = useCallback((config: Partial<LimiterConfig>) => {
    setMasterLimiter(prev => {
      const merged = { ...prev, ...config };
      processorRef.current?.setMasterLimiter(merged);
      return merged;
    });
  }, []);

  return {
    loudness, channelMeters,
    noiseGateConfigs, setChannelNoiseGate,
    compressorConfigs, setChannelCompressor,
    eqConfigs, setChannelEQ,
    masterLimiter, updateMasterLimiter,
    processor: processorRef,
    isInitialized: initializedRef.current,
  };
}
