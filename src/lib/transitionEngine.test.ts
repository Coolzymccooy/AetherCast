import { describe, it, expect, beforeEach, vi } from 'vitest';
import { TransitionEngine } from './transitionEngine';

describe('TransitionEngine', () => {
  let engine: TransitionEngine;

  beforeEach(() => {
    engine = new TransitionEngine();
  });

  it('should start with no active transition', () => {
    const state = engine.getState();
    expect(state.isTransitioning).toBe(false);
    // Initial progress is 0 (no transition has run yet)
    expect(state.progress).toBe(0);
  });

  describe('Cut transition', () => {
    it('should complete instantly', () => {
      engine.start('Cut');
      const state = engine.getState();
      expect(state.isTransitioning).toBe(false);
      expect(state.progress).toBe(1);
      expect(state.type).toBe('Cut');
    });
  });

  describe('Fade transition', () => {
    it('should start with progress 0', () => {
      engine.start('Fade', 1000);
      const state = engine.getState();
      expect(state.isTransitioning).toBe(true);
      expect(state.progress).toBe(0);
      expect(state.type).toBe('Fade');
    });

    it('should progress over time', () => {
      engine.start('Fade', 1000);
      engine.update(500);
      const state = engine.getState();
      expect(state.progress).toBeCloseTo(0.5, 1);
      expect(state.isTransitioning).toBe(true);
    });

    it('should complete after full duration', () => {
      engine.start('Fade', 1000);
      engine.update(1000);
      const state = engine.getState();
      expect(state.progress).toBe(1);
      expect(state.isTransitioning).toBe(false);
    });
  });

  describe('Wipe transition', () => {
    it('should progress linearly', () => {
      engine.start('Wipe', 500);
      engine.update(250);
      expect(engine.getState().progress).toBeCloseTo(0.5, 1);
    });
  });

  describe('WipeUp transition', () => {
    it('should work like other transitions', () => {
      engine.start('WipeUp', 400);
      engine.update(200);
      expect(engine.getState().progress).toBeCloseTo(0.5, 1);
      engine.update(200);
      expect(engine.getState().isTransitioning).toBe(false);
    });
  });

  describe('Cut point callback', () => {
    it('should fire at the midpoint of non-stinger transitions', () => {
      const callback = vi.fn();
      engine.onCutPoint(callback);
      engine.start('Fade', 1000);
      engine.update(400);
      expect(callback).not.toHaveBeenCalled();
      engine.update(200); // now at 600ms, past 500ms midpoint
      expect(callback).toHaveBeenCalledTimes(1);
    });

    it('should not fire multiple times', () => {
      const callback = vi.fn();
      engine.onCutPoint(callback);
      engine.start('Fade', 1000);
      engine.update(600);
      engine.update(400);
      expect(callback).toHaveBeenCalledTimes(1);
    });
  });

  describe('destroy', () => {
    it('should clean up without errors', () => {
      engine.start('Fade', 1000);
      engine.update(500);
      expect(() => engine.destroy()).not.toThrow();
    });
  });
});
