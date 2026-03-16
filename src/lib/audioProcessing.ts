// audioProcessing.ts — Professional broadcast audio processing chain
// Extends the audio engine with noise gate, compressor, EQ, limiter, and LUFS metering.

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface NoiseGateConfig {
  threshold: number;   // dB, e.g. -40
  attack: number;      // seconds, e.g. 0.001
  release: number;     // seconds, e.g. 0.05
  enabled: boolean;
}

export interface CompressorConfig {
  threshold: number;   // dB, e.g. -24
  ratio: number;       // e.g. 4
  attack: number;      // seconds
  release: number;     // seconds
  knee: number;        // dB
  makeupGain: number;  // dB
  enabled: boolean;
}

export interface EQConfig {
  lowGain: number;     // dB (-12 to +12)
  lowFreq: number;     // Hz (80-300)
  midGain: number;     // dB
  midFreq: number;     // Hz (500-4000)
  highGain: number;    // dB
  highFreq: number;    // Hz (4000-12000)
  enabled: boolean;
}

export interface LimiterConfig {
  threshold: number;   // dB, e.g. -1
  release: number;     // seconds
  enabled: boolean;
}

export interface LoudnessReading {
  momentary: number;   // LUFS, 400ms window
  shortTerm: number;   // LUFS, 3s window
  integrated: number;  // LUFS, from start
  range: number;       // LU
  truePeak: number;    // dBTP
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

const DB_TO_LINEAR = (db: number): number => Math.pow(10, db / 20);
const LINEAR_TO_DB = (lin: number): number => 20 * Math.log10(Math.max(lin, 1e-10));

const DEFAULT_NOISE_GATE: NoiseGateConfig = {
  threshold: -40,
  attack: 0.001,
  release: 0.05,
  enabled: true,
};

const DEFAULT_COMPRESSOR: CompressorConfig = {
  threshold: -24,
  ratio: 4,
  attack: 0.003,
  release: 0.25,
  knee: 6,
  makeupGain: 0,
  enabled: true,
};

const DEFAULT_EQ: EQConfig = {
  lowGain: 0,
  lowFreq: 150,
  midGain: 0,
  midFreq: 1000,
  highGain: 0,
  highFreq: 8000,
  enabled: true,
};

const DEFAULT_MASTER_COMPRESSOR: CompressorConfig = {
  threshold: -18,
  ratio: 3,
  attack: 0.01,
  release: 0.15,
  knee: 6,
  makeupGain: 0,
  enabled: true,
};

const DEFAULT_LIMITER: LimiterConfig = {
  threshold: -1,
  release: 0.05,
  enabled: true,
};

// Hysteresis for noise gate (dB above threshold to open)
const GATE_HYSTERESIS_DB = 3;

// LUFS constant: -0.691 + 10 * log10(mean_square)
const LUFS_OFFSET = -0.691;

// ---------------------------------------------------------------------------
// Channel processing chain
// ---------------------------------------------------------------------------

interface ChannelChain {
  input: GainNode;
  gateAnalyser: AnalyserNode;
  gateGain: GainNode;
  compressor: DynamicsCompressorNode;
  makeupGain: GainNode;
  eqLow: BiquadFilterNode;
  eqMid: BiquadFilterNode;
  eqHigh: BiquadFilterNode;
  channelGain: GainNode;
  analyser: AnalyserNode;

  gateConfig: NoiseGateConfig;
  compressorConfig: CompressorConfig;
  eqConfig: EQConfig;
  gateOpen: boolean;
}

// ---------------------------------------------------------------------------
// LUFS metering state
// ---------------------------------------------------------------------------

interface LufsMeterState {
  kWeightHigh: BiquadFilterNode;
  kWeightLow: BiquadFilterNode;
  analyser: AnalyserNode;

  // Ring buffers for windowed measurement (samples at ~23 Hz poll rate)
  momentaryBuffer: Float32Array;   // ~400ms of squared-mean snapshots
  shortTermBuffer: Float32Array;   // ~3s
  momentaryIdx: number;
  shortTermIdx: number;
  momentaryFilled: boolean;
  shortTermFilled: boolean;

  // Integrated loudness (EBU R128 gating)
  integratedSum: number;
  integratedCount: number;
  gatingBlockSums: number[];

  // True peak tracking
  truePeakMax: number;
}

// ---------------------------------------------------------------------------
// ProAudioProcessor
// ---------------------------------------------------------------------------

export class ProAudioProcessor {
  private ctx: AudioContext;
  private channels: Map<string, ChannelChain> = new Map();

  // Master bus nodes
  private masterInput: GainNode;
  private masterCompressor: DynamicsCompressorNode;
  private masterCompressorMakeup: GainNode;
  private masterLimiter: DynamicsCompressorNode;
  private masterAnalyser: AnalyserNode;
  private masterOutput: GainNode;

  // Master configs
  private masterCompressorConfig: CompressorConfig;
  private masterLimiterConfig: LimiterConfig;

  // LUFS metering
  private lufs: LufsMeterState;

  // Polling
  private pollHandle: number | null = null;
  private destroyed = false;

  // Scratch buffers (reused to avoid GC pressure)
  private scratchFloat32: Float32Array;

  constructor(context: AudioContext) {
    this.ctx = context;

    // -- Master bus ----------------------------------------------------------
    this.masterInput = this.ctx.createGain();
    this.masterInput.gain.value = 1;

    this.masterCompressor = this.ctx.createDynamicsCompressor();
    this.masterCompressorMakeup = this.ctx.createGain();
    this.masterCompressorConfig = { ...DEFAULT_MASTER_COMPRESSOR };

    this.masterLimiter = this.ctx.createDynamicsCompressor();
    this.masterLimiterConfig = { ...DEFAULT_LIMITER, ratio: 20, attack: 0.001, release: DEFAULT_LIMITER.release, knee: 0 } as any;

    this.masterAnalyser = this.ctx.createAnalyser();
    this.masterAnalyser.fftSize = 2048;

    this.masterOutput = this.ctx.createGain();
    this.masterOutput.gain.value = 1;

    this.applyMasterCompressor();
    this.applyMasterLimiter();

    // Wire master bus: input → compressor → makeup → limiter → analyser → output
    this.masterInput.connect(this.masterCompressor);
    this.masterCompressor.connect(this.masterCompressorMakeup);
    this.masterCompressorMakeup.connect(this.masterLimiter);
    this.masterLimiter.connect(this.masterAnalyser);
    this.masterAnalyser.connect(this.masterOutput);

    // -- LUFS meter ----------------------------------------------------------
    this.lufs = this.createLufsMeter();

    // Connect master output to LUFS metering side-chain
    this.masterOutput.connect(this.lufs.kWeightHigh);

    // Scratch buffer for analyser reads
    this.scratchFloat32 = new Float32Array(this.masterAnalyser.fftSize);

    // Start polling loop
    this.startPolling();
  }

  // =========================================================================
  // Channel management
  // =========================================================================

  /**
   * Create a processing chain for a channel.
   * Returns the input GainNode — connect your source to this node.
   */
  createChannel(id: string): AudioNode {
    if (this.channels.has(id)) {
      return this.channels.get(id)!.input;
    }

    const input = this.ctx.createGain();
    input.gain.value = 1;

    // Noise gate: analyser to measure level, gain to gate the signal
    const gateAnalyser = this.ctx.createAnalyser();
    gateAnalyser.fftSize = 256;
    const gateGain = this.ctx.createGain();
    gateGain.gain.value = 1;

    // Compressor
    const compressor = this.ctx.createDynamicsCompressor();
    const makeupGain = this.ctx.createGain();
    makeupGain.gain.value = 1;

    // EQ — 3-band
    const eqLow = this.ctx.createBiquadFilter();
    eqLow.type = 'lowshelf';
    const eqMid = this.ctx.createBiquadFilter();
    eqMid.type = 'peaking';
    eqMid.Q.value = 1.4; // moderate width
    const eqHigh = this.ctx.createBiquadFilter();
    eqHigh.type = 'highshelf';

    // Output gain + analyser
    const channelGain = this.ctx.createGain();
    channelGain.gain.value = 1;
    const analyser = this.ctx.createAnalyser();
    analyser.fftSize = 2048;

    // Wire: input → gateAnalyser (side-chain tap)
    //        input → gateGain → compressor → makeupGain → eqLow → eqMid → eqHigh → channelGain → analyser → masterInput
    input.connect(gateAnalyser);          // side-chain tap (no audio output)
    input.connect(gateGain);
    gateGain.connect(compressor);
    compressor.connect(makeupGain);
    makeupGain.connect(eqLow);
    eqLow.connect(eqMid);
    eqMid.connect(eqHigh);
    eqHigh.connect(channelGain);
    channelGain.connect(analyser);
    analyser.connect(this.masterInput);

    const chain: ChannelChain = {
      input,
      gateAnalyser,
      gateGain,
      compressor,
      makeupGain,
      eqLow,
      eqMid,
      eqHigh,
      channelGain,
      analyser,
      gateConfig: { ...DEFAULT_NOISE_GATE },
      compressorConfig: { ...DEFAULT_COMPRESSOR },
      eqConfig: { ...DEFAULT_EQ },
      gateOpen: true,
    };

    this.applyCompressorConfig(compressor, makeupGain, chain.compressorConfig);
    this.applyEQConfig(chain);

    this.channels.set(id, chain);
    return input;
  }

  /**
   * Remove a channel's entire processing chain.
   */
  removeChannel(id: string): void {
    const chain = this.channels.get(id);
    if (!chain) return;

    chain.input.disconnect();
    chain.gateAnalyser.disconnect();
    chain.gateGain.disconnect();
    chain.compressor.disconnect();
    chain.makeupGain.disconnect();
    chain.eqLow.disconnect();
    chain.eqMid.disconnect();
    chain.eqHigh.disconnect();
    chain.channelGain.disconnect();
    chain.analyser.disconnect();

    this.channels.delete(id);
  }

  // =========================================================================
  // Per-channel configuration
  // =========================================================================

  setNoiseGate(id: string, config: NoiseGateConfig): void {
    const chain = this.channels.get(id);
    if (!chain) return;
    chain.gateConfig = { ...config };

    if (!config.enabled) {
      // Bypass: ensure gate is fully open
      chain.gateGain.gain.setTargetAtTime(1, this.ctx.currentTime, 0.005);
      chain.gateOpen = true;
    }
  }

  setCompressor(id: string, config: CompressorConfig): void {
    const chain = this.channels.get(id);
    if (!chain) return;
    chain.compressorConfig = { ...config };
    this.applyCompressorConfig(chain.compressor, chain.makeupGain, config);
  }

  setEQ(id: string, config: EQConfig): void {
    const chain = this.channels.get(id);
    if (!chain) return;
    chain.eqConfig = { ...config };
    this.applyEQConfig(chain);
  }

  // =========================================================================
  // Master bus configuration
  // =========================================================================

  setMasterCompressor(config: CompressorConfig): void {
    this.masterCompressorConfig = { ...config };
    this.applyMasterCompressor();
  }

  setMasterLimiter(config: LimiterConfig): void {
    this.masterLimiterConfig = { ...config };
    this.applyMasterLimiter();
  }

  /**
   * Returns the master output node. Connect this to your AudioContext.destination
   * or a MediaStreamDestination.
   */
  getMasterOutput(): AudioNode {
    return this.masterOutput;
  }

  /**
   * Returns the master input node. Connect external audio sources to this
   * for processing and LUFS metering.
   */
  getMasterInput(): AudioNode {
    return this.masterInput;
  }

  // =========================================================================
  // Metering
  // =========================================================================

  /**
   * Returns the latest LUFS loudness readings (EBU R128).
   */
  getLoudness(): LoudnessReading {
    const m = this.lufs;

    // Momentary (~400ms window)
    const momentary = this.computeWindowedLUFS(
      m.momentaryBuffer,
      m.momentaryIdx,
      m.momentaryFilled,
    );

    // Short-term (~3s window)
    const shortTerm = this.computeWindowedLUFS(
      m.shortTermBuffer,
      m.shortTermIdx,
      m.shortTermFilled,
    );

    // Integrated (gated)
    const integrated = this.computeIntegratedLUFS();

    // Range (simplified: difference between 10th and 95th percentile of short-term blocks)
    const range = this.computeLoudnessRange();

    // True peak
    const truePeak = m.truePeakMax > 0
      ? LINEAR_TO_DB(m.truePeakMax)
      : -Infinity;

    return { momentary, shortTerm, integrated, range, truePeak };
  }

  /**
   * Returns peak and RMS levels per channel (in dB).
   */
  getChannelMeters(): Record<string, { peak: number; rms: number }> {
    const result: Record<string, { peak: number; rms: number }> = {};

    this.channels.forEach((chain, id) => {
      const bufLen = chain.analyser.fftSize;
      // Ensure scratch buffer is large enough
      if (this.scratchFloat32.length < bufLen) {
        this.scratchFloat32 = new Float32Array(bufLen);
      }
      const buf = this.scratchFloat32.subarray(0, bufLen);
      chain.analyser.getFloatTimeDomainData(buf);

      let peak = 0;
      let sumSq = 0;
      for (let i = 0; i < bufLen; i++) {
        const s = buf[i];
        const abs = Math.abs(s);
        if (abs > peak) peak = abs;
        sumSq += s * s;
      }
      const rms = Math.sqrt(sumSq / bufLen);

      result[id] = {
        peak: LINEAR_TO_DB(peak),
        rms: LINEAR_TO_DB(rms),
      };
    });

    return result;
  }

  // =========================================================================
  // Lifecycle
  // =========================================================================

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;

    this.stopPolling();

    // Disconnect all channels
    this.channels.forEach((_, id) => this.removeChannel(id));
    this.channels.clear();

    // Disconnect master bus
    this.masterInput.disconnect();
    this.masterCompressor.disconnect();
    this.masterCompressorMakeup.disconnect();
    this.masterLimiter.disconnect();
    this.masterAnalyser.disconnect();
    this.masterOutput.disconnect();

    // Disconnect LUFS meter
    this.lufs.kWeightHigh.disconnect();
    this.lufs.kWeightLow.disconnect();
    this.lufs.analyser.disconnect();
  }

  // =========================================================================
  // Private — apply configurations
  // =========================================================================

  private applyCompressorConfig(
    comp: DynamicsCompressorNode,
    makeup: GainNode,
    config: CompressorConfig,
  ): void {
    const now = this.ctx.currentTime;

    if (config.enabled) {
      comp.threshold.setTargetAtTime(config.threshold, now, 0.01);
      comp.ratio.setTargetAtTime(config.ratio, now, 0.01);
      comp.attack.setTargetAtTime(config.attack, now, 0.01);
      comp.release.setTargetAtTime(config.release, now, 0.01);
      comp.knee.setTargetAtTime(config.knee, now, 0.01);
      makeup.gain.setTargetAtTime(DB_TO_LINEAR(config.makeupGain), now, 0.01);
    } else {
      // Bypass: 0 dB threshold, 1:1 ratio equivalent — set threshold very high
      comp.threshold.setTargetAtTime(0, now, 0.01);
      comp.ratio.setTargetAtTime(1, now, 0.01);
      makeup.gain.setTargetAtTime(1, now, 0.01);
    }
  }

  private applyEQConfig(chain: ChannelChain): void {
    const { eqConfig, eqLow, eqMid, eqHigh } = chain;
    const now = this.ctx.currentTime;

    if (eqConfig.enabled) {
      eqLow.frequency.setTargetAtTime(eqConfig.lowFreq, now, 0.01);
      eqLow.gain.setTargetAtTime(eqConfig.lowGain, now, 0.01);

      eqMid.frequency.setTargetAtTime(eqConfig.midFreq, now, 0.01);
      eqMid.gain.setTargetAtTime(eqConfig.midGain, now, 0.01);

      eqHigh.frequency.setTargetAtTime(eqConfig.highFreq, now, 0.01);
      eqHigh.gain.setTargetAtTime(eqConfig.highGain, now, 0.01);
    } else {
      // Bypass: set all gains to 0 dB
      eqLow.gain.setTargetAtTime(0, now, 0.01);
      eqMid.gain.setTargetAtTime(0, now, 0.01);
      eqHigh.gain.setTargetAtTime(0, now, 0.01);
    }
  }

  private applyMasterCompressor(): void {
    this.applyCompressorConfig(
      this.masterCompressor,
      this.masterCompressorMakeup,
      this.masterCompressorConfig,
    );
  }

  private applyMasterLimiter(): void {
    const cfg = this.masterLimiterConfig;
    const now = this.ctx.currentTime;

    if (cfg.enabled) {
      this.masterLimiter.threshold.setTargetAtTime(cfg.threshold, now, 0.01);
      this.masterLimiter.ratio.setTargetAtTime(20, now, 0.01);        // brick wall
      this.masterLimiter.attack.setTargetAtTime(0.001, now, 0.01);    // fast attack
      this.masterLimiter.release.setTargetAtTime(cfg.release, now, 0.01);
      this.masterLimiter.knee.setTargetAtTime(0, now, 0.01);          // hard knee
    } else {
      this.masterLimiter.threshold.setTargetAtTime(0, now, 0.01);
      this.masterLimiter.ratio.setTargetAtTime(1, now, 0.01);
    }
  }

  // =========================================================================
  // Private — noise gate polling
  // =========================================================================

  private processGates(): void {
    const buf = new Float32Array(128); // small buffer for gate analysis

    this.channels.forEach((chain) => {
      if (!chain.gateConfig.enabled) return;

      const analyser = chain.gateAnalyser;
      const bufLen = Math.min(analyser.fftSize, buf.length);
      const data = buf.subarray(0, bufLen);
      analyser.getFloatTimeDomainData(data);

      // Compute RMS in dB
      let sumSq = 0;
      for (let i = 0; i < bufLen; i++) {
        sumSq += data[i] * data[i];
      }
      const rmsDb = LINEAR_TO_DB(Math.sqrt(sumSq / bufLen));

      const { threshold, attack, release } = chain.gateConfig;
      const now = this.ctx.currentTime;

      if (chain.gateOpen) {
        // Close if below threshold
        if (rmsDb < threshold) {
          chain.gateGain.gain.setTargetAtTime(0, now, release);
          chain.gateOpen = false;
        }
      } else {
        // Open if above threshold + hysteresis
        if (rmsDb > threshold + GATE_HYSTERESIS_DB) {
          chain.gateGain.gain.setTargetAtTime(1, now, attack);
          chain.gateOpen = true;
        }
      }
    });
  }

  // =========================================================================
  // Private — LUFS metering
  // =========================================================================

  private createLufsMeter(): LufsMeterState {
    // K-weighting filter chain: high shelf → high pass
    // Stage 1: High shelf at 1681 Hz, +4 dB
    const kWeightHigh = this.ctx.createBiquadFilter();
    kWeightHigh.type = 'highshelf';
    kWeightHigh.frequency.value = 1681;
    kWeightHigh.gain.value = 4;

    // Stage 2: High pass at 38 Hz (Q ≈ 0.5 for Butterworth-like response)
    const kWeightLow = this.ctx.createBiquadFilter();
    kWeightLow.type = 'highpass';
    kWeightLow.frequency.value = 38;
    kWeightLow.Q.value = 0.5;

    // Analyser after K-weighting
    const analyser = this.ctx.createAnalyser();
    analyser.fftSize = 2048;

    kWeightHigh.connect(kWeightLow);
    kWeightLow.connect(analyser);
    // Do not connect analyser output to anything — it is a measurement tap only

    // Poll rate ~23 Hz (every ~43ms). Momentary = 400ms ≈ 10 snapshots. Short-term = 3s ≈ 70 snapshots.
    const momentarySlots = 10;
    const shortTermSlots = 70;

    return {
      kWeightHigh,
      kWeightLow,
      analyser,
      momentaryBuffer: new Float32Array(momentarySlots),
      shortTermBuffer: new Float32Array(shortTermSlots),
      momentaryIdx: 0,
      shortTermIdx: 0,
      momentaryFilled: false,
      shortTermFilled: false,
      integratedSum: 0,
      integratedCount: 0,
      gatingBlockSums: [],
      truePeakMax: 0,
    };
  }

  private updateLufsMetering(): void {
    const m = this.lufs;
    const bufLen = m.analyser.fftSize;
    if (this.scratchFloat32.length < bufLen) {
      this.scratchFloat32 = new Float32Array(bufLen);
    }
    const buf = this.scratchFloat32.subarray(0, bufLen);
    m.analyser.getFloatTimeDomainData(buf);

    // Mean square of this snapshot
    let sumSq = 0;
    let peak = 0;
    for (let i = 0; i < bufLen; i++) {
      const s = buf[i];
      sumSq += s * s;
      const abs = Math.abs(s);
      if (abs > peak) peak = abs;
    }
    const meanSq = sumSq / bufLen;

    // True peak tracking (simplified — full 4x oversampling would require an
    // AudioWorklet; here we track the sample peak from the analyser, which is
    // a reasonable approximation for monitoring purposes)
    if (peak > m.truePeakMax) {
      m.truePeakMax = peak;
    }

    // Store mean-square in ring buffers
    m.momentaryBuffer[m.momentaryIdx] = meanSq;
    m.momentaryIdx = (m.momentaryIdx + 1) % m.momentaryBuffer.length;
    if (m.momentaryIdx === 0) m.momentaryFilled = true;

    m.shortTermBuffer[m.shortTermIdx] = meanSq;
    m.shortTermIdx = (m.shortTermIdx + 1) % m.shortTermBuffer.length;
    if (m.shortTermIdx === 0) m.shortTermFilled = true;

    // Integrated loudness — EBU R128 gating (simplified two-stage):
    // Accumulate blocks and apply absolute gate at -70 LUFS
    // Cap at 30-minute rolling window (~41,400 blocks at 23Hz) to prevent unbounded growth
    const MAX_INTEGRATED_BLOCKS = 41_400;
    const blockLUFS = LUFS_OFFSET + 10 * Math.log10(Math.max(meanSq, 1e-20));
    if (blockLUFS > -70) {
      m.gatingBlockSums.push(meanSq);
      m.integratedSum += meanSq;
      m.integratedCount++;

      // Evict oldest blocks when window is exceeded
      while (m.gatingBlockSums.length > MAX_INTEGRATED_BLOCKS) {
        const evicted = m.gatingBlockSums.shift()!;
        m.integratedSum -= evicted;
        m.integratedCount--;
      }
    }
  }

  private computeWindowedLUFS(
    buffer: Float32Array,
    currentIdx: number,
    filled: boolean,
  ): number {
    const len = filled ? buffer.length : currentIdx;
    if (len === 0) return -Infinity;

    let sum = 0;
    for (let i = 0; i < len; i++) {
      sum += buffer[i];
    }
    const meanSq = sum / len;
    if (meanSq <= 0) return -Infinity;
    return LUFS_OFFSET + 10 * Math.log10(meanSq);
  }

  private computeIntegratedLUFS(): number {
    const m = this.lufs;
    if (m.integratedCount === 0) return -Infinity;

    // Stage 1: absolute gate at -70 LUFS already applied during accumulation.
    // Stage 2: relative gate at -10 LU below ungated mean.
    const ungatedMean = m.integratedSum / m.integratedCount;
    const ungatedLUFS = LUFS_OFFSET + 10 * Math.log10(Math.max(ungatedMean, 1e-20));
    const relativeGateThreshold = ungatedLUFS - 10; // -10 LU

    // Re-filter blocks above relative gate
    let gatedSum = 0;
    let gatedCount = 0;
    for (let i = 0; i < m.gatingBlockSums.length; i++) {
      const blockLUFS = LUFS_OFFSET + 10 * Math.log10(Math.max(m.gatingBlockSums[i], 1e-20));
      if (blockLUFS > relativeGateThreshold) {
        gatedSum += m.gatingBlockSums[i];
        gatedCount++;
      }
    }

    if (gatedCount === 0) return -Infinity;
    const gatedMean = gatedSum / gatedCount;
    return LUFS_OFFSET + 10 * Math.log10(Math.max(gatedMean, 1e-20));
  }

  private computeLoudnessRange(): number {
    const m = this.lufs;
    if (m.gatingBlockSums.length < 2) return 0;

    // Compute LUFS for each block, sort, and find 10th-95th percentile spread
    const blockLufs: number[] = [];
    for (let i = 0; i < m.gatingBlockSums.length; i++) {
      const l = LUFS_OFFSET + 10 * Math.log10(Math.max(m.gatingBlockSums[i], 1e-20));
      if (l > -70) {
        blockLufs.push(l);
      }
    }

    if (blockLufs.length < 2) return 0;

    // Relative gate at -20 LU below ungated mean for LRA computation
    const mean = blockLufs.reduce((a, b) => a + b, 0) / blockLufs.length;
    const gated = blockLufs.filter((l) => l > mean - 20);
    if (gated.length < 2) return 0;

    gated.sort((a, b) => a - b);
    const lo = gated[Math.floor(gated.length * 0.1)];
    const hi = gated[Math.floor(gated.length * 0.95)];

    return Math.max(0, hi - lo);
  }

  // =========================================================================
  // Private — polling loop
  // =========================================================================

  private startPolling(): void {
    const POLL_INTERVAL_MS = 43; // ~23 Hz
    let lastTime = 0;

    const poll = (): void => {
      if (this.destroyed) return;

      const now = performance.now();
      if (now - lastTime >= POLL_INTERVAL_MS) {
        lastTime = now;
        this.processGates();
        this.updateLufsMetering();
      }

      this.pollHandle = requestAnimationFrame(poll);
    };

    this.pollHandle = requestAnimationFrame(poll);
  }

  private stopPolling(): void {
    if (this.pollHandle !== null) {
      cancelAnimationFrame(this.pollHandle);
      this.pollHandle = null;
    }
  }
}
