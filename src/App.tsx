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
import { useGPUStreaming } from './hooks/useGPUStreaming';

// --- Studio Components ---
import { MenuBar } from './components/studio/MenuBar';
import { TelemetryBar } from './components/studio/TelemetryBar';
import { SourceRack } from './components/studio/SourceRack';
import { ProgramView } from './components/studio/ProgramView';
import { SceneSwitcher } from './components/studio/SceneSwitcher';
import { AudioMixer } from './components/studio/AudioMixer';
import { DirectorRack } from './components/studio/DirectorRack';
import { RecordingGallery } from './components/studio/RecordingGallery';
import { ScriptEditor } from './components/studio/ScriptEditor';
import { HardwareSetupModal } from './components/studio/HardwareSetupModal';
import { StreamSettingsModal } from './components/studio/StreamSettingsModal';
import { QrModal } from './components/studio/QrModal';
import { PeerSettingsModal } from './components/studio/PeerSettingsModal';
import { ServerLogsPanel } from './components/studio/ServerLogsPanel';
import { NotificationToast } from './components/studio/NotificationToast';
import { ProjectDialog } from './components/studio/ProjectDialog';
import { OutputQualityModal } from './components/studio/OutputQualityModal';
import { ErrorBoundary } from './components/ErrorBoundary';
import { DownloadModal } from './components/studio/DownloadModal';
import { KeyboardShortcuts } from './components/studio/KeyboardShortcuts';

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
  }
}

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

  const gpuStreaming = useGPUStreaming();

  const [showPeerSettings, setShowPeerSettings] = React.useState(false);
  const [showProjectDialog, setShowProjectDialog] = React.useState(false);
  const [showOutputQuality, setShowOutputQuality] = React.useState(false);
  const [showShortcuts, setShowShortcuts] = React.useState(false);
  const [showDownload, setShowDownload] = React.useState(false);

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

  // ── Hooks ─────────────────────────────────────────────────────────────────
  const webrtc = useWebRTC({
    scenes: studio.scenes, setActiveScene: studio.setActiveScene,
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
  });

  const streaming = useStreaming({
    socketRef: webrtc.socketRef,
    isStreaming: studio.isStreaming, setIsStreaming: studio.setIsStreaming,
    setServerLogs: studio.setServerLogs, setTelemetry,
    onError: (msg) => notify(msg, 'error'),
    onSuccess: (msg) => notify(msg, 'success'),
  });

  const scriptRunner = useScriptRunner({ scenes: studio.scenes, setActiveScene: studio.setActiveScene });
  useEffect(() => {
    if (!scriptRunner.activeScript) scriptRunner.setActiveScript(SAMPLE_SCRIPT);
  }, []);

  const ai = useAIDirector({
    scenes: studio.scenes, activeScene: studio.activeScene, sources: studio.sources,
    isStreaming: studio.isStreaming, telemetry,
    setActiveScene: studio.setActiveScene, addLog: studio.addLog,
  });

  // ── Menu Handler ──────────────────────────────────────────────────────────
  const handleMenuAction = (action: string) => {
    const [, item] = action.split(':');
    switch (item) {
      case 'Add Camera': studio.setShowHardwareSetup(true); break;
      case 'Add Screen Share': webrtc.startScreenShare(); break;
      case 'Exit': webrtc.stopCamera(); window.close(); break;
      case 'Start Streaming': studio.setShowStreamSettings(true); break;
      case 'Stop Streaming': streaming.stopStreaming(); break;
      case 'Stream Settings': studio.setShowStreamSettings(true); break;
      case 'Output Quality': setShowOutputQuality(true); break;
      case 'Save Project': setShowProjectDialog(true); break;
      case 'Open Project': setShowProjectDialog(true); break;
      case 'Toggle Source Rack': setShowSourceRack(prev => !prev); break;
      case 'Toggle Director Rack': setShowDirectorRack(prev => !prev); break;
      case 'Toggle Telemetry': setShowTelemetry(prev => !prev); break;
      case 'Keyboard Shortcuts': setShowShortcuts(true); break;
      case 'Download Desktop App': setShowDownload(true); break;
      case 'About Aether Studio': setShowDownload(true); break;
      default: break;
    }
  };

  const activeScript = scriptRunner.activeScript || SAMPLE_SCRIPT;

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
        <TelemetryBar telemetry={telemetry} isStreaming={studio.isStreaming} isRecording={streaming.isRecording} />
      )}

      <div className="flex-1 flex overflow-hidden" style={{ transform: `scale(${zoomLevel / 100})`, transformOrigin: 'top left', width: `${10000 / zoomLevel}%`, height: `${10000 / zoomLevel}%` }}>
        {showSourceRack && (
        <ErrorBoundary name="Source Rack" onError={(err) => notify(err.message, 'error')}>
        <SourceRack sources={studio.sources} onSourceClick={s => {
          const scene = studio.scenes.find(sc => sc.name === s.name);
          if (scene) studio.setActiveScene(scene);
        }} />
        </ErrorBoundary>
        )}

        <div className="flex-1 flex flex-col min-w-0 min-h-0">
          <ErrorBoundary name="Compositor" onError={(err) => notify(err.message, 'error')}>
          <ProgramView
            activeScene={studio.activeScene}
            sources={studio.sources}
            isStreaming={studio.isStreaming}
            isRecording={streaming.isRecording}
            onToggleStreaming={() => {
              if (studio.isStreaming || gpuStreaming.isStreaming) {
                // Stop whichever is active
                if (gpuStreaming.isStreaming) gpuStreaming.stopGPUStream();
                else streaming.stopStreaming();
                studio.setIsStreaming(false);
              } else {
                // Start — prefer GPU path if available
                const activeDestinations = streaming.destinations.filter(d => d.enabled);
                if (activeDestinations.length === 0 || !activeDestinations.every(d => d.streamKey)) {
                  studio.setShowStreamSettings(true);
                  return;
                }

                if (gpuStreaming.isAvailable) {
                  // Desktop (Tauri) — use local GPU encoding via JPEG pipeline
                  // No server-side FFmpeg needed; encoding happens locally with NVENC
                  const canvas = document.querySelector('canvas');
                  if (canvas) {
                    const bitrate = streaming.encodingProfile === '1080p60' ? 6000 : streaming.encodingProfile === '720p30' ? 2500 : 4500;
                    gpuStreaming.startGPUStream(canvas as HTMLCanvasElement, activeDestinations, {
                      // Width/height are set inside startGPUStream (640x360 for IPC)
                      fps: 30,
                      bitrate,
                    }).then((msg) => {
                      studio.setIsStreaming(true);
                      notify(`GPU Stream: ${msg}`, 'success');
                    }).catch((err) => {
                      console.error('[GPU] start_stream failed:', err);
                      // Don't auto-fallback to browser path — that triggers server-side FFmpeg
                      // which crashes on weak servers. Show error and let user retry or use web mode.
                      notify(`GPU stream failed: ${err?.message || err}. Check FFmpeg and retry.`, 'error');
                    });
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
            onStart={() => streaming.startStreaming(() => {})}
          />
        )}

        {studio.showQrModal && (
          <QrModal qrMode={studio.qrMode} setQrMode={studio.setQrMode} onClose={() => studio.setShowQrModal(false)} />
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
    </div>
  );
}
