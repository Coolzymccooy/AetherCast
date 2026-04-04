import { useState, useEffect, useCallback, useRef } from 'react';
import {
  Scene, Source, AudioChannel, CamoSettings, AudienceMessage,
  LowerThirds, ScenePreset, ServerLog, QrMode, Recording
} from '../types';
import { SCENES, SOURCES, AUDIO_CHANNELS, DEFAULT_CAMO_SETTINGS } from '../constants';
import { audioEngine } from '../lib/audioEngine';

// ── Layout State ──────────────────────────────────────────────────────────────

function useLayoutState() {
  const [layout, setLayout] = useState(() => localStorage.getItem('aether_layout') || 'Solo');
  const [transition, setTransition] = useState('Cut');
  const [transitionSpeed, setTransitionSpeed] = useState(300);
  const [activeGraphics, setActiveGraphics] = useState<Set<string>>(new Set());
  const [background, setBackground] = useState(() => localStorage.getItem('aether_background') || 'Gradient Motion');
  const [frameStyle, setFrameStyle] = useState(() => localStorage.getItem('aether_frameStyle') || 'Glass');
  const [motionStyle, setMotionStyle] = useState(() => localStorage.getItem('aether_motionStyle') || 'Snappy');
  const [brandColor, setBrandColor] = useState(() => localStorage.getItem('aether_brandColor') || '#5d28d9');
  const [activeTheme, setActiveTheme] = useState(() => localStorage.getItem('aether_activeTheme') || 'Broadcast Studio');
  const [composerMode, setComposerMode] = useState(true);
  const [sourceSwap, setSourceSwap] = useState(false);
  const [camoSettings, setCamoSettings] = useState<CamoSettings>(() => {
    const saved = localStorage.getItem('aether_camo');
    return saved ? JSON.parse(saved) : DEFAULT_CAMO_SETTINGS;
  });

  const toggleGraphic = useCallback((g: string) => {
    setActiveGraphics(prev => {
      const next = new Set(prev);
      if (next.has(g)) next.delete(g); else next.add(g);
      return next;
    });
  }, []);

  const swapSources = useCallback(() => {
    setSourceSwap(prev => !prev);
  }, []);

  // Persist layout state
  useEffect(() => {
    localStorage.setItem('aether_layout', layout);
    localStorage.setItem('aether_background', background);
    localStorage.setItem('aether_frameStyle', frameStyle);
    localStorage.setItem('aether_motionStyle', motionStyle);
    localStorage.setItem('aether_brandColor', brandColor);
    localStorage.setItem('aether_activeTheme', activeTheme);
    localStorage.setItem('aether_camo', JSON.stringify(camoSettings));
  }, [layout, background, frameStyle, motionStyle, brandColor, activeTheme, camoSettings]);

  return {
    layout, setLayout,
    transition, setTransition,
    transitionSpeed, setTransitionSpeed,
    activeGraphics, toggleGraphic,
    background, setBackground,
    frameStyle, setFrameStyle,
    motionStyle, setMotionStyle,
    brandColor, setBrandColor,
    activeTheme, setActiveTheme,
    composerMode, setComposerMode,
    sourceSwap, swapSources,
    camoSettings, setCamoSettings,
  };
}

// ── Graphics State (Lower Thirds + Audience) ─────────────────────────────────

function useGraphicsState() {
  const [lowerThirds, setLowerThirds] = useState<LowerThirds>(() => {
    const saved = localStorage.getItem('aether_lowerThirds');
    return saved ? JSON.parse(saved) : {
      name: 'Olu', title: 'Engineer', visible: false, duration: 5, accentColor: '#d946ef'
    };
  });
  const [audienceMessages, setAudienceMessages] = useState<AudienceMessage[]>([]);
  const [activeMessageId, setActiveMessageId] = useState<string | null>(null);

  const toggleLowerThirds = useCallback(() => {
    setLowerThirds(prev => ({ ...prev, visible: !prev.visible }));
  }, []);

  const showLowerThirdsTimed = useCallback((secs: number) => {
    setLowerThirds(prev => ({ ...prev, visible: true, duration: secs }));
    setTimeout(() => setLowerThirds(prev => ({ ...prev, visible: false })), secs * 1000);
  }, []);

  useEffect(() => {
    localStorage.setItem('aether_lowerThirds', JSON.stringify(lowerThirds));
  }, [lowerThirds]);

  return {
    lowerThirds, setLowerThirds,
    toggleLowerThirds, showLowerThirdsTimed,
    audienceMessages, setAudienceMessages,
    activeMessageId, setActiveMessageId,
  };
}

// ── Presets State ─────────────────────────────────────────────────────────────

function usePresetsState() {
  const [scenePresets, setScenePresets] = useState<ScenePreset[]>(() => {
    const saved = localStorage.getItem('aether_presets');
    return saved ? JSON.parse(saved) : [
      { id: 'p1', name: 'Main + Thumbs', layout: 'Grid', activeSceneId: '5', background: 'Brand Theme', frameStyle: 'Glass', activeTheme: 'Broadcast Studio' },
      { id: 'p2', name: 'Side by Side', layout: 'Side-by-Side', activeSceneId: '4', background: 'Gradient Motion', frameStyle: 'Flat', activeTheme: 'Neon Cyber' },
      { id: 'p3', name: 'PiP Corner', layout: 'Picture-in-Pic', activeSceneId: '1', background: 'Solid Dark', frameStyle: 'Floating', activeTheme: 'Minimalist' },
    ];
  });
  const [showSavePresetModal, setShowSavePresetModal] = useState(false);
  const [presetNameInput, setPresetNameInput] = useState('');

  useEffect(() => {
    localStorage.setItem('aether_presets', JSON.stringify(scenePresets));
  }, [scenePresets]);

  const deleteScenePreset = useCallback((id: string) => {
    setScenePresets(prev => prev.filter(p => p.id !== id));
  }, []);

  return {
    scenePresets, setScenePresets,
    showSavePresetModal, setShowSavePresetModal,
    presetNameInput, setPresetNameInput,
    deleteScenePreset,
  };
}

// ── Modal State ──────────────────────────────────────────────────────────────

function useModalState() {
  const [showRecordingGallery, setShowRecordingGallery] = useState(false);
  const [showScriptEditor, setShowScriptEditor] = useState(false);
  const [showStreamSettings, setShowStreamSettings] = useState(false);
  const [showHardwareSetup, setShowHardwareSetup] = useState(false);
  const [showQrModal, setShowQrModal] = useState(false);
  const [qrMode, setQrMode] = useState<QrMode>('camera');
  const [selectedVideo, setSelectedVideo] = useState<Recording | null>(null);
  const [showLuminaPairModal, setShowLuminaPairModal] = useState(false);

  return {
    showRecordingGallery, setShowRecordingGallery,
    showScriptEditor, setShowScriptEditor,
    showStreamSettings, setShowStreamSettings,
    showHardwareSetup, setShowHardwareSetup,
    showQrModal, setShowQrModal,
    qrMode, setQrMode,
    selectedVideo, setSelectedVideo,
    showLuminaPairModal, setShowLuminaPairModal,
  };
}

// ── Logs State ───────────────────────────────────────────────────────────────

function useLogsState() {
  const [serverLogs, setServerLogs] = useState<ServerLog[]>([]);
  const [showServerLogs, setShowServerLogs] = useState(false);

  // Throttle log additions — max 1 state update per 500ms to prevent UI flooding
  const pendingLogsRef = useRef<ServerLog[]>([]);
  const flushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const logIdCounter = useRef(0);

  const addLog = useCallback((message: string, type: ServerLog['type'] = 'info') => {
    // Use counter-based IDs to guarantee uniqueness (Date.now() can duplicate in same ms)
    logIdCounter.current++;
    pendingLogsRef.current.push({ message, type, id: Date.now() * 1000 + (logIdCounter.current % 1000) });

    // Batch flush every 1s instead of updating state per-log
    if (!flushTimerRef.current) {
      flushTimerRef.current = setTimeout(() => {
        const batch = pendingLogsRef.current.splice(0);
        if (batch.length > 0) {
          setServerLogs(prev => [...batch.reverse(), ...prev].slice(0, 20)); // Cap at 20
        }
        flushTimerRef.current = null;
      }, 1000);
    }
  }, []);

  return { serverLogs, setServerLogs, showServerLogs, setShowServerLogs, addLog };
}

// ── Audio Handlers ───────────────────────────────────────────────────────────

function useAudioHandlers(
  audioChannels: AudioChannel[],
  setAudioChannels: React.Dispatch<React.SetStateAction<AudioChannel[]>>
) {
  const toggleMute = useCallback((name: string) => {
    setAudioChannels(prev => prev.map(c => {
      if (c.name !== name) return c;
      const newMuted = !c.muted;
      const engineId = name === 'Mic 1' ? 'Local Mic' : name === 'System' ? 'Screen Share' : name;
      audioEngine.setMuted(engineId, newMuted);
      return { ...c, muted: newMuted };
    }));
  }, [setAudioChannels]);

  const onLevelChange = useCallback((name: string, val: number) => {
    setAudioChannels(prev => prev.map(c => {
      if (c.name !== name) return c;
      const engineId = name === 'Mic 1' ? 'Local Mic' : name === 'System' ? 'Screen Share' : name;
      audioEngine.setVolume(engineId, val);
      return { ...c, volume: val };
    }));
  }, [setAudioChannels]);

  return { toggleMute, onLevelChange };
}

// ══════════════════════════════════════════════════════════════════════════════
// Main Composite Hook
// ══════════════════════════════════════════════════════════════════════════════

export function useStudioState() {
  // ── Core ────────────────────────────────────────────────────────────────────
  const [activeScene, setActiveScene] = useState<Scene>(SCENES[0]);
  const [scenes] = useState<Scene[]>(SCENES);
  const [sources, setSources] = useState<Source[]>(SOURCES);
  const [audioChannels, setAudioChannels] = useState<AudioChannel[]>(AUDIO_CHANNELS);
  const [isStreaming, setIsStreaming] = useState(false);

  // ── Composed state groups ──────────────────────────────────────────────────
  const layoutState = useLayoutState();
  const graphicsState = useGraphicsState();
  const presetsState = usePresetsState();
  const modalState = useModalState();
  const logsState = useLogsState();
  const audioHandlers = useAudioHandlers(audioChannels, setAudioChannels);
  const [activeTab, setActiveTab] = useState<import('../types').DirectorTab>('IN');
  const [phoneSlots] = useState<string[]>([]);

  // ── Preset Actions (need access to layout + scene state) ───────────────────
  const saveScenePreset = useCallback(() => {
    presetsState.setPresetNameInput(`Preset ${presetsState.scenePresets.length + 1}`);
    presetsState.setShowSavePresetModal(true);
  }, [presetsState.scenePresets.length]);

  const confirmSavePreset = useCallback(() => {
    if (presetsState.presetNameInput.trim()) {
      const newPreset: ScenePreset = {
        id: `p-${Date.now()}`, name: presetsState.presetNameInput.trim(),
        layout: layoutState.layout, activeSceneId: activeScene.id,
        background: layoutState.background, frameStyle: layoutState.frameStyle,
        activeTheme: layoutState.activeTheme, camoSettings: layoutState.camoSettings,
      };
      presetsState.setScenePresets(prev => [...prev, newPreset]);
      logsState.addLog(`Saved preset: ${presetsState.presetNameInput.trim()}`, 'success');
      presetsState.setShowSavePresetModal(false);
    }
  }, [presetsState.presetNameInput, layoutState.layout, activeScene.id, layoutState.background, layoutState.frameStyle, layoutState.activeTheme, layoutState.camoSettings, logsState.addLog]);

  const loadScenePreset = useCallback((id: string) => {
    const preset = presetsState.scenePresets.find(p => p.id === id);
    if (preset) {
      if (preset.layout) layoutState.setLayout(preset.layout);
      if (preset.background) layoutState.setBackground(preset.background);
      if (preset.frameStyle) layoutState.setFrameStyle(preset.frameStyle);
      if (preset.activeTheme) layoutState.setActiveTheme(preset.activeTheme);
      if (preset.camoSettings) layoutState.setCamoSettings(preset.camoSettings);
      const scene = scenes.find(s => s.id === preset.activeSceneId);
      if (scene) setActiveScene(scene);
      logsState.addLog(`Loaded preset: ${preset.name}`, 'info');
    }
  }, [presetsState.scenePresets, scenes, logsState.addLog]);

  // ── OPS Actions ────────────────────────────────────────────────────────────
  const emergencyWide = useCallback(() => {
    const cam1 = scenes.find(s => s.name === 'Cam 1');
    if (cam1) setActiveScene(cam1);
    logsState.addLog('OPS: Emergency Wide triggered', 'warning');
  }, [scenes, logsState.addLog]);

  const cutToNext = useCallback(() => {
    const idx = scenes.findIndex(s => s.id === activeScene.id);
    setActiveScene(scenes[(idx + 1) % scenes.length]);
  }, [scenes, activeScene]);

  // ── Keyboard Shortcuts ─────────────────────────────────────────────────────
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key >= '1' && e.key <= '6') {
        const idx = parseInt(e.key) - 1;
        if (scenes[idx]) setActiveScene(scenes[idx]);
      }
      if (e.code === 'Space') { e.preventDefault(); layoutState.setTransition('Cut'); }
      if (e.key === 'f' || e.key === 'F') layoutState.setTransition('Fade');
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [scenes]);

  return {
    // Core
    activeScene, setActiveScene,
    scenes, sources, setSources,
    audioChannels, setAudioChannels,
    isStreaming, setIsStreaming,

    // Composed state groups
    ...layoutState,
    ...graphicsState,
    ...presetsState,
    ...modalState,
    ...logsState,
    ...audioHandlers,

    // Director rack
    activeTab, setActiveTab,
    phoneSlots,

    // Actions
    saveScenePreset, confirmSavePreset, loadScenePreset,
    emergencyWide, cutToNext,
  };
}
