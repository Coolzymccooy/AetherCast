export class AudioEngine {
  context: AudioContext | null = null;
  destination: MediaStreamAudioDestinationNode | null = null;
  sources: Map<string, { source: MediaStreamAudioSourceNode, gain: GainNode, analyser: AnalyserNode }> = new Map();

  init() {
    if (this.context) return;
    this.context = new (window.AudioContext || (window as any).webkitAudioContext)();
    this.destination = this.context.createMediaStreamDestination();
  }

  addStream(id: string, stream: MediaStream) {
    if (!this.context || !this.destination) this.init();
    if (stream.getAudioTracks().length === 0) return;
    if (this.sources.has(id)) return;

    try {
      const source = this.context!.createMediaStreamSource(stream);
      const gain = this.context!.createGain();
      const analyser = this.context!.createAnalyser();
      
      analyser.fftSize = 256;
      gain.gain.value = 1.0;

      source.connect(gain);
      gain.connect(analyser);
      analyser.connect(this.destination!);

      this.sources.set(id, { source, gain, analyser });
    } catch (err) {
      console.error(`AudioEngine: Failed to add stream ${id}`, err);
    }
  }

  removeStream(id: string) {
    const entry = this.sources.get(id);
    if (entry) {
      entry.source.disconnect();
      entry.gain.disconnect();
      entry.analyser.disconnect();
      this.sources.delete(id);
    }
  }

  setVolume(id: string, volume: number) {
    const entry = this.sources.get(id);
    if (entry && this.context) {
      // Smooth volume transition to prevent clicks
      entry.gain.gain.setTargetAtTime(volume, this.context.currentTime, 0.05);
    }
  }

  setMuted(id: string, muted: boolean) {
    const entry = this.sources.get(id);
    if (entry && this.context) {
      entry.gain.gain.setTargetAtTime(muted ? 0 : 1, this.context.currentTime, 0.05);
    }
  }

  getLevels(): Record<string, number> {
    const levels: Record<string, number> = {};
    this.sources.forEach((entry, id) => {
      const dataArray = new Uint8Array(entry.analyser.frequencyBinCount);
      entry.analyser.getByteFrequencyData(dataArray);
      let sum = 0;
      for (let i = 0; i < dataArray.length; i++) {
        sum += dataArray[i];
      }
      const average = sum / dataArray.length;
      // Normalize to 0-1
      levels[id] = Math.min(1, average / 128);
    });
    return levels;
  }

  getMixedStream(): MediaStream | null {
    return this.destination ? this.destination.stream : null;
  }

  close() {
    this.sources.forEach(entry => {
      entry.source.disconnect();
      entry.gain.disconnect();
      entry.analyser.disconnect();
    });
    this.sources.clear();
    if (this.context) {
      this.context.close();
      this.context = null;
      this.destination = null;
    }
  }
}

export const audioEngine = new AudioEngine();
