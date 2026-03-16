import { describe, it, expect, beforeEach, vi } from 'vitest';
import { AudioEngine } from './audioEngine';

// Polyfill MediaStream and MediaStreamTrack for jsdom
class MockMediaStreamTrack {
  kind = 'audio';
  id = Math.random().toString(36);
  enabled = true;
  stop() {}
}

class MockMediaStream {
  private tracks: MockMediaStreamTrack[];
  constructor(tracks?: MockMediaStreamTrack[]) {
    this.tracks = tracks || [];
  }
  getAudioTracks() { return this.tracks.filter(t => t.kind === 'audio'); }
  getVideoTracks() { return []; }
  getTracks() { return this.tracks; }
  addTrack(t: MockMediaStreamTrack) { this.tracks.push(t); }
}

(globalThis as any).MediaStream = MockMediaStream;
(globalThis as any).MediaStreamTrack = MockMediaStreamTrack;

// Mock Web Audio API
function createMockAudioContext() {
  const gainNode = {
    gain: { value: 1, setTargetAtTime: vi.fn() },
    connect: vi.fn(),
    disconnect: vi.fn(),
  };

  const analyserNode = {
    fftSize: 0,
    frequencyBinCount: 128,
    getByteFrequencyData: vi.fn((arr: Uint8Array) => {
      // Fill with mid-level data
      for (let i = 0; i < arr.length; i++) arr[i] = 64;
    }),
    connect: vi.fn(),
    disconnect: vi.fn(),
  };

  const sourceNode = {
    connect: vi.fn(),
    disconnect: vi.fn(),
  };

  const destinationNode = {
    stream: new MockMediaStream(),
  };

  const context = {
    currentTime: 0,
    createGain: vi.fn(() => gainNode),
    createAnalyser: vi.fn(() => analyserNode),
    createMediaStreamSource: vi.fn(() => sourceNode),
    createMediaStreamDestination: vi.fn(() => destinationNode),
    close: vi.fn(),
  };

  return { context, gainNode, analyserNode, sourceNode, destinationNode };
}

function installMockAudioContext() {
  const mock = createMockAudioContext();
  (globalThis as any).AudioContext = function () { return mock.context; };
  (globalThis as any).window = globalThis as any;
  (globalThis as any).window.AudioContext = (globalThis as any).AudioContext;
  return mock;
}

describe('AudioEngine', () => {
  let engine: AudioEngine;

  beforeEach(() => {
    engine = new AudioEngine();
  });

  it('should start uninitialized', () => {
    expect(engine.context).toBeNull();
    expect(engine.destination).toBeNull();
    expect(engine.sources.size).toBe(0);
  });

  it('should initialize context and destination on init()', () => {
    const { context } = installMockAudioContext();

    engine.init();

    expect(engine.context).toBe(context);
    expect(engine.destination).toBeDefined();
  });

  it('should not re-initialize if already initialized', () => {
    const { context } = installMockAudioContext();

    engine.init();
    const firstContext = engine.context;
    engine.init();

    expect(engine.context).toBe(firstContext);
  });

  it('should add a stream with audio tracks', () => {
    const { context } = installMockAudioContext();
    engine.init();

    const track = new MockMediaStreamTrack();
    const stream = new MockMediaStream([track]);

    engine.addStream('test', stream);

    expect(engine.sources.has('test')).toBe(true);
    expect(context.createMediaStreamSource).toHaveBeenCalled();
    expect(context.createGain).toHaveBeenCalled();
    expect(context.createAnalyser).toHaveBeenCalled();
  });

  it('should skip streams with no audio tracks', () => {
    const { context } = installMockAudioContext();
    engine.init();

    const stream = new MockMediaStream();

    engine.addStream('empty', stream);

    expect(engine.sources.has('empty')).toBe(false);
  });

  it('should not add duplicate stream ids', () => {
    const { context } = installMockAudioContext();
    engine.init();

    const track = new MockMediaStreamTrack();
    const stream = new MockMediaStream([track]);

    engine.addStream('dup', stream);
    engine.addStream('dup', stream);

    expect(context.createMediaStreamSource).toHaveBeenCalledTimes(1);
  });

  it('should remove a stream and disconnect nodes', () => {
    const { context, gainNode, analyserNode, sourceNode } = installMockAudioContext();
    engine.init();

    const track = new MockMediaStreamTrack();
    const stream = new MockMediaStream([track]);

    engine.addStream('remove-me', stream);
    engine.removeStream('remove-me');

    expect(engine.sources.has('remove-me')).toBe(false);
    expect(sourceNode.disconnect).toHaveBeenCalled();
    expect(gainNode.disconnect).toHaveBeenCalled();
    expect(analyserNode.disconnect).toHaveBeenCalled();
  });

  it('should set volume with smooth transition', () => {
    const { context, gainNode } = installMockAudioContext();
    engine.init();

    const track = new MockMediaStreamTrack();
    const stream = new MockMediaStream([track]);

    engine.addStream('vol', stream);
    engine.setVolume('vol', 0.5);

    expect(gainNode.gain.setTargetAtTime).toHaveBeenCalledWith(0.5, 0, 0.05);
  });

  it('should set muted to gain 0', () => {
    const { context, gainNode } = installMockAudioContext();
    engine.init();

    const track = new MockMediaStreamTrack();
    const stream = new MockMediaStream([track]);

    engine.addStream('mute', stream);
    engine.setMuted('mute', true);

    expect(gainNode.gain.setTargetAtTime).toHaveBeenCalledWith(0, 0, 0.05);
  });

  it('should return normalized levels from getLevels()', () => {
    const { context } = installMockAudioContext();
    engine.init();

    const track = new MockMediaStreamTrack();
    const stream = new MockMediaStream([track]);

    engine.addStream('lvl', stream);
    const levels = engine.getLevels();

    expect(levels).toHaveProperty('lvl');
    expect(levels['lvl']).toBeGreaterThanOrEqual(0);
    expect(levels['lvl']).toBeLessThanOrEqual(1);
  });

  it('should return mixed stream from getMixedStream()', () => {
    const { context } = installMockAudioContext();
    engine.init();

    const mixed = engine.getMixedStream();
    expect(mixed).toBeDefined();
    expect(mixed).not.toBeNull();
  });

  it('should clean up everything on close()', () => {
    const { context, sourceNode, gainNode, analyserNode } = installMockAudioContext();
    engine.init();

    const track = new MockMediaStreamTrack();
    const stream = new MockMediaStream([track]);

    engine.addStream('cleanup', stream);
    engine.close();

    expect(engine.context).toBeNull();
    expect(engine.destination).toBeNull();
    expect(engine.sources.size).toBe(0);
    expect(sourceNode.disconnect).toHaveBeenCalled();
    expect(gainNode.disconnect).toHaveBeenCalled();
    expect(analyserNode.disconnect).toHaveBeenCalled();
    expect(context.close).toHaveBeenCalled();
  });
});
