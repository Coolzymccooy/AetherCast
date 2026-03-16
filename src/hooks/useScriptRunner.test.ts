import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useScriptRunner } from './useScriptRunner';
import { Scene, Script } from '../types';

const MOCK_SCENES: Scene[] = [
  { id: '1', name: 'Cam 1', type: 'CAM' },
  { id: '2', name: 'Cam 2', type: 'CAM' },
  { id: '3', name: 'Screen', type: 'SCREEN' },
];

const MOCK_SCRIPT: Script = {
  id: 'test-script',
  name: 'Test Script',
  steps: [
    { id: 's1', sceneId: '1', duration: 3, label: 'Step 1' },
    { id: 's2', sceneId: '2', duration: 5, label: 'Step 2' },
    { id: 's3', sceneId: '3', duration: 2, label: 'Step 3' },
  ],
};

describe('useScriptRunner', () => {
  const setActiveScene = vi.fn();

  beforeEach(() => {
    vi.useFakeTimers();
    setActiveScene.mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should start with no active script', () => {
    const { result } = renderHook(() =>
      useScriptRunner({ scenes: MOCK_SCENES, setActiveScene })
    );

    expect(result.current.activeScript).toBeNull();
    expect(result.current.isScriptRunning).toBe(false);
    expect(result.current.currentStepIndex).toBe(0);
  });

  it('should toggle script to start running', () => {
    const { result } = renderHook(() =>
      useScriptRunner({ scenes: MOCK_SCENES, setActiveScene })
    );

    act(() => {
      result.current.setActiveScript(MOCK_SCRIPT);
    });

    act(() => {
      result.current.toggleScript(MOCK_SCRIPT);
    });

    expect(result.current.isScriptRunning).toBe(true);
    expect(result.current.currentStepIndex).toBe(0);
    // Should switch to first scene
    expect(setActiveScene).toHaveBeenCalledWith(MOCK_SCENES[0]);
  });

  it('should toggle script to stop running', () => {
    const { result } = renderHook(() =>
      useScriptRunner({ scenes: MOCK_SCENES, setActiveScene })
    );

    act(() => {
      result.current.setActiveScript(MOCK_SCRIPT);
    });

    // Start
    act(() => {
      result.current.toggleScript(MOCK_SCRIPT);
    });

    // Stop
    act(() => {
      result.current.toggleScript(MOCK_SCRIPT);
    });

    expect(result.current.isScriptRunning).toBe(false);
  });

  it('should skip to the next step', () => {
    const { result } = renderHook(() =>
      useScriptRunner({ scenes: MOCK_SCENES, setActiveScene })
    );

    act(() => {
      result.current.setActiveScript(MOCK_SCRIPT);
    });

    act(() => {
      result.current.toggleScript(MOCK_SCRIPT);
    });

    setActiveScene.mockClear();

    act(() => {
      result.current.skipStep(MOCK_SCRIPT);
    });

    expect(result.current.currentStepIndex).toBe(1);
    expect(setActiveScene).toHaveBeenCalledWith(MOCK_SCENES[1]);
  });

  it('should stop when skipping past last step', () => {
    const { result } = renderHook(() =>
      useScriptRunner({ scenes: MOCK_SCENES, setActiveScene })
    );

    act(() => {
      result.current.setActiveScript(MOCK_SCRIPT);
    });

    act(() => {
      result.current.toggleScript(MOCK_SCRIPT);
    });

    // Skip past all steps
    act(() => { result.current.skipStep(MOCK_SCRIPT); }); // step 1 -> 2
    act(() => { result.current.skipStep(MOCK_SCRIPT); }); // step 2 -> 3
    act(() => { result.current.skipStep(MOCK_SCRIPT); }); // step 3 -> end

    expect(result.current.isScriptRunning).toBe(false);
    expect(result.current.currentStepIndex).toBe(0);
  });

  it('should auto-advance after step duration expires', () => {
    const { result } = renderHook(() =>
      useScriptRunner({ scenes: MOCK_SCENES, setActiveScene })
    );

    act(() => {
      result.current.setActiveScript(MOCK_SCRIPT);
    });

    act(() => {
      result.current.toggleScript(MOCK_SCRIPT);
    });

    // First step has duration 3 seconds
    expect(result.current.stepTimeRemaining).toBe(3);

    // Advance 3 seconds
    act(() => { vi.advanceTimersByTime(1000); });
    expect(result.current.stepTimeRemaining).toBe(2);

    act(() => { vi.advanceTimersByTime(1000); });
    expect(result.current.stepTimeRemaining).toBe(1);

    act(() => { vi.advanceTimersByTime(1000); });
    // Should have advanced to step 2
    expect(result.current.currentStepIndex).toBe(1);
  });
});
