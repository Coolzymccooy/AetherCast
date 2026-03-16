import { describe, it, expect } from 'vitest';
import { WebCodecEncoder } from './webcodecEncoder';

describe('WebCodecEncoder', () => {
  describe('static isSupported', () => {
    it('should return a boolean', () => {
      const result = WebCodecEncoder.isSupported();
      expect(typeof result).toBe('boolean');
    });

    it('should return false in jsdom (no VideoEncoder)', () => {
      // jsdom doesn't have VideoEncoder
      expect(WebCodecEncoder.isSupported()).toBe(false);
    });
  });

  describe('constructor', () => {
    it('should throw if WebCodecs is not available', () => {
      expect(() => {
        new WebCodecEncoder(
          { width: 1920, height: 1080, fps: 30, bitrate: 6_000_000, keyFrameInterval: 2, codec: 'avc', hardwareAcceleration: 'no-preference' },
          () => {}
        );
      }).toThrow();
    });
  });
});
