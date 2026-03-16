import { useState, useEffect, useCallback } from 'react';
import { Scene, Source, AiMode, AiSuggestion, ServerLog } from '../types';

interface UseAIDirectorOptions {
  scenes: Scene[];
  activeScene: Scene;
  sources: Source[];
  isStreaming: boolean;
  telemetry: { cpu: number; bitrate: string };
  setActiveScene: (s: Scene) => void;
  addLog: (message: string, type?: string) => void;
}

export function useAIDirector({
  scenes,
  activeScene,
  sources,
  isStreaming,
  telemetry,
  setActiveScene,
  addLog,
}: UseAIDirectorOptions) {
  const [aiMode, setAiMode] = useState<AiMode>('MANUAL');
  const [aiSuggestion, setAiSuggestion] = useState<AiSuggestion | null>(null);
  const [generativePrompt, setGenerativePrompt] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [backgroundImage, setBackgroundImage] = useState<string | null>(null);

  // --- Generative Background via server proxy ---
  const generateBackground = useCallback(async () => {
    if (!generativePrompt) return;
    setIsGenerating(true);
    try {
      const res = await fetch('/api/ai/background', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: generativePrompt }),
      });
      if (!res.ok) throw new Error(`Server error: ${res.statusText}`);
      const data = await res.json();
      if (data.imageUrl) {
        setBackgroundImage(data.imageUrl);
        addLog(`AI: Background generated for "${generativePrompt}"`, 'info');
      }
    } catch (err) {
      console.error('AI: Failed to generate background:', err);
      addLog('AI Error: Failed to generate background', 'error');
    } finally {
      setIsGenerating(false);
    }
  }, [generativePrompt, addLog]);

  // --- AI Director via server proxy ---
  const runAiDirector = useCallback(async () => {
    if (aiMode === 'MANUAL' || !isStreaming) return;
    try {
      const res = await fetch('/api/ai/direct', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          activeScene: activeScene.name,
          scenes: scenes.map(s => s.name),
          telemetry,
        }),
      });
      if (!res.ok) return;
      const data = await res.json();
      const decision = data.scene?.trim().toUpperCase();
      if (decision && decision !== 'STAY') {
        const nextScene = scenes.find(s => s.name.toUpperCase() === decision);
        if (nextScene && nextScene.id !== activeScene.id) {
          addLog(`AI Director: Auto-switched to ${nextScene.name}`, 'info');
          setActiveScene(nextScene);
        }
      }
    } catch (err) {
      console.error('AI Director Error:', err);
    }
  }, [aiMode, isStreaming, activeScene, scenes, telemetry, setActiveScene, addLog]);

  // --- Mode loops ---
  useEffect(() => {
    if (aiMode === 'AUTO') {
      const checkInterval = setInterval(() => {
        const activeSource = sources.find(s => s.audioLevel > 0.8);
        if (activeSource && activeSource.name !== activeScene.name) {
          const targetScene = scenes.find(s => s.name === activeSource.name);
          if (targetScene) {
            setAiSuggestion({ scene: targetScene.name, reason: `High audio activity detected on ${targetScene.name}` });
            setActiveScene(targetScene);
          }
        } else {
          runAiDirector();
        }
      }, 8000);
      return () => clearInterval(checkInterval);
    } else if (aiMode === 'TIMER') {
      const timerInterval = setInterval(() => {
        const currentIndex = scenes.findIndex(s => s.id === activeScene.id);
        const nextScene = scenes[(currentIndex + 1) % scenes.length];
        setAiSuggestion({ scene: nextScene.name, reason: `Timer-based auto-switch to ${nextScene.name}` });
        setActiveScene(nextScene);
        addLog(`AI Director: Timer auto-switched to ${nextScene.name}`, 'info');
      }, 15000);
      return () => clearInterval(timerInterval);
    } else {
      setAiSuggestion(null);
    }
  }, [aiMode, sources, activeScene, scenes, isStreaming]);

  const executeAiAction = () => {
    if (aiSuggestion) {
      const targetScene = scenes.find(s => s.name === aiSuggestion.scene);
      if (targetScene) {
        setActiveScene(targetScene);
        addLog(`AI: Executed switch to ${aiSuggestion.scene}`, 'info');
        setAiSuggestion(null);
      }
    }
  };

  return {
    aiMode, setAiMode,
    aiSuggestion, setAiSuggestion,
    generativePrompt, setGenerativePrompt,
    isGenerating,
    backgroundImage, setBackgroundImage,
    generateBackground,
    executeAiAction,
  };
}
