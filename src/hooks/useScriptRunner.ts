import { useState, useEffect, useRef } from 'react';
import { Scene, Script } from '../types';

interface UseScriptRunnerOptions {
  scenes: Scene[];
  setActiveScene: (s: Scene) => void;
}

export function useScriptRunner({ scenes, setActiveScene }: UseScriptRunnerOptions) {
  const [activeScript, setActiveScript] = useState<Script | null>(null);
  const [isScriptRunning, setIsScriptRunning] = useState(false);
  const [currentStepIndex, setCurrentStepIndex] = useState(0);
  const [stepTimeRemaining, setStepTimeRemaining] = useState(0);

  // Use refs to avoid stale closures in the setInterval callback
  const isRunningRef = useRef(false);
  const currentStepRef = useRef(0);
  const scriptRef = useRef<Script | null>(null);

  isRunningRef.current = isScriptRunning;
  currentStepRef.current = currentStepIndex;
  scriptRef.current = activeScript;

  useEffect(() => {
    if (!isScriptRunning || !activeScript) return;

    const currentStep = activeScript.steps[currentStepIndex];
    if (!currentStep) {
      setIsScriptRunning(false);
      return;
    }

    // Switch scene at step start
    const targetScene = scenes.find(s => s.id === currentStep.sceneId);
    if (targetScene) setActiveScene(targetScene);

    setStepTimeRemaining(currentStep.duration);

    const timer = setInterval(() => {
      setStepTimeRemaining(prev => {
        if (prev <= 1) {
          // Use refs to read current index without stale closure
          const idx = currentStepRef.current;
          const script = scriptRef.current;

          if (script && idx < script.steps.length - 1) {
            setCurrentStepIndex(idx + 1);
          } else {
            setIsScriptRunning(false);
            setCurrentStepIndex(0);
          }
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(timer);
  }, [isScriptRunning, currentStepIndex, activeScript]);

  const toggleScript = (script: Script) => {
    if (!isScriptRunning) {
      setCurrentStepIndex(0);
      setStepTimeRemaining(script.steps[0]?.duration ?? 0);
      const firstStep = script.steps[0];
      if (firstStep?.sceneId) {
        const targetScene = scenes.find(s => s.id === firstStep.sceneId);
        if (targetScene) setActiveScene(targetScene);
      }
    }
    setIsScriptRunning(!isScriptRunning);
  };

  const skipStep = (script: Script) => {
    const nextIdx = currentStepIndex + 1;
    if (nextIdx >= script.steps.length) {
      setIsScriptRunning(false);
      setCurrentStepIndex(0);
      return;
    }
    setCurrentStepIndex(nextIdx);
    const nextStep = script.steps[nextIdx];
    setStepTimeRemaining(nextStep.duration);
    if (nextStep.sceneId) {
      const targetScene = scenes.find(s => s.id === nextStep.sceneId);
      if (targetScene) setActiveScene(targetScene);
    }
  };

  return {
    activeScript, setActiveScript,
    isScriptRunning, setIsScriptRunning,
    currentStepIndex, setCurrentStepIndex,
    stepTimeRemaining,
    toggleScript,
    skipStep,
  };
}
