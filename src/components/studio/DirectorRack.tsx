import React, { useEffect, useState } from 'react';
import {
  Camera, Smartphone, Monitor, Brain, Activity, Sparkles,
  RefreshCw, AlertTriangle, ImageIcon as ImageIcon, Type,
  Check, Square, Circle, Play, ChevronRight, Plus, Trash2,
  Layers, Settings2, Video, ExternalLink, QrCode, Info
} from 'lucide-react';
import { motion } from 'motion/react';
import {
  Scene, Script, CamoSettings, AudienceMessage, LowerThirds,
  ScenePreset, AiMode, AiSuggestion, DirectorTab, ServerLog
} from '../../types';
import { LayoutStudio } from '../LayoutStudio';
import { AudienceStudio } from '../AudienceStudio';
import { AudioProcessingPanel } from './AudioProcessingPanel';
import { MediaBrowserPanel } from './MediaBrowserPanel';
import { ReplayPanel } from './ReplayPanel';
import { MIDIMapperPanel } from './MIDIMapperPanel';

interface DirectorRackProps {
  aiMode: AiMode;
  setAiMode: (m: AiMode) => void;
  layout: string;
  setLayout: (l: string) => void;
  activeGraphics: Set<string>;
  toggleGraphic: (g: string) => void;
  telemetry: { bitrate: string; fps: number; cpu: number; droppedFrames: number; network: string };
  script: Script;
  currentStepIndex: number;
  isScriptRunning: boolean;
  toggleScript: () => void;
  skipStep: () => void;
  isRemoteConnected: boolean;
  toggleRemote: () => void;
  activeTab: DirectorTab;
  setActiveTab: (t: DirectorTab) => void;
  lowerThirds: LowerThirds;
  setLowerThirds: (lt: LowerThirds) => void;
  toggleLowerThirds: () => void;
  showLowerThirdsTimed: (d: number) => void;
  composerMode: boolean;
  setComposerMode: (m: boolean) => void;
  generativePrompt: string;
  setGenerativePrompt: (p: string) => void;
  isGenerating: boolean;
  generateBackground: () => void;
  transition: string;
  setTransition: (t: string) => void;
  transitionSpeed: number;
  setTransitionSpeed: (s: number) => void;
  phoneSlots: string[];
  onAddPhone: () => void;
  scenePresets: ScenePreset[];
  saveScenePreset: () => void;
  loadScenePreset: (id: string) => void;
  deleteScenePreset: (id: string) => void;
  emergencyWide: () => void;
  cutToNext: () => void;
  executeAiAction: () => void;
  aiSuggestion: AiSuggestion | null;
  setAiSuggestion: (s: AiSuggestion | null) => void;
  activeTheme: string;
  setActiveTheme: (t: string) => void;
  swapSources: () => void;
  setServerLogs: React.Dispatch<React.SetStateAction<ServerLog[]>>;
  scenes: Scene[];
  setActiveScene: (s: Scene) => void;
  background: string;
  setBackground: (bg: string) => void;
  frameStyle: string;
  setFrameStyle: (fs: string) => void;
  motionStyle: string;
  setMotionStyle: (ms: string) => void;
  brandColor: string;
  setBrandColor: (bc: string) => void;
  camoSettings: CamoSettings;
  setCamoSettings: (cs: CamoSettings) => void;
  audienceMessages: AudienceMessage[];
  setAudienceMessages: React.Dispatch<React.SetStateAction<AudienceMessage[]>>;
  activeMessageId: string | null;
  setActiveMessageId: (id: string | null) => void;
  onOpenQrModal: () => void;
  // Pro Audio
  proAudio?: {
    channels: Array<{ name: string }>;
    loudness: any;
    channelMeters: Record<string, { peak: number; rms: number }>;
    onSetNoiseGate: (id: string, config: any) => void;
    onSetCompressor: (id: string, config: any) => void;
    onSetEQ: (id: string, config: any) => void;
    onSetMasterLimiter: (config: any) => void;
  };
  // Media Player
  mediaPlayer?: {
    playlist: any[];
    playbackState: any;
    onAddMedia: (file: File) => void;
    onRemoveMedia: (id: string) => void;
    onPlay: () => void;
    onPause: () => void;
    onStop: () => void;
    onNext: () => void;
    onPrevious: () => void;
    onSeek: (t: number) => void;
    onSetVolume: (v: number) => void;
    onSetLoop: (l: boolean) => void;
  };
  // Replay
  replay?: {
    isBuffering: boolean;
    clips: any[];
    bufferStats: { bufferSizeMB: number; frameCount: number; oldestFrameAge: number };
    onStartBuffer: () => void;
    onStopBuffer: () => void;
    onCaptureReplay: (durationSec: number, playbackRate?: number) => void;
    onPlayReplay: (clip: any) => void;
    onDeleteClip: (id: string) => void;
  };
  // MIDI
  midi?: {
    isSupported: boolean;
    isInitialized: boolean;
    devices: Array<{ name: string; manufacturer: string; id: string }>;
    selectedDevice: string | null;
    onSelectDevice: (id: string) => void;
    mappings: any[];
    onUpdateMappings: (m: any[]) => void;
    isLearning: boolean;
    onStartLearn: (action: string) => void;
    onStopLearn: (action: string) => void;
  };
}

export const DirectorRack: React.FC<DirectorRackProps> = ({
  aiMode, setAiMode,
  layout, setLayout,
  activeGraphics, toggleGraphic,
  script, currentStepIndex, isScriptRunning, toggleScript, skipStep,
  isRemoteConnected, toggleRemote,
  activeTab, setActiveTab,
  lowerThirds, setLowerThirds, toggleLowerThirds, showLowerThirdsTimed,
  composerMode, setComposerMode,
  generativePrompt, setGenerativePrompt, isGenerating, generateBackground,
  transition, setTransition, transitionSpeed, setTransitionSpeed,
  phoneSlots, onAddPhone,
  scenePresets, saveScenePreset, loadScenePreset, deleteScenePreset,
  emergencyWide, cutToNext,
  executeAiAction, aiSuggestion, setAiSuggestion,
  activeTheme, setActiveTheme,
  swapSources, setServerLogs,
  scenes, setActiveScene,
  background, setBackground,
  frameStyle, setFrameStyle,
  motionStyle, setMotionStyle,
  brandColor, setBrandColor,
  camoSettings, setCamoSettings,
  audienceMessages, setAudienceMessages,
  activeMessageId, setActiveMessageId,
  onOpenQrModal,
  proAudio, mediaPlayer, replay, midi,
}) => {
  const TABS_ROW1: DirectorTab[] = ['CAMO', 'PROP', 'IN', 'AI', 'OPS'];
  const TABS_ROW2: DirectorTab[] = ['AUD', 'FX', 'MED', 'RPL', 'MIDI'];

  const [remoteUrl, setRemoteUrl] = useState<string>('');
  useEffect(() => {
    fetch('/api/local-ip')
      .then(r => r.json())
      .then(({ ip, port, lanUrl }: { ip: string; port: number; lanUrl?: string }) => setRemoteUrl(`${lanUrl ?? `http://${ip}:${port}`}?mode=remote`))
      .catch(() => setRemoteUrl(`${window.location.origin}?mode=remote`));
  }, []);

  return (
    <div className="w-80 bg-panel border-l border-border flex flex-col shadow-2xl z-20">
      {/* Tab Navigation — 2 rows of 5 */}
      <div className="border-b border-border bg-black/20">
        {[TABS_ROW1, TABS_ROW2].map((row, rowIdx) => (
          <div key={rowIdx} className={`flex ${rowIdx === 0 ? 'border-b border-border/40' : ''}`}>
            {row.map(tab => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={`flex-1 py-2 text-[10px] font-bold tracking-wider transition-all relative ${
                  activeTab === tab ? 'text-accent-cyan bg-white/5' : 'text-gray-500 hover:text-gray-300'
                }`}
              >
                {tab}
                {activeTab === tab && (
                  <motion.div layoutId="activeTab" className="absolute bottom-0 left-0 right-0 h-0.5 bg-accent-cyan" />
                )}
              </button>
            ))}
          </div>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto custom-scrollbar p-3 space-y-4">
        {/* ── CAMO Tab ── */}
        {activeTab === 'CAMO' && (
          <div className="h-full flex flex-col space-y-4 p-4 overflow-y-auto custom-scrollbar">
            <div className="flex items-center justify-between border-b border-white/5 pb-2">
              <div className="flex items-center gap-2">
                <Camera size={14} className="text-accent-cyan" />
                <span className="text-xs font-bold uppercase tracking-wider">Camo</span>
              </div>
              <span className="text-[9px] bg-accent-cyan/20 text-accent-cyan px-2 py-0.5 rounded font-bold">CAMERA</span>
            </div>

            {/* Layout */}
            <div className="space-y-2">
              <h3 className="text-[10px] font-black tracking-widest text-gray-500 uppercase">Layout</h3>
              <div className="grid grid-cols-3 gap-2">
                {(['Fill', 'Center', 'Reset'] as const).map(l => (
                  <button key={l} onClick={() => setCamoSettings({ ...camoSettings, layout: l })}
                    className={`py-1.5 px-2 rounded border text-[10px] font-medium transition-all ${camoSettings.layout === l ? 'bg-accent-cyan/10 border-accent-cyan text-accent-cyan' : 'bg-panel/40 border-white/5 text-gray-400 hover:border-white/20'}`}>
                    {l}
                  </button>
                ))}
              </div>
            </div>

            {/* Content Fit */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <h3 className="text-[10px] font-black tracking-widest text-gray-500 uppercase">Content Fit</h3>
                <span className="text-[8px] text-yellow-500 flex items-center gap-1"><AlertTriangle size={10} /> Empty bars detected</span>
              </div>
              <div className="flex rounded-lg overflow-hidden border border-white/10">
                {(['Fit', 'Fill'] as const).map(f => (
                  <button key={f} onClick={() => setCamoSettings({ ...camoSettings, contentFit: f })}
                    className={`flex-1 py-2 text-[10px] font-bold ${camoSettings.contentFit === f ? 'bg-accent-cyan text-black' : 'text-gray-400'}`}>
                    {f}
                  </button>
                ))}
              </div>
            </div>

            {/* Transform */}
            <div className="space-y-2">
              <h3 className="text-[10px] font-black tracking-widest text-gray-500 uppercase">Transform</h3>
              <div className="space-y-1">
                <div className="flex justify-between text-[10px] text-gray-400"><span>Scale</span><span>{camoSettings.scale.toFixed(1)}x</span></div>
                <input type="range" min="0.5" max="2.0" step="0.1" value={camoSettings.scale}
                  onChange={(e) => setCamoSettings({ ...camoSettings, scale: parseFloat(e.target.value) })}
                  className="w-full accent-accent-cyan" />
              </div>
              <div className="flex gap-4">
                {(['x', 'y'] as const).map(axis => (
                  <div key={axis} className="flex-1 space-y-1">
                    <div className="flex justify-between text-[10px] text-gray-400">
                      <span>{axis.toUpperCase()} Pos</span><span>{camoSettings[axis]}px</span>
                    </div>
                    <input type="range" min="-1000" max="1000" step="10" value={camoSettings[axis]}
                      onChange={(e) => setCamoSettings({ ...camoSettings, [axis]: parseInt(e.target.value) })}
                      className="w-full accent-accent-cyan" />
                  </div>
                ))}
              </div>
            </div>

            {/* Shape & Crop */}
            <div className="space-y-2">
              <h3 className="text-[10px] font-black tracking-widest text-gray-500 uppercase">Shape</h3>
              <div className="flex rounded-lg overflow-hidden border border-white/10 gap-2 bg-transparent">
                {(['Rect', 'Circle'] as const).map(s => (
                  <button key={s} onClick={() => setCamoSettings({ ...camoSettings, shape: s })}
                    className={`flex-1 py-3 rounded flex flex-col items-center gap-1 ${camoSettings.shape === s ? 'bg-accent-cyan text-black' : 'bg-white/5 text-gray-400'}`}>
                    {s === 'Rect' ? <Square size={14} /> : <Circle size={14} />}
                    <span className="text-[10px] font-bold">{s}</span>
                  </button>
                ))}
              </div>
              <div className="space-y-1">
                <div className="flex justify-between text-[10px] text-gray-400"><span>Corner Radius</span><span>{camoSettings.cornerRadius}px</span></div>
                <input type="range" min="0" max="100" step="1" value={camoSettings.cornerRadius} disabled={camoSettings.shape === 'Circle'}
                  onChange={(e) => setCamoSettings({ ...camoSettings, cornerRadius: parseInt(e.target.value) })}
                  className="w-full accent-accent-cyan" />
              </div>
            </div>

            {/* Crop */}
            <div className="space-y-2">
              <h3 className="text-[10px] font-black tracking-widest text-gray-500 uppercase">Crop</h3>
              {(['top', 'bottom', 'left', 'right'] as const).map(side => (
                <div key={side} className="flex gap-2 items-center">
                  <span className="text-[9px] text-gray-500 w-10 capitalize">{side}</span>
                  <input type="range" min="0" max="50" value={camoSettings.crop[side]}
                    onChange={(e) => setCamoSettings({ ...camoSettings, crop: { ...camoSettings.crop, [side]: parseInt(e.target.value) } })}
                    className="flex-1 accent-accent-cyan" />
                  <span className="text-[9px] text-gray-500 w-8 text-right">{camoSettings.crop[side]}%</span>
                </div>
              ))}
            </div>

            {/* Filters */}
            <div className="space-y-2">
              <h3 className="text-[10px] font-black tracking-widest text-gray-500 uppercase">Filters</h3>
              <div className="grid grid-cols-3 gap-2">
                {(['None', 'B&W', 'Sepia', 'Vivid', 'Cool', 'Dim'] as const).map(f => (
                  <button key={f} onClick={() => setCamoSettings({ ...camoSettings, filter: f })}
                    className={`py-2 rounded border text-[10px] font-medium transition-all ${camoSettings.filter === f ? 'bg-accent-cyan/10 border-accent-cyan text-accent-cyan' : 'bg-panel/40 border-white/5 text-gray-400 hover:border-white/20'}`}>
                    {f}
                  </button>
                ))}
              </div>
            </div>

            {/* AI Effects */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <h3 className="text-[10px] font-black tracking-widest text-gray-500 uppercase flex items-center gap-1"><Sparkles size={10} className="text-accent-purple" /> AI Effects</h3>
                <span className="text-[8px] bg-white/10 text-gray-300 px-1.5 py-0.5 rounded font-bold">PRO</span>
              </div>
              <div className="flex items-center justify-between bg-white/5 p-3 rounded border border-white/10">
                <span className="text-[11px] font-bold text-gray-300">Remove Background</span>
                <button onClick={() => setCamoSettings({ ...camoSettings, removeBackground: !camoSettings.removeBackground })}
                  className={`w-8 h-4 rounded-full p-0.5 transition-all ${camoSettings.removeBackground ? 'bg-accent-cyan' : 'bg-gray-700'}`}>
                  <motion.div className="w-3 h-3 bg-white rounded-full shadow-lg"
                    animate={{ x: camoSettings.removeBackground ? 16 : 0 }}
                    transition={{ type: 'spring', stiffness: 500, damping: 30 }} />
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ── PROP Tab ── */}
        {activeTab === 'PROP' && (
          <>
            <div className="rack-module">
              <div className="bg-gray-800/50 p-2 border-b border-border flex items-center gap-2">
                <Type size={14} className="text-accent-cyan" />
                <span className="text-[11px] font-bold uppercase tracking-wider">Lower Thirds</span>
              </div>
              <div className="p-3 space-y-3">
                <div className="space-y-2">
                  <input type="text" placeholder="Name / Primary Text" value={lowerThirds.name}
                    onChange={(e) => setLowerThirds({ ...lowerThirds, name: e.target.value })}
                    className="w-full bg-black/40 border border-white/10 rounded px-2 py-1.5 text-[11px] focus:border-accent-cyan outline-none" />
                  <input type="text" placeholder="Title / Subtext" value={lowerThirds.title}
                    onChange={(e) => setLowerThirds({ ...lowerThirds, title: e.target.value })}
                    className="w-full bg-black/40 border border-white/10 rounded px-2 py-1.5 text-[11px] focus:border-accent-cyan outline-none" />
                </div>
                <div className="flex gap-2">
                  <button onClick={toggleLowerThirds}
                    className={`flex-1 py-2 rounded text-[10px] font-bold uppercase border transition-all ${lowerThirds.visible ? 'bg-accent-cyan text-bg border-accent-cyan' : 'border-white/10 text-gray-400 hover:bg-white/5'}`}>
                    {lowerThirds.visible ? 'Hide' : 'Show'}
                  </button>
                  <button onClick={() => showLowerThirdsTimed(lowerThirds.duration)}
                    className="px-3 py-2 rounded border border-white/10 text-gray-400 hover:bg-white/5 text-[10px] font-bold uppercase">
                    Auto {lowerThirds.duration}s
                  </button>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-[9px] text-gray-500 uppercase">Accent Color</span>
                  <div className="flex gap-1">
                    {['#00f3ff', '#ff0055', '#00ff88', '#ffaa00', '#d946ef'].map(c => (
                      <button key={c} onClick={() => setLowerThirds({ ...lowerThirds, accentColor: c })}
                        className={`w-4 h-4 rounded-full border-2 ${lowerThirds.accentColor === c ? 'border-white' : 'border-transparent'}`}
                        style={{ backgroundColor: c }} />
                    ))}
                  </div>
                </div>
              </div>
            </div>

            <div className="rack-module">
              <div className="bg-gray-800/50 p-2 border-b border-border flex items-center gap-2">
                <ImageIcon size={14} className="text-gray-400" />
                <span className="text-[11px] font-bold uppercase tracking-wider">Graphics Assets</span>
              </div>
              <div className="p-2 space-y-1">
                {['Bug - Logo', 'Overlay - Socials', 'Lower Third - Name'].map(g => (
                  <button key={g} onClick={() => toggleGraphic(g)}
                    className={`w-full flex items-center justify-between p-1.5 hover:bg-white/5 rounded-sm transition-colors text-[11px] ${activeGraphics.has(g) ? 'text-accent-cyan' : 'text-gray-400'}`}>
                    <span>{g}</span>
                    <div className={`w-3 h-3 border rounded-sm flex items-center justify-center ${activeGraphics.has(g) ? 'bg-accent-cyan border-accent-cyan' : 'border-gray-600'}`}>
                      {activeGraphics.has(g) && <Check size={8} className="text-bg" />}
                    </div>
                  </button>
                ))}
              </div>
            </div>
          </>
        )}

        {/* ── IN Tab ── */}
        {activeTab === 'IN' && (
          <>
            <div className="rack-module">
              <div className="bg-gray-800/50 p-2 border-b border-border flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Monitor size={14} className="text-accent-green" />
                  <span className="text-[11px] font-bold uppercase tracking-wider">Input Manager</span>
                </div>
                <span className="text-[9px] text-gray-500 font-mono">LIVE: 1080p60</span>
              </div>
              <div className="p-3 space-y-3">
                <div className="grid grid-cols-2 gap-2">
                  <button className="btn-hardware text-[10px] py-2 flex flex-col items-center gap-1"><Camera size={12} /><span>CAM 1</span></button>
                  <button className="btn-hardware text-[10px] py-2 flex flex-col items-center gap-1 opacity-50"><Smartphone size={12} /><span>PHONE 1</span></button>
                </div>
                <div className="space-y-2">
                  <button onClick={emergencyWide} className="w-full py-2 bg-accent-red/10 border border-accent-red/30 text-accent-red text-[10px] font-bold uppercase rounded hover:bg-accent-red/20">
                    Emergency Wide
                  </button>
                  <button onClick={cutToNext} className="w-full py-2 bg-accent-cyan/10 border border-accent-cyan/30 text-accent-cyan text-[10px] font-bold uppercase rounded hover:bg-accent-cyan/20">
                    Cut To Next
                  </button>
                </div>
              </div>
            </div>

            <div className="rack-module">
              <div className="bg-gray-800/50 p-2 border-b border-border flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Smartphone size={14} className={isRemoteConnected ? 'text-accent-cyan' : 'text-gray-400'} />
                  <span className="text-[11px] font-bold uppercase tracking-wider">Remote Camera</span>
                </div>
                <div className={`text-[9px] px-1.5 rounded-full font-bold ${isRemoteConnected ? 'bg-accent-cyan/20 text-accent-cyan' : 'bg-gray-700 text-gray-400'}`}>
                  {isRemoteConnected ? 'CONNECTED' : 'OFFLINE'}
                </div>
              </div>
              <div className="p-3 flex flex-col items-center space-y-3">
                {!isRemoteConnected ? (
                  <>
                    <div className="w-32 h-32 bg-white p-2 rounded-lg shadow-inner relative group">
                      <QrCode size="100%" className="text-bg" />
                      <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity bg-black/60 rounded-lg">
                        <ExternalLink size={24} className="text-white" />
                      </div>
                    </div>
                    <p className="text-[9px] text-gray-500 text-center uppercase leading-tight">
                      Open this URL on your phone to<br />connect as wireless camera:
                    </p>
                    <div className="w-full bg-black/40 p-2 rounded border border-white/5 text-[8px] font-mono break-all text-accent-cyan select-all">
                      {remoteUrl}
                    </div>
                    <button onClick={() => navigator.clipboard.writeText(remoteUrl)}
                      className="w-full btn-hardware text-[10px] uppercase font-bold py-1.5">
                      Copy Link
                    </button>
                  </>
                ) : (
                  <div className="w-full space-y-3">
                    <div className="aspect-video bg-black rounded-sm overflow-hidden relative border border-white/10">
                      <div className="absolute top-2 left-2 flex items-center gap-1.5">
                        <div className="w-2 h-2 bg-accent-red rounded-full animate-pulse" />
                        <span className="text-[9px] font-bold text-white shadow-sm">REMOTE_01</span>
                      </div>
                      <div className="w-full h-full flex items-center justify-center opacity-20"><Video size={32} /></div>
                    </div>
                    <button onClick={toggleRemote} className="w-full btn-hardware text-[10px] uppercase font-bold py-1.5 text-accent-red border-accent-red/20">
                      Disconnect
                    </button>
                  </div>
                )}
              </div>
            </div>

            {/* Professional Camera Tip */}
            <div className="rack-module border-yellow-500/20">
              <div className="bg-yellow-500/5 p-2 border-b border-yellow-500/20 flex items-center gap-2">
                <Info size={14} className="text-yellow-500" />
                <span className="text-[11px] font-bold uppercase tracking-wider text-yellow-400">Pro Camera Tip</span>
              </div>
              <div className="p-3 space-y-2 text-[10px] text-gray-400 leading-relaxed">
                <p><strong className="text-white">Canon / Sony / Mirrorless via HDMI:</strong> Connect your camera to an Elgato or Blackmagic capture card — it will appear as a webcam in Cam 1 / Cam 2.</p>
                <p className="text-yellow-400/80">
                  <strong className="text-yellow-300">Clean HDMI:</strong> Turn off the camera&apos;s on-screen display (OSD) / info overlay in the camera menu before connecting — otherwise the battery icon, focus box and exposure info will be baked into your video signal.
                </p>
                <p>On Canon: <span className="font-mono bg-black/40 px-1 rounded">Menu → Shooting → Disp level → HDMI → Clean</span></p>
              </div>
            </div>
          </>
        )}

        {/* ── AI Tab ── */}
        {activeTab === 'AI' && (
          <>
            <div className="rack-module">
              <div className="bg-gray-800/50 p-2 border-b border-border flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Activity size={14} className="text-accent-cyan" />
                  <span className="text-[11px] font-bold uppercase tracking-wider">AI Health</span>
                </div>
                <button className="p-1 hover:bg-white/5 rounded"><RefreshCw size={10} className="text-gray-500" /></button>
              </div>
              <div className="p-3 space-y-2">
                <div className="flex justify-between text-[10px]"><span className="text-gray-500">Relay Status</span><span className="text-accent-green font-bold">OPTIMAL</span></div>
                <div className="flex justify-between text-[10px]"><span className="text-gray-500">Latency</span><span className="text-white">124ms</span></div>
                <div className="h-1 bg-gray-900 rounded-full overflow-hidden"><div className="h-full bg-accent-cyan w-3/4" /></div>
              </div>
            </div>

            <div className="rack-module">
              <div className="bg-gray-800/50 p-2 border-b border-border flex items-center gap-2">
                <Sparkles size={14} className="text-accent-cyan" />
                <span className="text-[11px] font-bold uppercase tracking-wider">Generative BG</span>
              </div>
              <div className="p-3 space-y-3">
                <textarea placeholder="Describe your scene background..." value={generativePrompt}
                  onChange={(e) => setGenerativePrompt(e.target.value)}
                  className="w-full h-20 bg-black/40 border border-white/10 rounded p-2 text-[10px] focus:border-accent-cyan outline-none resize-none" />
                <div className="flex flex-wrap gap-1">
                  {['Cyberpunk', 'Minimal', 'Studio', 'Abstract'].map(hint => (
                    <button key={hint} onClick={() => setGenerativePrompt(hint)}
                      className="px-1.5 py-0.5 bg-white/5 rounded text-[8px] text-gray-500 hover:text-gray-300">{hint}</button>
                  ))}
                </div>
                <button onClick={generateBackground} disabled={isGenerating}
                  className="w-full py-2 bg-accent-cyan text-bg text-[10px] font-bold uppercase rounded flex items-center justify-center gap-2 disabled:opacity-50">
                  {isGenerating ? <RefreshCw size={12} className="animate-spin" /> : <Sparkles size={12} />}
                  {isGenerating ? 'Generating...' : 'Generate Scene'}
                </button>
              </div>
            </div>

            <div className="rack-module">
              <div className="bg-gray-800/50 p-2 border-b border-border flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Brain size={14} className="text-accent-cyan" />
                  <span className="text-[11px] font-bold uppercase tracking-wider">AI Director</span>
                </div>
                <div className={`text-[9px] px-1.5 rounded-full font-bold ${aiMode === 'AUTO' ? 'bg-accent-cyan/20 text-accent-cyan' : 'bg-gray-700 text-gray-400'}`}>{aiMode}</div>
              </div>
              <div className="p-3 space-y-3">
                <div className="grid grid-cols-3 gap-1 bg-black/40 p-1 rounded-sm border border-white/5">
                  {(['MANUAL', 'AUTO', 'TIMER'] as const).map(m => (
                    <button key={m} onClick={() => setAiMode(m)}
                      className={`text-[10px] py-1 rounded-sm transition-colors ${aiMode === m ? 'bg-gray-700 text-white' : 'text-gray-500 hover:text-gray-300'}`}>
                      {m === 'MANUAL' ? 'Manual' : m === 'AUTO' ? 'Audio' : 'Timer'}
                    </button>
                  ))}
                </div>
                <div className="space-y-1">
                  <div className="flex justify-between text-[9px] text-gray-500 uppercase"><span>Confidence</span><span>88%</span></div>
                  <div className="h-1 bg-gray-900 rounded-full overflow-hidden">
                    <motion.div className="h-full bg-accent-cyan" initial={{ width: 0 }} animate={{ width: '88%' }} />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <button className="btn-hardware btn-hardware-active text-[10px]" onClick={executeAiAction} disabled={!aiSuggestion}>Execute</button>
                  <button className="btn-hardware text-[10px]" onClick={() => setAiSuggestion(null)} disabled={!aiSuggestion}>Ignore</button>
                </div>
              </div>
            </div>
          </>
        )}

        {/* ── OPS Tab ── */}
        {activeTab === 'OPS' && (
          <div className="space-y-3">
            <LayoutStudio
              layout={layout} setLayout={setLayout}
              composerMode={composerMode} setComposerMode={setComposerMode}
              onApplyLayout={() => {
                setServerLogs(prev => [{ message: `OPS: Applying layout "${layout}"`, type: 'info', id: Date.now() }, ...prev]);
                if (composerMode) { setTransition('Fade'); setTransitionSpeed(800); }
                // Auto-switch scene based on layout
                const trySetScene = (type: Scene['type']) => {
                  const s = scenes.find(sc => sc.type === type);
                  if (s) setActiveScene(s);
                };
                if (['Side-by-Side', 'Picture-in-Pic', 'Dual Split'].includes(layout)) trySetScene('DUAL');
                else if (layout === 'Grid') trySetScene('GRID');
                else if (['Solo', 'Framed Solo'].includes(layout)) { const c = scenes.find(sc => sc.name === 'Cam 1'); if (c) setActiveScene(c); }
                else if (['Projector + Spk', 'PiP', 'Split Left', 'Split Right'].includes(layout)) trySetScene('SCREEN');
              }}
              onPreviewLayout={() => setServerLogs(prev => [{ message: `OPS: Previewing layout "${layout}"`, type: 'info', id: Date.now() }, ...prev])}
              onSwapLayout={swapSources}
              onSavePreset={saveScenePreset}
              activeTheme={activeTheme} setActiveTheme={setActiveTheme}
              background={background} setBackground={setBackground}
              frameStyle={frameStyle} setFrameStyle={setFrameStyle}
              motionStyle={motionStyle} setMotionStyle={setMotionStyle}
              brandColor={brandColor} setBrandColor={setBrandColor}
            />

            {/* Transitions */}
            <div className="rack-module">
              <div className="bg-gray-800/50 p-2 border-b border-border flex items-center gap-2">
                <Settings2 size={14} className="text-gray-400" />
                <span className="text-[11px] font-bold uppercase tracking-wider">Transitions</span>
              </div>
              <div className="p-3 space-y-3">
                <div className="grid grid-cols-3 gap-1">
                  {['Cut', 'Fade', 'Wipe'].map(t => (
                    <button key={t} onClick={() => setTransition(t)}
                      className={`btn-hardware text-[9px] py-1.5 ${transition === t ? 'btn-hardware-active' : ''}`}>{t}</button>
                  ))}
                </div>
                <div className="space-y-1">
                  <div className="flex justify-between text-[9px] text-gray-500 uppercase"><span>Speed</span><span className="font-mono">{transitionSpeed}ms</span></div>
                  <input type="range" min="0" max="2000" step="100" value={transitionSpeed}
                    onChange={(e) => setTransitionSpeed(parseInt(e.target.value))}
                    className="w-full accent-accent-cyan h-1 bg-gray-800 rounded-lg appearance-none cursor-pointer" />
                </div>
              </div>
            </div>

            {/* Scene Presets */}
            <div className="rack-module">
              <div className="bg-gray-800/50 p-2 border-b border-border flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Layers size={14} className="text-gray-400" />
                  <span className="text-[11px] font-bold uppercase tracking-wider">Scene Presets</span>
                </div>
                <button onClick={saveScenePreset} className="p-1 hover:bg-white/5 rounded text-accent-cyan transition-colors" title="Save Current">
                  <Plus size={12} />
                </button>
              </div>
              <div className="p-2 space-y-1 max-h-40 overflow-y-auto custom-scrollbar">
                {scenePresets.map(preset => (
                  <div key={preset.id} className="flex items-center gap-1 group">
                    <button onClick={() => loadScenePreset(preset.id)}
                      className="flex-1 text-left p-1.5 hover:bg-white/5 rounded text-[10px] text-gray-400 hover:text-white truncate font-medium">
                      {preset.name}
                    </button>
                    <button onClick={() => deleteScenePreset(preset.id)}
                      className="p-1.5 opacity-0 group-hover:opacity-100 text-gray-600 hover:text-accent-red hover:bg-accent-red/10 rounded transition-all">
                      <Trash2 size={12} />
                    </button>
                  </div>
                ))}
                {scenePresets.length === 0 && (
                  <div className="text-[9px] text-gray-600 italic p-4 text-center border border-dashed border-white/5 rounded">No presets saved</div>
                )}
              </div>
            </div>

            {/* Phone Slots */}
            <div className="rack-module">
              <div className="bg-gray-800/50 p-2 border-b border-border flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Smartphone size={14} className="text-gray-400" />
                  <span className="text-[11px] font-bold uppercase tracking-wider">Phone Slots</span>
                </div>
                <button onClick={onAddPhone} className="p-1 hover:bg-white/5 rounded text-accent-cyan transition-colors"><Plus size={12} /></button>
              </div>
              <div className="p-3">
                <div className="grid grid-cols-4 gap-2 mb-2">
                  {[1, 2, 3, 4].map(i => {
                    const connected = i <= phoneSlots.length;
                    return (
                      <div key={i} className={`aspect-square rounded border flex items-center justify-center ${connected ? 'bg-accent-cyan/10 border-accent-cyan/50 text-accent-cyan' : 'bg-black/40 border-white/5 text-gray-700'}`}>
                        <span className="text-[10px] font-bold">{i}</span>
                      </div>
                    );
                  })}
                </div>
                <p className="text-[9px] text-center text-gray-500">
                  {phoneSlots.length === 0 ? 'Click + to connect a phone via WebRTC.' : `${phoneSlots.length} phone(s) connected.`}
                </p>
              </div>
            </div>

            {/* Script Runner */}
            <div className="rack-module">
              <div className="bg-gray-800/50 p-2 border-b border-border flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Play size={14} className={isScriptRunning ? 'text-accent-green' : 'text-gray-400'} />
                  <span className="text-[11px] font-bold uppercase tracking-wider">Script Runner</span>
                </div>
                <div className="text-[9px] text-gray-500 font-mono uppercase truncate max-w-[100px]" title={script.name}>{script.name}</div>
              </div>
              <div className="p-3 space-y-3">
                <div className="space-y-1.5 max-h-40 overflow-y-auto custom-scrollbar pr-1">
                  {script.steps.map((step, idx) => (
                    <div key={step.id}
                      className={`flex items-center gap-2 p-2 rounded-sm border transition-all ${idx === currentStepIndex && isScriptRunning ? 'bg-accent-green/10 border-accent-green/30 text-white' : 'border-transparent text-gray-500 hover:bg-white/5'}`}>
                      <div className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${idx === currentStepIndex && isScriptRunning ? 'bg-accent-green animate-pulse' : 'bg-gray-800'}`} />
                      <span className="text-[10px] flex-1 truncate font-medium">{step.label}</span>
                      <span className="text-[9px] font-mono opacity-50">{step.duration}s</span>
                    </div>
                  ))}
                </div>
                <div className="grid grid-cols-2 gap-2 pt-2 border-t border-white/5">
                  <button onClick={toggleScript}
                    className={`btn-hardware flex items-center justify-center gap-2 py-2 ${isScriptRunning ? 'text-accent-red border-accent-red/20 bg-accent-red/5' : 'text-accent-green border-accent-green/20'}`}>
                    {isScriptRunning ? <Square size={10} fill="currentColor" /> : <Play size={10} fill="currentColor" />}
                    <span className="text-[10px] uppercase font-bold">{isScriptRunning ? 'Stop' : 'Run'}</span>
                  </button>
                  <button onClick={skipStep} disabled={!isScriptRunning}
                    className="btn-hardware flex items-center justify-center gap-2 py-2 disabled:opacity-30 hover:bg-white/5">
                    <ChevronRight size={12} />
                    <span className="text-[10px] uppercase font-bold">Skip</span>
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ── AUD Tab ── */}
        {activeTab === 'AUD' && (
          <AudienceStudio
            messages={audienceMessages}
            setMessages={setAudienceMessages}
            activeMessageId={activeMessageId}
            setActiveMessageId={setActiveMessageId}
            brandColor={brandColor}
            onOpenQrModal={onOpenQrModal}
          />
        )}

        {/* ── FX Tab (Pro Audio) ── */}
        {activeTab === 'FX' && proAudio && (
          <AudioProcessingPanel
            channels={proAudio.channels}
            loudness={proAudio.loudness}
            channelMeters={proAudio.channelMeters}
            onSetNoiseGate={proAudio.onSetNoiseGate}
            onSetCompressor={proAudio.onSetCompressor}
            onSetEQ={proAudio.onSetEQ}
            onSetMasterLimiter={proAudio.onSetMasterLimiter}
          />
        )}

        {/* ── MED Tab (Media Browser) ── */}
        {activeTab === 'MED' && mediaPlayer && (
          <MediaBrowserPanel
            playlist={mediaPlayer.playlist}
            playbackState={mediaPlayer.playbackState}
            onAddMedia={mediaPlayer.onAddMedia}
            onRemoveMedia={mediaPlayer.onRemoveMedia}
            onPlay={mediaPlayer.onPlay}
            onPause={mediaPlayer.onPause}
            onStop={mediaPlayer.onStop}
            onNext={mediaPlayer.onNext}
            onPrevious={mediaPlayer.onPrevious}
            onSeek={mediaPlayer.onSeek}
            onSetVolume={mediaPlayer.onSetVolume}
            onSetLoop={mediaPlayer.onSetLoop}
          />
        )}

        {/* ── RPL Tab (Replay) ── */}
        {activeTab === 'RPL' && replay && (
          <ReplayPanel
            isBuffering={replay.isBuffering}
            clips={replay.clips}
            bufferStats={replay.bufferStats}
            onStartBuffer={replay.onStartBuffer}
            onStopBuffer={replay.onStopBuffer}
            onCaptureReplay={replay.onCaptureReplay}
            onPlayReplay={replay.onPlayReplay}
            onDeleteClip={replay.onDeleteClip}
          />
        )}

        {/* ── MIDI Tab ── */}
        {activeTab === 'MIDI' && midi && (
          <MIDIMapperPanel
            isSupported={midi.isSupported}
            isInitialized={midi.isInitialized}
            devices={midi.devices}
            selectedDevice={midi.selectedDevice}
            onSelectDevice={midi.onSelectDevice}
            mappings={midi.mappings}
            onUpdateMappings={midi.onUpdateMappings}
            isLearning={midi.isLearning}
            onStartLearn={midi.onStartLearn}
            onStopLearn={midi.onStopLearn}
          />
        )}
      </div>
    </div>
  );
};
