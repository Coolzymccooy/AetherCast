import React, { useEffect } from 'react';
import { AnimatePresence } from 'motion/react';
import { motion } from 'motion/react';
import { Terminal, Brain, X } from 'lucide-react';

// --- Constants ---
import { SAMPLE_SCRIPT } from './constants';

// --- Hooks ---
import { useStudioState } from './hooks/useStudioState';
import { useWebRTC } from './hooks/useWebRTC';
import { useStreaming } from './hooks/useStreaming';
import { useScriptRunner } from './hooks/useScriptRunner';
import { useAIDirector } from './hooks/useAIDirector';
import { useTelemetry } from './hooks/useTelemetry';
import { useNotifications } from './hooks/useNotifications';
import { useProAudio } from './hooks/useProAudio';
import { useMediaPlayer } from './hooks/useMediaPlayer';
import { useReplay } from './hooks/useReplay';
import { useProject } from './hooks/useProject';
import { useMIDI } from './hooks/useMIDI';
import { useNativeEngine, type NativeAudioBusConfig } from './hooks/useNativeEngine';
import { useNativeSourceFeeds } from './hooks/useNativeSourceFeeds';
import { useBrowserSourceRuntime } from './hooks/useBrowserSourceRuntime';
import { buildNativeSceneSnapshot, buildNativeSourceInventory } from './lib/sceneSchema';
import { type EncodingProfile, type StreamDestination, type ServerLog } from './types';

// --- Studio Components ---
import { MenuBar } from './components/studio/MenuBar';
import { TelemetryBar } from './components/studio/TelemetryBar';
import { SourceRack } from './components/studio/SourceRack';
import { ProgramView, type ProgramViewHandle } from './components/studio/ProgramView';
import { SceneSwitcher } from './components/studio/SceneSwitcher';
import { AudioMixer } from './components/studio/AudioMixer';
import { DirectorRack } from './components/studio/DirectorRack';
import { RecordingGallery } from './components/studio/RecordingGallery';
import { ScriptEditor } from './components/studio/ScriptEditor';
import { HardwareSetupModal } from './components/studio/HardwareSetupModal';
import { StreamSettingsModal } from './components/studio/StreamSettingsModal';
import { QrModal } from './components/studio/QrModal';
import { LuminaPairModal } from './components/studio/LuminaPairModal';
import { PeerSettingsModal } from './components/studio/PeerSettingsModal';
import { ServerLogsPanel } from './components/studio/ServerLogsPanel';
import { NotificationToast } from './components/studio/NotificationToast';
import { ProjectDialog } from './components/studio/ProjectDialog';
import { OutputQualityModal } from './components/studio/OutputQualityModal';
import { ErrorBoundary } from './components/ErrorBoundary';
import { DownloadModal } from './components/studio/DownloadModal';
import { CheckForUpdatesModal } from './components/studio/CheckForUpdatesModal';
import { KeyboardShortcuts } from './components/studio/KeyboardShortcuts';
import { AboutModal } from './components/studio/AboutModal';
import { SceneTransitionsModal, type TransitionConfig } from './components/studio/SceneTransitionsModal';

// --- Other Views ---
import { AudienceLanding } from './components/AudienceLanding';

// --- Remote Camera View ---
import RemoteCameraView from './components/RemoteCameraView';

// --- Phone Screen Share View ---
import PhoneScreenView from './components/PhoneScreenView';

// --- App Download Page ---
import AppDownload from './components/AppDownload';

// --- Mobile Home (APK default screen) ---
import MobileHome from './components/MobileHome';

// --- Tauri type augmentation ---
declare global {
  interface Window {
    __TAURI_INTERNALS__?: unknown;
    __AETHER_EXPORT_NATIVE_DIAGNOSTICS__?: (() => unknown) | undefined;
  }
}

type LuminaStreamRequest = {
  event: string;
  payload: Record<string, unknown>;
  workspaceId?: string;
  sessionId?: string;
};

// ──────────────────────────────────────────────────────────────────────────────
// App Router
// ──────────────────────────────────────────────────────────────────────────────
export default function App() {
  const params = new URLSearchParams(window.location.search);
  const urlMode = params.get('mode');

  if (urlMode === 'remote') return <RemoteCameraView />;
  if (urlMode === 'screen') return <PhoneScreenView />;
  if (urlMode === 'audience') return <AudienceLanding />;
  if (urlMode === 'download') return <AppDownload />;
  if (urlMode === 'app') return <MobileHome />;
  return <StudioView />;
}

// ──────────────────────────────────────────────────────────────────────────────
// Studio View
// ──────────────────────────────────────────────────────────────────────────────
function StudioView() {
  const studio = useStudioState();
  const { notifications, notify, dismiss } = useNotifications();
  const proAudio = useProAudio();
  const mediaPlayer = useMediaPlayer();
  const replay = useReplay();
  const project = useProject();
  const midi = useMIDI((action, _value) => {
    // Route MIDI actions to studio controls
    if (action.startsWith('scene:')) {
      const idx = parseInt(action.split(':')[1]) - 1;
      if (studio.scenes[idx]) studio.setActiveScene(studio.scenes[idx]);
    } else if (action === 'transition:cut') studio.setTransition('Cut');
    else if (action === 'transition:fade') studio.setTransition('Fade');
    else if (action === 'audio:mute:mic1') studio.toggleMute('Mic 1');
    else if (action === 'audio:mute:mic2') studio.toggleMute('Mic 2');
    else if (action === 'ops:emergency') studio.emergencyWide();
  });

  const [showPeerSettings, setShowPeerSettings] = React.useState(false);
  const [luminaConnected, setLuminaConnected] = React.useState(false);
  const luminaConnectedTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const [showProjectDialog, setShowProjectDialog] = React.useState(false);
  const [showOutputQuality, setShowOutputQuality] = React.useState(false);
  const [showShortcuts, setShowShortcuts] = React.useState(false);
  const [showDownload, setShowDownload] = React.useState(false);
  const [showCheckUpdates, setShowCheckUpdates] = React.useState(false);
  const [showAbout, setShowAbout] = React.useState(false);
  const [showTransitions, setShowTransitions] = React.useState(false);
  const [transitionConfig, setTransitionConfig] = React.useState<TransitionConfig>({ type: 'cut', durationMs: 500 });
  const programViewRef = React.useRef<ProgramViewHandle>(null);
  const lastBrowserSourceNoticeRef = React.useRef<string | null>(null);
  const [browserSourceUrl, setBrowserSourceUrl] = React.useState(() => localStorage.getItem('aether_browser_source_url') || '');
  const luminaStreamRequestHandlerRef = React.useRef<(request: LuminaStreamRequest) => void>(() => {});

  // View / Zoom state
  const [zoomLevel, setZoomLevel] = React.useState(100);
  const [showSourceRack, setShowSourceRack] = React.useState(true);
  const [showDirectorRack, setShowDirectorRack] = React.useState(true);
  const [showTelemetry, setShowTelemetry] = React.useState(true);

  const zoomIn = React.useCallback(() => setZoomLevel(prev => Math.min(prev + 10, 150)), []);
  const zoomOut = React.useCallback(() => setZoomLevel(prev => Math.max(prev - 10, 50)), []);
  const zoomReset = React.useCallback(() => setZoomLevel(100), []);

  // Global keyboard shortcuts
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      const isInput = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';

      // ? → shortcuts overlay (not in inputs)
      if (e.key === '?' && !e.ctrlKey && !e.metaKey && !isInput) {
        setShowShortcuts(prev => !prev);
      }
      if (e.key === 'Escape' && showShortcuts) {
        setShowShortcuts(false);
      }

      // Ctrl+= / Ctrl+- / Ctrl+0 → zoom
      if (e.ctrlKey || e.metaKey) {
        if (e.key === '=' || e.key === '+') { e.preventDefault(); zoomIn(); }
        else if (e.key === '-') { e.preventDefault(); zoomOut(); }
        else if (e.key === '0') { e.preventDefault(); zoomReset(); }
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [showShortcuts, zoomIn, zoomOut, zoomReset]);

  // ── Telemetry ─────────────────────────────────────────────────────────────
  const { telemetry, setTelemetry } = useTelemetry(studio.isStreaming);

  const nativeEngine = useNativeEngine({
    setTelemetry,
    setServerLogs: studio.setServerLogs,
    onError: (msg) => {
      studio.setIsStreaming(false);
      notify(msg, 'error');
    },
  });

  // ── Hooks ─────────────────────────────────────────────────────────────────
  const webrtc = useWebRTC({
    scenes: studio.scenes,
    scenePresets: studio.scenePresets,
    setActiveScene: studio.setActiveScene,
    loadScenePreset: studio.loadScenePreset,
    setActiveTheme: studio.setActiveTheme,
    setServerLogs: studio.setServerLogs, setAudienceMessages: studio.setAudienceMessages,
    audioChannels: studio.audioChannels, setAudioChannels: studio.setAudioChannels,
    setSources: studio.setSources,
    onError: (msg) => notify(msg, 'error'),
    onPhoneConnected: (role) => {
      const label = role === 'screen' ? 'Screen Share' : 'Camera';
      notify(`Phone ${label} connected`, 'success');
      // Auto-dismiss the QR modal so the camera fills the canvas immediately
      studio.setShowQrModal(false);
    },
    onLuminaStreamRequest: (request) => {
      luminaStreamRequestHandlerRef.current(request);
    },
    onLuminaConnected: () => {
      setLuminaConnected(true);
      if (luminaConnectedTimerRef.current) clearTimeout(luminaConnectedTimerRef.current);
      luminaConnectedTimerRef.current = setTimeout(() => setLuminaConnected(false), 300_000); // 5 min
    },
  });

  const streaming = useStreaming({
    socketRef: webrtc.socketRef,
    isStreaming: studio.isStreaming, setIsStreaming: studio.setIsStreaming,
    setServerLogs: studio.setServerLogs, setTelemetry,
    onError: (msg) => notify(msg, 'error'),
    onSuccess: (msg) => notify(msg, 'success'),
  });

  const videoInputs = webrtc.devices.filter((device) => device.kind === 'videoinput');
  const selectedPrimaryVideo =
    videoInputs.find((device) => device.deviceId === webrtc.selectedVideoDevice) || videoInputs[0];
  const selectedSecondaryVideo =
    videoInputs.find((device) => device.deviceId === webrtc.selectedVideoDevice2);
  const nativeVideoSources = nativeEngine.isAvailable
    ? [
        selectedPrimaryVideo?.label
          ? {
              sourceId: 'camera:local-1',
              deviceName: selectedPrimaryVideo.label,
            }
          : null,
        selectedSecondaryVideo?.label
          && selectedSecondaryVideo.label !== selectedPrimaryVideo?.label
          ? {
              sourceId: 'camera:local-2',
              deviceName: selectedSecondaryVideo.label,
            }
          : null,
      ].filter((source): source is { sourceId: string; deviceName: string } => !!source)
    : [];
  const nativeOwnedSourceIds = nativeEngine.isStreaming
    ? nativeVideoSources.map((source) => source.sourceId)
    : [];
  const nativeOwnedSourceIdsKey = nativeOwnedSourceIds.join('|');
  const mediaCaptureSources = React.useMemo(() => {
    const element = mediaPlayer.getVideoElement();
    if (!element || !mediaPlayer.playbackState.currentItem) {
      return [];
    }

    return [{
      sourceId: 'media:loop',
      element,
    }];
  }, [mediaPlayer, mediaPlayer.playbackState.currentItem]);
  const browserSourceRuntime = useBrowserSourceRuntime(browserSourceUrl);
  const nativeSourceFeeds = useNativeSourceFeeds({
    webcamStream: webrtc.webcamStream,
    screenStream: webrtc.screenStream,
    remoteStreams: webrtc.remoteStreams,
    mediaElement: mediaPlayer.playbackState.currentItem ? mediaPlayer.getVideoElement() : null,
    browserElement: browserSourceRuntime.isCapturable ? browserSourceRuntime.captureElement : null,
  });
  const nativeAudioBuses = React.useMemo<NativeAudioBusConfig[]>(() => {
    return studio.audioChannels.map((channel) => ({
      busId: channel.name.toLowerCase().replace(/\s+/g, '-'),
      name: channel.name,
      sourceKind:
        /^Mic/i.test(channel.name)
          ? 'microphone'
          : channel.name === 'System'
            ? 'system'
            : channel.name === 'Media'
              ? 'media'
              : 'unknown',
      volume: channel.volume,
      muted: channel.muted,
      delayMs: channel.delayMs || 0,
      monitorEnabled: !!channel.monitorEnabled,
    }));
  }, [studio.audioChannels]);

  useEffect(() => {
    localStorage.setItem('aether_browser_source_url', browserSourceUrl);
  }, [browserSourceUrl]);

  useEffect(() => {
    studio.setSources((prev) => prev.map((source) => {
      if (source.name !== 'Browser Source') {
        return source;
      }

      return {
        ...source,
        status: browserSourceRuntime.state === 'active'
          ? 'active'
          : browserSourceUrl
            ? 'standby'
            : 'offline',
        resolution: browserSourceRuntime.resolution !== 'Unknown'
          ? browserSourceRuntime.resolution
          : source.resolution,
        fps: browserSourceRuntime.fps || source.fps,
        audioLevel: 0,
      };
    }));
  }, [browserSourceRuntime.fps, browserSourceRuntime.resolution, browserSourceRuntime.state, browserSourceUrl, studio.setSources]);

  useEffect(() => {
    if (!browserSourceUrl || !browserSourceRuntime.error) {
      lastBrowserSourceNoticeRef.current = null;
      return;
    }

    if (lastBrowserSourceNoticeRef.current === browserSourceRuntime.error) {
      return;
    }

    lastBrowserSourceNoticeRef.current = browserSourceRuntime.error;
    notify(`Browser Source: ${browserSourceRuntime.error}`, 'warning');
  }, [browserSourceRuntime.error, browserSourceUrl, notify]);

  const scriptRunner = useScriptRunner({ scenes: studio.scenes, setActiveScene: studio.setActiveScene });
  useEffect(() => {
    if (!scriptRunner.activeScript) scriptRunner.setActiveScript(SAMPLE_SCRIPT);
  }, []);

  const ai = useAIDirector({
    scenes: studio.scenes, activeScene: studio.activeScene, sources: studio.sources,
    isStreaming: studio.isStreaming, telemetry,
    setActiveScene: studio.setActiveScene, addLog: studio.addLog,
  });

  const appendStudioLog = React.useCallback((message: string, type: ServerLog['type'] = 'info') => {
    studio.setServerLogs((prev) => [
      { message, type, id: Date.now() + Math.random() } as ServerLog,
      ...prev,
    ].slice(0, 50));
  }, [studio.setServerLogs]);

  // ── Menu Handler ──────────────────────────────────────────────────────────
  const resolveLuminaProfile = React.useCallback((payload?: Record<string, unknown>): EncodingProfile | null => {
    if (!payload) return null;

    const candidate = [
      payload.profile,
      payload.encodingProfile,
      payload.outputProfile,
      payload.quality,
    ].find((value): value is string => typeof value === 'string' && value.trim().length > 0);

    if (!candidate) {
      return null;
    }

    const normalized = candidate.trim().toLowerCase().replace(/\s+/g, '');
    const profileMap: Record<string, EncodingProfile> = {
      '1080p60': '1080p60',
      '1080p30': '1080p30',
      '1080p': '1080p30',
      '720p30': '720p30',
      '720p': '720p30',
      '480p30': '480p30',
      '480p': '480p30',
    };

    const resolved = profileMap[normalized];
    if (!resolved) {
      appendStudioLog(`Lumina requested unsupported profile '${candidate}'. Using the current Aether profile instead.`, 'warning');
      return null;
    }

    return resolved;
  }, [appendStudioLog]);

  const resolveLuminaDestinations = React.useCallback((payload?: Record<string, unknown>): StreamDestination[] => {
    const enabledDestinations = streaming.destinations.filter((destination) => destination.enabled);
    if (!payload) {
      return enabledDestinations;
    }

    const requestedIds = Array.isArray(payload.destinationIds)
      ? payload.destinationIds.filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
      : [];
    const requestedNames = Array.isArray(payload.destinationNames)
      ? payload.destinationNames.filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
      : [];
    const requestedDestination = typeof payload.destination === 'string' && payload.destination.trim().length > 0
      ? payload.destination.trim()
      : null;

    if (!requestedIds.length && !requestedNames.length && !requestedDestination) {
      return enabledDestinations;
    }

    const requestedIdSet = new Set(requestedIds.map((value) => value.toLowerCase()));
    const requestedNameSet = new Set(requestedNames.map((value) => value.toLowerCase()));
    if (requestedDestination) {
      requestedIdSet.add(requestedDestination.toLowerCase());
      requestedNameSet.add(requestedDestination.toLowerCase());
    }

    const matches = streaming.destinations.filter((destination) =>
      requestedIdSet.has(destination.id.toLowerCase()) ||
      requestedNameSet.has(destination.name.trim().toLowerCase()),
    );

    if (!matches.length) {
      appendStudioLog('Lumina requested destinations that do not match any saved Aether destinations.', 'warning');
      return [];
    }

    const deduped = new Map<string, StreamDestination>();
    for (const destination of matches) {
      deduped.set(destination.id, {
        ...destination,
        enabled: true,
      });
    }

    return Array.from(deduped.values());
  }, [appendStudioLog, streaming.destinations]);

  const applyLuminaScenePreference = React.useCallback((payload?: Record<string, unknown>) => {
    if (!payload) return;

    const requestedScene = [
      payload.sceneName,
      payload.target,
      payload.scene,
      payload.name,
    ].find((value): value is string => typeof value === 'string' && value.trim().length > 0);

    if (requestedScene) {
      const requestedLower = requestedScene.trim().toLowerCase();
      const matchingScene = studio.scenes.find((scene) => scene.name.trim().toLowerCase() === requestedLower);
      if (matchingScene) {
        studio.setActiveScene(matchingScene);
        appendStudioLog(`Lumina prepared scene '${matchingScene.name}' before going live.`, 'info');
        return;
      }

      const matchingPreset = studio.scenePresets.find((preset) => preset.name.trim().toLowerCase() === requestedLower);
      if (matchingPreset) {
        studio.loadScenePreset(matchingPreset.id);
        appendStudioLog(`Lumina loaded preset '${matchingPreset.name}' before going live.`, 'info');
        return;
      }
    }

    const requestedTheme = [
      payload.themeName,
      payload.theme,
    ].find((value): value is string => typeof value === 'string' && value.trim().length > 0);

    if (requestedTheme) {
      studio.setActiveTheme(requestedTheme);
      appendStudioLog(`Lumina applied theme '${requestedTheme}' before going live.`, 'info');
      return;
    }

    if (requestedScene) {
      appendStudioLog(`Lumina requested '${requestedScene}' but no saved scene or preset matched.`, 'warning');
    }
  }, [
    appendStudioLog,
    studio.loadScenePreset,
    studio.scenePresets,
    studio.scenes,
    studio.setActiveScene,
    studio.setActiveTheme,
  ]);

  const stopConfiguredStreaming = React.useCallback(async (origin: 'Operator' | 'Lumina') => {
    if (nativeEngine.isStreaming) {
      await nativeEngine.stopStream();
      studio.setIsStreaming(false);
      appendStudioLog(`${origin} stopped the live stream.`, 'info');
      if (origin === 'Lumina') {
        notify('Lumina stopped the live stream.', 'info');
      }
      return true;
    }

    if (studio.isStreaming) {
      streaming.stopStreaming();
      studio.setIsStreaming(false);
      appendStudioLog(`${origin} stopped the browser live stream.`, 'info');
      if (origin === 'Lumina') {
        notify('Lumina stopped the live stream.', 'info');
      }
      return true;
    }

    appendStudioLog(`${origin} requested stop, but nothing is live right now.`, 'warning');
    return false;
  }, [appendStudioLog, nativeEngine, notify, streaming, studio]);

  const startConfiguredStreaming = React.useCallback(async ({
    origin,
    payload,
  }: {
    origin: 'Operator' | 'Lumina';
    payload?: Record<string, unknown>;
  }) => {
    if (nativeEngine.isStreaming || studio.isStreaming) {
      appendStudioLog(`${origin} requested start, but the stream is already live.`, 'warning');
      return true;
    }

    if (payload) {
      applyLuminaScenePreference(payload);
    }

    const requestedProfile = resolveLuminaProfile(payload) || streaming.encodingProfile;
    const activeDestinations = resolveLuminaDestinations(payload);

    if (!activeDestinations.length) {
      appendStudioLog(`${origin} could not start streaming because no saved destinations were selected.`, 'warning');
      if (origin === 'Operator') {
        studio.setShowStreamSettings(true);
      } else {
        notify('Lumina start ignored: no matching Aether destinations were found.', 'warning');
      }
      return false;
    }

    const incompleteDestination = activeDestinations.find((destination) =>
      !(destination.rtmpUrl || destination.url) || !destination.streamKey?.trim(),
    );
    if (incompleteDestination) {
      appendStudioLog(`${origin} could not start streaming because '${incompleteDestination.name}' is missing a URL or stream key.`, 'warning');
      if (origin === 'Operator') {
        studio.setShowStreamSettings(true);
      } else {
        notify(`Lumina start ignored: '${incompleteDestination.name}' is not fully configured in Aether.`, 'warning');
      }
      return false;
    }

    if (nativeEngine.isAvailable) {
      const captureSurface = programViewRef.current?.getNativeCaptureSurface();
      if (!captureSurface?.canvas) {
        appendStudioLog(`${origin} could not start streaming because the program output is not ready.`, 'warning');
        notify('Program output is not ready yet. Wait for the preview to initialize and retry.', 'warning');
        return false;
      }

      const activeSourceFeeds = nativeSourceFeeds.getCaptureSources();
      const hasVideoSources = nativeVideoSources.length > 0 || activeSourceFeeds.length > 0;

      const micChannels = studio.audioChannels.filter((channel) => /^Mic/i.test(channel.name));
      const systemChannel = studio.audioChannels.find((channel) => channel.name === 'System');

      try {
        const message = await nativeEngine.startStream(captureSurface, activeDestinations, {
          encodingProfile: requestedProfile,
          audioMode: 'auto',
          includeMicrophone: micChannels.some((channel) => !channel.muted && channel.volume > 0),
          includeSystemAudio: systemChannel ? !systemChannel.muted && systemChannel.volume > 0 : true,
          audioBuses: nativeAudioBuses,
          nativeVideoSources,
          // Only pass sourceFeeds when there are active WebRTC/media sources.
          // With no sources, omit this so startStream uses raw canvas mode instead
          // of native-scene mode (which starts an idle source bridge with no feeds).
          sourceFeeds: hasVideoSources ? nativeSourceFeeds.getCaptureSources : undefined,
        });

        studio.setIsStreaming(true);
        appendStudioLog(`${origin} started the live stream (${requestedProfile}, ${activeDestinations.length} destination${activeDestinations.length === 1 ? '' : 's'}).`, 'success');
        notify(origin === 'Lumina' ? 'Lumina started the live stream.' : `GPU Stream: ${message}`, 'success');
        return true;
      } catch (error: any) {
        const message = error?.message || String(error);
        appendStudioLog(`${origin} failed to start the live stream: ${message}`, 'error');
        notify(`GPU stream failed: ${message}. Check FFmpeg and retry.`, 'error');
        return false;
      }
    }

    if (origin === 'Lumina') {
      appendStudioLog('Lumina start requests are desktop-only. Browser mode ignored the command.', 'warning');
      notify('Lumina live control is available only in the desktop app.', 'warning');
      return false;
    }

    await streaming.startStreaming(() => studio.setShowStreamSettings(true));
    appendStudioLog(`Operator started browser streaming (${requestedProfile}).`, 'info');
    return true;
  }, [
    appendStudioLog,
    applyLuminaScenePreference,
    nativeAudioBuses,
    nativeEngine,
    nativeSourceFeeds,
    nativeVideoSources,
    notify,
    resolveLuminaDestinations,
    resolveLuminaProfile,
    streaming,
    studio,
  ]);

  const handleLuminaStreamRequest = React.useCallback((request: LuminaStreamRequest) => {
    const payload = request.payload || {};

    if (!window.__TAURI_INTERNALS__) {
      appendStudioLog('Lumina stream control is available only in the desktop app. Browser mode ignored the request.', 'warning');
      return;
    }

    const action = [
      payload.action,
      payload.command,
      payload.state,
    ].find((value): value is string => typeof value === 'string' && value.trim().length > 0);

    if (!action) {
      appendStudioLog('Lumina stream request arrived without an action.', 'warning');
      return;
    }

    const normalizedAction = action.trim().toLowerCase();
    appendStudioLog(`Lumina stream request: ${normalizedAction}`, 'info');

    if (normalizedAction === 'start') {
      void startConfiguredStreaming({ origin: 'Lumina', payload });
      return;
    }

    if (normalizedAction === 'stop') {
      void stopConfiguredStreaming('Lumina');
      return;
    }

    if (normalizedAction === 'toggle') {
      if (nativeEngine.isStreaming || studio.isStreaming) {
        void stopConfiguredStreaming('Lumina');
      } else {
        void startConfiguredStreaming({ origin: 'Lumina', payload });
      }
      return;
    }

    appendStudioLog(`Lumina requested unsupported stream action '${action}'.`, 'warning');
  }, [appendStudioLog, nativeEngine.isStreaming, startConfiguredStreaming, stopConfiguredStreaming, studio.isStreaming]);

  luminaStreamRequestHandlerRef.current = handleLuminaStreamRequest;

  const handleMenuAction = (action: string) => {
    const [, item] = action.split(':');
    switch (item) {
      case 'Add Camera': studio.setShowHardwareSetup(true); break;
      case 'Add Screen Share': webrtc.startScreenShare(); break;
      case 'Add Browser Source': {
        const nextUrl = window.prompt(
          'Enter a direct image or video URL for Browser Source. Leave blank to clear it.',
          browserSourceUrl,
        );
        if (nextUrl === null) break;
        const trimmed = nextUrl.trim();
        setBrowserSourceUrl(trimmed);
        if (trimmed) {
          notify('Browser Source configured', 'success');
        } else {
          notify('Browser Source cleared', 'info');
        }
        break;
      }
      case 'Exit': webrtc.stopCamera(); window.close(); break;
      case 'Start Streaming': studio.setShowStreamSettings(true); break;
      case 'Stop Streaming':
        void stopConfiguredStreaming('Operator');
        break;
      case 'Stream Settings': studio.setShowStreamSettings(true); break;
      case 'Output Quality': setShowOutputQuality(true); break;
      case 'Save Project': setShowProjectDialog(true); break;
      case 'Open Project': setShowProjectDialog(true); break;
      case 'Toggle Source Rack': setShowSourceRack(prev => !prev); break;
      case 'Toggle Director Rack': setShowDirectorRack(prev => !prev); break;
      case 'Toggle Telemetry': setShowTelemetry(prev => !prev); break;
      case 'Documentation':
        window.open('https://github.com/Coolzymccooy/AetherCast', '_blank', 'noopener,noreferrer');
        break;
      case 'Keyboard Shortcuts': setShowShortcuts(true); break;
      case 'Download Desktop App': setShowDownload(true); break;
      case 'Check for Updates': setShowCheckUpdates(true); break;
      case 'About Aether Studio': setShowAbout(true); break;
      case 'Scene Transitions': setShowTransitions(true); break;
      default: break;
    }
  };

  const activeScript = scriptRunner.activeScript || SAMPLE_SCRIPT;

  useEffect(() => {
    if (window.__TAURI_INTERNALS__) {
      studio.setIsStreaming(nativeEngine.isStreaming);
    }
  }, [nativeEngine.isStreaming, studio.setIsStreaming]);

  useEffect(() => {
    if (!nativeEngine.isAvailable) return;

    const remoteIds = Array.from(webrtc.remoteStreams.keys());
    const remoteSourceCount = remoteIds.filter((id) => !id.startsWith('local-cam-')).length;
    const hasLocalCam2 = remoteIds.includes('local-cam-2');

    const snapshot = buildNativeSceneSnapshot({
      activeScene: studio.activeScene,
      layout: studio.layout,
      transitionType: studio.transition,
      sources: studio.sources,
      lowerThirds: studio.lowerThirds,
      graphics: {
        showBug: studio.activeGraphics.has('Bug - Logo'),
        showSocials: studio.activeGraphics.has('Overlay - Socials'),
      },
      background: studio.background,
      frameStyle: studio.frameStyle,
      motionStyle: studio.motionStyle,
      brandColor: studio.brandColor,
      sourceSwap: studio.sourceSwap,
      audienceMessages: studio.audienceMessages,
      activeMessageId: studio.activeMessageId,
      webcamAvailable: !!webrtc.webcamStream,
      screenAvailable: !!webrtc.screenStream,
      remoteSourceCount,
      hasLocalCam2,
    });
    const sourceInventory = buildNativeSourceInventory({
      sources: studio.sources,
      webcamAvailable: !!webrtc.webcamStream,
      screenAvailable: !!webrtc.screenStream,
      remoteSourceCount,
      hasLocalCam2,
      nativeOwnedSourceIds,
      mediaAvailable: !!mediaPlayer.playbackState.currentItem,
      browserAvailable: browserSourceRuntime.isCapturable,
    });

    void nativeEngine.syncSceneSnapshot(snapshot);
    void nativeEngine.syncSourceInventory(sourceInventory);
  }, [
    nativeEngine.isAvailable,
    nativeEngine.syncSceneSnapshot,
    nativeEngine.syncSourceInventory,
    studio.activeScene,
    studio.layout,
    studio.transition,
    studio.sources,
    studio.lowerThirds,
    studio.activeGraphics,
    studio.background,
    studio.frameStyle,
    studio.motionStyle,
    studio.brandColor,
    studio.sourceSwap,
    studio.audienceMessages,
    studio.activeMessageId,
    nativeEngine.isStreaming,
    mediaPlayer.playbackState.currentItem,
    webrtc.webcamStream,
    webrtc.screenStream,
    webrtc.remoteStreams,
    nativeOwnedSourceIdsKey,
  ]);

  useEffect(() => {
    if (!nativeEngine.isAvailable) {
      window.__AETHER_EXPORT_NATIVE_DIAGNOSTICS__ = undefined;
      return;
    }

    window.__AETHER_EXPORT_NATIVE_DIAGNOSTICS__ = nativeEngine.exportDiagnostics;
    return () => {
      window.__AETHER_EXPORT_NATIVE_DIAGNOSTICS__ = undefined;
    };
  }, [nativeEngine.exportDiagnostics, nativeEngine.isAvailable]);

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="h-screen flex flex-col bg-bg text-gray-300 overflow-hidden select-none font-sans">
      <MenuBar
        onOpenGallery={() => studio.setShowRecordingGallery(true)}
        onOpenEditor={() => studio.setShowScriptEditor(true)}
        onAction={handleMenuAction}
        zoomLevel={zoomLevel}
        onZoomIn={zoomIn}
        onZoomOut={zoomOut}
        onZoomReset={zoomReset}
        onOpenSettings={() => setShowPeerSettings(true)}
      />

      {/* Engine status bar */}
      <div className="flex items-center justify-end px-4 py-1 bg-black/20 border-b border-border gap-4">
        <div className="flex items-center gap-2 mr-auto">
          <div className={`w-2 h-2 rounded-full ${webrtc.isSocketConnected ? 'bg-accent-cyan animate-pulse' : 'bg-accent-red'}`} />
          <span className="text-[10px] font-bold uppercase tracking-wider text-gray-500">
            {webrtc.isSocketConnected ? 'Engine Connected' : 'Engine Offline'}
          </span>
          {!webrtc.isSocketConnected && (
            <button onClick={webrtc.reconnectSocket} className="text-[10px] text-accent-cyan underline hover:text-white ml-2">
              Reconnect
            </button>
          )}
        </div>
        <button
          onClick={() => studio.setShowServerLogs(!studio.showServerLogs)}
          className={`text-[10px] font-bold uppercase tracking-wider flex items-center gap-2 px-2 py-1 rounded transition-colors ${studio.showServerLogs ? 'bg-accent-cyan text-bg' : 'text-accent-cyan hover:bg-accent-cyan/10'}`}
        >
          <Terminal size={12} /> Server Logs
        </button>
      </div>

      {showTelemetry && (
        <TelemetryBar telemetry={telemetry} isStreaming={studio.isStreaming} isRecording={streaming.isRecording} luminaConnected={luminaConnected} onOpenLuminaPair={() => studio.setShowLuminaPairModal(true)} />
      )}

      <div className="flex-1 flex overflow-hidden" style={{ transform: `scale(${zoomLevel / 100})`, transformOrigin: 'top left', width: `${10000 / zoomLevel}%`, height: `${10000 / zoomLevel}%` }}>
        {showSourceRack && (
        <ErrorBoundary name="Source Rack" onError={(err) => notify(err.message, 'error')}>
        <SourceRack sources={studio.sources} onSourceClick={s => {
          const scene =
            s.name === 'Screen Share'
              ? studio.scenes.find(sc => sc.type === 'SCREEN')
              : studio.scenes.find(sc => sc.name === s.name);
          if (scene) studio.setActiveScene(scene);
        }} />
        </ErrorBoundary>
        )}

        <div className="flex-1 flex flex-col min-w-0 min-h-0">
          <ErrorBoundary name="Compositor" onError={(err) => notify(err.message, 'error')}>
          <ProgramView
            ref={programViewRef}
            activeScene={studio.activeScene}
            sources={studio.sources}
            isStreaming={studio.isStreaming}
            isRecording={streaming.isRecording}
            onToggleStreaming={() => {
              if (studio.isStreaming || nativeEngine.isStreaming) {
                void stopConfiguredStreaming('Operator');
                return;
              } else {
                // Start — prefer GPU path if available
                void startConfiguredStreaming({ origin: 'Operator' });
                return;
                const activeDestinations = streaming.destinations.filter(d => d.enabled);
                if (activeDestinations.length === 0 || !activeDestinations.every(d => d.streamKey)) {
                  studio.setShowStreamSettings(true);
                  return;
                }

                if (nativeEngine.isAvailable) {
                  // Desktop (Tauri) — use the native engine with raw RGBA frame transport.
                  // No server-side FFmpeg needed; encoding happens locally.
                  const captureSurface = programViewRef.current?.getNativeCaptureSurface();
                  if (captureSurface?.canvas) {
                    const micChannels = studio.audioChannels.filter((channel) => /^Mic/i.test(channel.name));
                    const systemChannel = studio.audioChannels.find((channel) => channel.name === 'System');
                    nativeEngine.startStream(captureSurface, activeDestinations, {
                      encodingProfile: streaming.encodingProfile,
                      audioMode: 'auto',
                      includeMicrophone: micChannels.some((channel) => !channel.muted && channel.volume > 0),
                      includeSystemAudio: systemChannel ? !systemChannel.muted && systemChannel.volume > 0 : true,
                      audioBuses: nativeAudioBuses,
                      nativeVideoSources,
                      sourceFeeds: nativeSourceFeeds.getCaptureSources,
                    }).then((msg) => {
                      studio.setIsStreaming(true);
                      notify(`GPU Stream: ${msg}`, 'success');
                    }).catch((err) => {
                      console.error('[GPU] start_stream failed:', err);
                      // Don't auto-fallback to browser path — that triggers server-side FFmpeg
                      // which crashes on weak servers. Show error and let user retry or use web mode.
                      notify(`GPU stream failed: ${err?.message || err}. Check FFmpeg and retry.`, 'error');
                    });
                  } else {
                    notify('Program output is not ready yet. Wait for the preview to initialize and retry.', 'warning');
                  }
                } else {
                  // Browser-only (web) — stream via Socket.io → server FFmpeg → RTMP
                  streaming.startStreaming(() => studio.setShowStreamSettings(true));
                }
              }
            }}
            onToggleRecording={() => streaming.isRecording ? streaming.stopRecording() : streaming.startRecording()}
            webcamStream={webrtc.webcamStream}
            remoteStreams={webrtc.remoteStreams}
            screenStream={webrtc.screenStream}
            transitionType={studio.transition}
            layout={studio.layout}
            lowerThirds={studio.lowerThirds}
            graphics={{ showBug: studio.activeGraphics.has('Bug - Logo'), showSocials: studio.activeGraphics.has('Overlay - Socials') }}
            backgroundImage={ai.backgroundImage}
            theme={studio.activeTheme}
            background={studio.background}
            frameStyle={studio.frameStyle}
            motionStyle={studio.motionStyle}
            brandColor={studio.brandColor}
            camoSettings={studio.camoSettings}
            sourceSwap={studio.sourceSwap}
            audienceMessages={studio.audienceMessages}
            activeMessageId={studio.activeMessageId}
            extraCaptureSources={mediaCaptureSources}
          />
          </ErrorBoundary>

          <div className="h-72 flex-shrink-0 flex border-t border-border bg-panel overflow-hidden">
            <ErrorBoundary name="Scene Switcher" onError={(err) => notify(err.message, 'error')}>
            <SceneSwitcher scenes={studio.scenes} activeScene={studio.activeScene} onSceneChange={studio.setActiveScene} />
            </ErrorBoundary>
            <ErrorBoundary name="Audio Mixer" onError={(err) => notify(err.message, 'error')}>
            <AudioMixer
              channels={studio.audioChannels}
              onToggleMute={studio.toggleMute}
              onLevelChange={studio.onLevelChange}
              onOpenSettings={() => studio.setActiveTab('FX')}
            />
            </ErrorBoundary>
          </div>
        </div>

        {showDirectorRack && (
        <ErrorBoundary name="Director Rack" onError={(err) => notify(err.message, 'error')}>
        <DirectorRack
          aiMode={ai.aiMode}
          setAiMode={ai.setAiMode}
          layout={studio.layout}
          setLayout={studio.setLayout}
          activeGraphics={studio.activeGraphics}
          toggleGraphic={studio.toggleGraphic}
          telemetry={telemetry}
          script={activeScript}
          currentStepIndex={scriptRunner.currentStepIndex}
          isScriptRunning={scriptRunner.isScriptRunning}
          toggleScript={() => scriptRunner.toggleScript(activeScript)}
          skipStep={() => scriptRunner.skipStep(activeScript)}
          isRemoteConnected={webrtc.isRemoteConnected}
          toggleRemote={() => webrtc.setIsRemoteConnected(!webrtc.isRemoteConnected)}
          activeTab={studio.activeTab}
          setActiveTab={studio.setActiveTab}
          lowerThirds={studio.lowerThirds}
          setLowerThirds={studio.setLowerThirds}
          toggleLowerThirds={studio.toggleLowerThirds}
          showLowerThirdsTimed={studio.showLowerThirdsTimed}
          composerMode={studio.composerMode}
          setComposerMode={studio.setComposerMode}
          generativePrompt={ai.generativePrompt}
          setGenerativePrompt={ai.setGenerativePrompt}
          isGenerating={ai.isGenerating}
          generateBackground={ai.generateBackground}
          transition={studio.transition}
          setTransition={studio.setTransition}
          transitionSpeed={studio.transitionSpeed}
          setTransitionSpeed={studio.setTransitionSpeed}
          phoneSlots={studio.phoneSlots}
          onAddPhone={() => { studio.setQrMode('camera'); studio.setShowQrModal(true); }}
          scenePresets={studio.scenePresets}
          saveScenePreset={studio.saveScenePreset}
          loadScenePreset={studio.loadScenePreset}
          deleteScenePreset={studio.deleteScenePreset}
          emergencyWide={studio.emergencyWide}
          cutToNext={studio.cutToNext}
          executeAiAction={ai.executeAiAction}
          aiSuggestion={ai.aiSuggestion}
          setAiSuggestion={ai.setAiSuggestion}
          activeTheme={studio.activeTheme}
          setActiveTheme={studio.setActiveTheme}
          swapSources={studio.swapSources}
          setServerLogs={studio.setServerLogs}
          scenes={studio.scenes}
          setActiveScene={studio.setActiveScene}
          background={studio.background}
          setBackground={studio.setBackground}
          frameStyle={studio.frameStyle}
          setFrameStyle={studio.setFrameStyle}
          motionStyle={studio.motionStyle}
          setMotionStyle={studio.setMotionStyle}
          brandColor={studio.brandColor}
          setBrandColor={studio.setBrandColor}
          camoSettings={studio.camoSettings}
          setCamoSettings={studio.setCamoSettings}
          audienceMessages={studio.audienceMessages}
          setAudienceMessages={studio.setAudienceMessages}
          activeMessageId={studio.activeMessageId}
          setActiveMessageId={studio.setActiveMessageId}
          onOpenQrModal={() => { studio.setQrMode('audience'); studio.setShowQrModal(true); }}
          proAudio={{
            channels: studio.audioChannels.map(c => ({ name: c.name })),
            loudness: proAudio.loudness,
            channelMeters: proAudio.channelMeters,
            onSetNoiseGate: proAudio.setChannelNoiseGate,
            onSetCompressor: proAudio.setChannelCompressor,
            onSetEQ: proAudio.setChannelEQ,
            onSetMasterLimiter: proAudio.updateMasterLimiter,
          }}
          mediaPlayer={{
            playlist: mediaPlayer.playlist,
            playbackState: mediaPlayer.playbackState,
            onAddMedia: mediaPlayer.addMedia,
            onRemoveMedia: mediaPlayer.removeMedia,
            onPlay: mediaPlayer.play,
            onPause: mediaPlayer.pause,
            onStop: mediaPlayer.stop,
            onNext: mediaPlayer.next,
            onPrevious: mediaPlayer.previous,
            onSeek: mediaPlayer.seek,
            onSetVolume: mediaPlayer.setVolume,
            onSetLoop: mediaPlayer.setLoop,
          }}
          replay={{
            isBuffering: replay.isBuffering,
            clips: replay.clips,
            bufferStats: replay.bufferStats,
            onStartBuffer: () => {
              const canvas = document.querySelector('canvas');
              if (canvas) replay.startBuffer(canvas);
            },
            onStopBuffer: replay.stopBuffer,
            onCaptureReplay: replay.captureReplay,
            onPlayReplay: replay.playReplay,
            onDeleteClip: replay.deleteClip,
          }}
          midi={{
            isSupported: midi.isSupported,
            isInitialized: midi.isInitialized,
            devices: midi.devices,
            selectedDevice: midi.selectedDevice,
            onSelectDevice: midi.selectDevice,
            mappings: midi.mappings,
            onUpdateMappings: midi.updateMappings,
            isLearning: midi.isLearning,
            onStartLearn: midi.startLearn,
            onStopLearn: midi.stopLearn,
          }}
        />
        </ErrorBoundary>
        )}
      </div>

      {/* Notifications */}
      <NotificationToast notifications={notifications} onDismiss={dismiss} />

      {/* Overlays */}
      <AnimatePresence>
        {studio.showServerLogs && (
          <ServerLogsPanel logs={studio.serverLogs} onClose={() => studio.setShowServerLogs(false)} onClear={() => studio.setServerLogs([])} />
        )}

        {studio.showHardwareSetup && (
          <HardwareSetupModal
            devices={webrtc.devices}
            selectedVideoDevice={webrtc.selectedVideoDevice}
            setSelectedVideoDevice={webrtc.setSelectedVideoDevice}
            selectedVideoDevice2={webrtc.selectedVideoDevice2}
            setSelectedVideoDevice2={webrtc.setSelectedVideoDevice2}
            selectedAudioDevice={webrtc.selectedAudioDevice}
            setSelectedAudioDevice={webrtc.setSelectedAudioDevice}
            onClose={() => studio.setShowHardwareSetup(false)}
            onRefreshDevices={webrtc.refreshDevices}
            onStart={() => {
              webrtc.startCamera(webrtc.selectedVideoDevice, webrtc.selectedAudioDevice, webrtc.selectedVideoDevice2);
              studio.setShowHardwareSetup(false);
            }}
          />
        )}

        {studio.showStreamSettings && (
          <StreamSettingsModal
            destinations={streaming.destinations}
            setDestinations={streaming.setDestinations}
            onClose={() => studio.setShowStreamSettings(false)}
            onStart={() => {
              void startConfiguredStreaming({ origin: 'Operator' });
            }}
          />
        )}

        {studio.showQrModal && (
          <QrModal qrMode={studio.qrMode} setQrMode={studio.setQrMode} onClose={() => studio.setShowQrModal(false)} />
        )}

        {studio.showLuminaPairModal && (
          <LuminaPairModal onClose={() => studio.setShowLuminaPairModal(false)} />
        )}

        {showPeerSettings && (
          <PeerSettingsModal onClose={() => setShowPeerSettings(false)} />
        )}

        {studio.showRecordingGallery && (
          <RecordingGallery
            recordings={streaming.recordings}
            onClose={() => studio.setShowRecordingGallery(false)}
            onDelete={(id) => streaming.setRecordings(prev => prev.filter(r => r.id !== id))}
            onPlay={(rec) => studio.setSelectedVideo(rec)}
          />
        )}

        {studio.selectedVideo && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-[60] flex items-center justify-center p-8 bg-black/95 backdrop-blur-md">
            <div className="w-full max-w-5xl aspect-video bg-black relative rounded-lg overflow-hidden shadow-2xl border border-white/10">
              <video src={studio.selectedVideo.url} controls autoPlay className="w-full h-full" />
              <button onClick={() => studio.setSelectedVideo(null)} className="absolute top-4 right-4 p-2 bg-black/50 hover:bg-black/80 rounded-full text-white">
                <X size={24} />
              </button>
            </div>
          </motion.div>
        )}

        {studio.showScriptEditor && (
          <ScriptEditor
            script={activeScript}
            onClose={() => studio.setShowScriptEditor(false)}
            onSave={(s) => {
              scriptRunner.setActiveScript(s);
              scriptRunner.setCurrentStepIndex(0);
              scriptRunner.setIsScriptRunning(false);
              studio.setShowScriptEditor(false);
            }}
          />
        )}

        {ai.aiSuggestion && (
          <motion.div initial={{ y: 100, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 100, opacity: 0 }}
            className="fixed bottom-6 right-80 z-50 w-80 bg-bg border border-accent-cyan/30 shadow-2xl rounded-lg overflow-hidden">
            <div className="bg-accent-cyan/10 p-3 border-b border-accent-cyan/20 flex items-center gap-2">
              <Brain size={16} className="text-accent-cyan" />
              <span className="text-xs font-bold uppercase tracking-wider text-accent-cyan">AI Director Suggestion</span>
            </div>
            <div className="p-4 space-y-3">
              <p className="text-xs text-white">Switch to <span className="font-bold text-accent-cyan">{ai.aiSuggestion.scene}</span>?</p>
              <p className="text-[10px] text-gray-500 italic">"{ai.aiSuggestion.reason}"</p>
              <div className="flex gap-2">
                <button onClick={ai.executeAiAction} className="flex-1 bg-accent-cyan text-bg text-[10px] font-bold py-1.5 rounded-sm hover:bg-cyan-400 active:scale-95 transition-all">Execute</button>
                <button onClick={() => ai.setAiSuggestion(null)} className="flex-1 bg-gray-800 text-gray-400 text-[10px] font-bold py-1.5 rounded-sm hover:text-white active:scale-95 transition-all">Dismiss</button>
              </div>
            </div>
          </motion.div>
        )}

        {/* Output Quality */}
        {showOutputQuality && (
          <OutputQualityModal
            encodingProfile={streaming.encodingProfile}
            setEncodingProfile={streaming.setEncodingProfile}
            onClose={() => setShowOutputQuality(false)}
          />
        )}

        {/* Project Dialog */}
        {showProjectDialog && (
          <ProjectDialog
            projectName={project.projectName}
            onSetProjectName={project.setProjectName}
            canUndo={project.canUndo}
            canRedo={project.canRedo}
            onUndo={project.undo}
            onRedo={project.redo}
            onSave={() => project.saveProject({
              scenes: studio.scenes,
              activeSceneId: studio.activeScene.id,
              layout: studio.layout,
              background: studio.background,
              frameStyle: studio.frameStyle,
              motionStyle: studio.motionStyle,
              brandColor: studio.brandColor,
              activeTheme: studio.activeTheme,
              camoSettings: studio.camoSettings,
              lowerThirds: studio.lowerThirds,
              presets: studio.scenePresets,
              audioChannels: studio.audioChannels.map(c => ({ name: c.name, volume: c.volume, muted: c.muted })),
            })}
            onLoad={async (file: File) => {
              const proj = await project.loadProject(file);
              if (proj.layout) studio.setLayout(proj.layout);
              if (proj.background) studio.setBackground(proj.background);
              if (proj.frameStyle) studio.setFrameStyle(proj.frameStyle);
              if (proj.activeTheme) studio.setActiveTheme(proj.activeTheme);
              if (proj.brandColor) studio.setBrandColor(proj.brandColor);
              setShowProjectDialog(false);
              notify('Project loaded successfully', 'success');
            }}
            hasAutoSave={project.hasAutoSave}
            onRecoverAutoSave={() => {
              const saved = project.recoverAutoSave();
              if (saved) {
                if (saved.layout) studio.setLayout(saved.layout);
                if (saved.background) studio.setBackground(saved.background);
                notify('Session recovered from auto-save', 'success');
              }
              setShowProjectDialog(false);
            }}
            onClose={() => setShowProjectDialog(false)}
          />
        )}

        {/* Save Preset Modal */}
        {studio.showSavePresetModal && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm">
            <motion.div initial={{ scale: 0.95 }} animate={{ scale: 1 }} exit={{ scale: 0.95 }}
              className="bg-panel border border-border rounded-xl p-6 w-80 shadow-2xl">
              <h3 className="text-sm font-bold uppercase tracking-widest text-white mb-4">Save Scene Preset</h3>
              <input type="text" value={studio.presetNameInput} onChange={(e) => studio.setPresetNameInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && studio.confirmSavePreset()}
                className="w-full bg-black border border-border rounded-lg px-3 py-2.5 text-xs text-white focus:outline-none focus:border-accent-cyan mb-4"
                placeholder="Preset name" autoFocus />
              <div className="flex gap-2">
                <button onClick={() => studio.setShowSavePresetModal(false)} className="flex-1 py-2 border border-border rounded text-[10px] font-bold uppercase text-gray-400 hover:bg-white/5">Cancel</button>
                <button onClick={studio.confirmSavePreset} className="flex-1 py-2 bg-accent-cyan text-bg rounded text-[10px] font-bold uppercase hover:bg-cyan-400">Save</button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Keyboard Shortcuts Overlay */}
      {showShortcuts && <KeyboardShortcuts onClose={() => setShowShortcuts(false)} />}

      {/* Download Desktop App Modal */}
      {showDownload && <DownloadModal onClose={() => setShowDownload(false)} />}

      {/* Check for Updates Modal */}
      {showCheckUpdates && <CheckForUpdatesModal onClose={() => setShowCheckUpdates(false)} />}

      {/* About Aether Studio Modal */}
      {showAbout && <AboutModal onClose={() => setShowAbout(false)} />}

      {/* Scene Transitions Modal */}
      {showTransitions && (
        <SceneTransitionsModal
          config={transitionConfig}
          onSave={setTransitionConfig}
          onClose={() => setShowTransitions(false)}
        />
      )}
    </div>
  );
}
