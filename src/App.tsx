/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { 
  Type, 
  MousePointer2, 
  Sparkles, 
  Settings2, 
  RefreshCw,
  Copy,
  Smartphone,
  Activity, 
  Camera, 
  Monitor, 
  Mic, 
  MicOff, 
  Settings, 
  Play, 
  Square, 
  Radio, 
  Cpu, 
  Network, 
  ChevronRight, 
  Maximize2, 
  ExternalLink,
  Brain,
  Layers,
  Image as ImageIcon,
  MessageSquare,
  AlertCircle,
  Volume2,
  VolumeX,
  Check,
  QrCode,
  Video,
  History,
  Edit3,
  X,
  Trash2,
  Download,
  Plus,
  Terminal,
  AlertTriangle,
  Circle,
  Save
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { Scene, Source, Telemetry, Script, ScriptStep, Recording, CamoSettings, StreamDestination, AudienceMessage } from './types';

import { io } from 'socket.io-client';
import Peer from 'simple-peer';
import { GoogleGenAI } from "@google/genai";

import { Compositor } from './components/Compositor';
import { LayoutStudio } from './components/LayoutStudio';
import { AudienceStudio } from './components/AudienceStudio';
import { AudienceLanding } from './components/AudienceLanding';
import { audioEngine } from './lib/audioEngine';

declare global {
  interface Window {
    __TAURI_INTERNALS__?: Record<string, unknown>;
  }
}

// --- Constants ---

const SCENES: Scene[] = [
  { id: '1', name: 'Cam 1', type: 'CAM' },
  { id: '2', name: 'Cam 2', type: 'CAM' },
  { id: '3', name: 'Screen', type: 'SCREEN' },
  { id: '4', name: 'Dual View', type: 'DUAL' },
  { id: '5', name: 'Grid', type: 'GRID' },
  { id: '6', name: 'Podcast', type: 'PODCAST' },
];

const SOURCES: Source[] = [
  { id: '1', name: 'Cam 1', status: 'active', resolution: '1080p', fps: 60, audioLevel: 0.65 },
  { id: '2', name: 'Cam 2', status: 'standby', resolution: '1080p', fps: 60, audioLevel: 0.12 },
  { id: '3', name: 'Screen Share', status: 'standby', resolution: '4K', fps: 30, audioLevel: 0.0 },
  { id: '4', name: 'Media Loop', status: 'offline', resolution: '1080p', fps: 24, audioLevel: 0.0 },
  { id: '5', name: 'Browser Source', status: 'active', resolution: '1080p', fps: 60, audioLevel: 0.45 },
];

const AUDIO_CHANNELS = [
  { name: 'Mic 1', level: 0, volume: 0.6, peak: 0, muted: false },
  { name: 'Mic 2', level: 0, volume: 0.2, peak: 0, muted: true },
  { name: 'System', level: 0, volume: 0.4, peak: 0, muted: false },
  { name: 'Media', level: 0, volume: 0.0, peak: 0, muted: false },
];

const SAMPLE_SCRIPT: Script = {
  id: 'script-1',
  name: 'Podcast Intro',
  steps: [
    { id: 's1', sceneId: '1', duration: 5, label: 'Intro: Host' },
    { id: 's2', sceneId: '4', duration: 10, label: 'Dual: Discussion' },
    { id: 's3', sceneId: '2', duration: 5, label: 'Guest: Reaction' },
    { id: 's4', sceneId: '5', duration: 8, label: 'Grid: Group Chat' },
    { id: 's5', sceneId: '3', duration: 12, label: 'Screen: Demo' },
    { id: 's6', sceneId: '1', duration: 5, label: 'Outro: Host' },
  ]
};

// --- Sub-components ---

const MenuBar = ({ 
  onOpenGallery, 
  onOpenEditor,
  onAction
}: { 
  onOpenGallery: () => void, 
  onOpenEditor: () => void,
  onAction: (action: string) => void
}) => {
  const [activeMenu, setActiveMenu] = useState<string | null>(null);

  const menuConfig: Record<string, string[]> = {
    'File': ['New Project', 'Open...', 'Save', 'Save As...', 'Export Recording', 'Exit'],
    'Edit': ['Undo', 'Redo', 'Cut', 'Copy', 'Paste', 'Preferences'],
    'Sources': ['Add Camera', 'Add Screen Share', 'Add Media File', 'Add Browser Source'],
    'Scenes': ['New Scene', 'Duplicate Scene', 'Delete Scene', 'Scene Transitions'],
    'Stream': ['Start Streaming', 'Stop Streaming', 'Stream Settings', 'Output Quality'],
    'Tools': ['AI Director Settings', 'Script Editor', 'Recording Gallery', 'Diagnostics'],
    'Window': ['Audio Mixer', 'Source Rack', 'Director Rack', 'Reset Layout'],
    'Help': ['Documentation', 'Keyboard Shortcuts', 'Check for Updates', 'About Aether Studio']
  };

  const handleMenuAction = (menu: string, item: string) => {
    if (item === 'Recording Gallery') onOpenGallery();
    else if (item === 'Script Editor') onOpenEditor();
    else onAction(`${menu}:${item}`);
    setActiveMenu(null);
  };

  return (
    <div className="h-8 bg-bg border-b border-border flex items-center px-2 gap-1 text-xs font-medium relative z-[100]">
      {Object.keys(menuConfig).map(menu => (
        <div key={menu} className="relative">
          <button 
            onMouseEnter={() => activeMenu && setActiveMenu(menu)}
            onClick={() => setActiveMenu(activeMenu === menu ? null : menu)}
            className={`hover:bg-white/10 px-3 py-1 rounded-sm transition-colors cursor-default ${activeMenu === menu ? 'bg-white/10 text-white' : 'text-gray-400'}`}
          >
            {menu}
          </button>
          
          <AnimatePresence>
            {activeMenu === menu && (
              <>
                <div className="fixed inset-0 z-[-1]" onClick={() => setActiveMenu(null)} />
                <motion.div 
                  initial={{ opacity: 0, y: -5 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -5 }}
                  className="absolute top-full left-0 w-48 bg-panel border border-border rounded-sm shadow-2xl py-1 mt-0.5 overflow-hidden"
                >
                  {menuConfig[menu].map((item, idx) => (
                    <React.Fragment key={item}>
                      {item === 'Exit' || item === 'Preferences' || item === 'Output Quality' || item === 'Diagnostics' || item === 'About Aether Studio' ? (
                        <div className="h-px bg-border my-1 mx-2" />
                      ) : null}
                      <button 
                        onClick={() => handleMenuAction(menu, item)}
                        className="w-full text-left px-4 py-1.5 hover:bg-accent-cyan hover:text-bg transition-colors flex items-center justify-between group"
                      >
                        <span>{item}</span>
                        {item.includes('...') && <span className="opacity-40 group-hover:opacity-100">...</span>}
                      </button>
                    </React.Fragment>
                  ))}
                </motion.div>
              </>
            )}
          </AnimatePresence>
        </div>
      ))}
      
      <div className="flex-1" />
      <div className="flex items-center gap-2 mr-4">
        <button 
          onClick={onOpenEditor}
          className="flex items-center gap-1.5 px-2 py-1 rounded-sm hover:bg-white/5 text-gray-400 hover:text-accent-cyan transition-colors"
        >
          <Edit3 size={12} />
          <span>Scripts</span>
        </button>
        <button 
          onClick={onOpenGallery}
          className="flex items-center gap-1.5 px-2 py-1 rounded-sm hover:bg-white/5 text-gray-400 hover:text-accent-cyan transition-colors"
        >
          <History size={12} />
          <span>Gallery</span>
        </button>
      </div>
      <button className="text-gray-500 hover:text-white p-1 active:scale-90 transition-transform">
        <Settings size={14} />
      </button>
    </div>
  );
};

const TelemetryBar = ({ telemetry, isStreaming, isRecording }: { telemetry: Telemetry, isStreaming: boolean, isRecording: boolean }) => {
  return (
    <div className="h-10 bg-panel border-b border-border flex items-center px-4 gap-6 text-[11px] font-mono uppercase tracking-wider">
      <div className="flex items-center gap-4 border-r border-border pr-6">
        <div className="flex items-center gap-2">
          <div className="led-indicator bg-accent-green" />
          <span className="text-accent-green font-bold">READY</span>
        </div>
        <div className="flex items-center gap-2">
          <div className={`led-indicator ${isStreaming ? 'bg-accent-red animate-pulse' : 'bg-gray-700'}`} />
          <span className={isStreaming ? 'text-accent-red font-bold' : 'text-gray-500'}>LIVE</span>
        </div>
        <div className="flex items-center gap-2">
          <div className={`led-indicator ${isRecording ? 'bg-accent-red animate-pulse' : 'bg-gray-700'}`} />
          <span className={isRecording ? 'text-accent-red font-bold' : 'text-gray-500'}>RECORDING</span>
        </div>
      </div>
      
      <div className="flex items-center gap-6 text-gray-400">
        <div className="flex items-center gap-2">
          <Radio size={12} className={isStreaming ? 'text-accent-cyan' : 'text-gray-600'} />
          <span>Bitrate: <span className="text-white">{isStreaming ? telemetry.bitrate : '0.0 Mbps'}</span></span>
        </div>
        <div className="flex items-center gap-2">
          <Activity size={12} className="text-accent-cyan" />
          <span>FPS: <span className="text-white">{telemetry.fps}</span></span>
        </div>
        <div className="flex items-center gap-2">
          <Cpu size={12} className="text-accent-cyan" />
          <span>CPU: <span className="text-white">{telemetry.cpu}%</span></span>
        </div>
        <div className="flex items-center gap-2">
          <AlertCircle size={12} className="text-accent-red" />
          <span>Dropped: <span className="text-white">{telemetry.droppedFrames}</span></span>
        </div>
        <div className="flex items-center gap-2">
          <Network size={12} className={telemetry.network === 'excellent' ? 'text-accent-green' : 'text-accent-red'} />
          <span className="capitalize">{telemetry.network}</span>
        </div>
      </div>
    </div>
  );
};

const SourceRack = ({ sources, onSourceClick }: { sources: Source[], onSourceClick: (s: Source) => void }) => {
  return (
    <div className="w-64 border-r border-border flex flex-col bg-bg">
      <div className="p-3 border-b border-border flex items-center justify-between">
        <h3 className="text-[10px] font-bold uppercase tracking-widest text-gray-500">Source Rack</h3>
        <button className="text-gray-500 hover:text-white active:rotate-90 transition-transform">
          <Settings size={12} />
        </button>
      </div>
      <div className="flex-1 overflow-y-auto p-2 space-y-1">
        {sources.map(source => (
          <div 
            key={source.id} 
            onClick={() => onSourceClick(source)}
            className="rack-module p-2 group cursor-pointer hover:border-gray-600 transition-colors active:bg-white/5"
          >
            <div className="flex items-center justify-between mb-1">
              <div className="flex items-center gap-2">
                <div className={`led-indicator ${source.status === 'active' ? 'bg-accent-green' : source.status === 'standby' ? 'bg-orange-500' : 'bg-gray-700'}`} />
                <span className="text-xs font-medium text-gray-200">{source.name}</span>
              </div>
              <span className="text-[9px] text-gray-500 font-mono">{source.resolution}</span>
            </div>
            <div className="flex items-center justify-between">
              <div className="flex-1 h-1 bg-gray-900 rounded-full overflow-hidden mr-4">
                <motion.div 
                  className="h-full bg-accent-green"
                  initial={{ width: 0 }}
                  animate={{ width: `${source.audioLevel * 100}%` }}
                  transition={{ duration: 0.1 }}
                />
              </div>
              <span className="text-[9px] text-gray-600 font-mono">{source.fps} FPS</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

const ProgramView = ({ 
  activeScene, 
  sources,
  isStreaming, 
  isRecording, 
  onToggleStreaming, 
  onToggleRecording,
  webcamStream,
  remoteStreams,
  screenStream,
  transitionType,
  layout,
  lowerThirds,
  graphics,
  backgroundImage,
  theme,
  background,
  frameStyle,
  motionStyle,
  brandColor,
  camoSettings,
  sourceSwap,
  audienceMessages,
  activeMessageId
}: { 
  activeScene: Scene, 
  sources: Source[],
  isStreaming: boolean, 
  isRecording: boolean,
  onToggleStreaming: () => void,
  onToggleRecording: () => void,
  webcamStream: MediaStream | null,
  remoteStreams: Map<string, MediaStream>,
  screenStream: MediaStream | null,
  transitionType: string,
  layout: string,
  lowerThirds: any,
  graphics: any,
  backgroundImage: string | null,
  theme: string,
  background: string,
  frameStyle: string,
  motionStyle: string,
  brandColor: string,
  camoSettings: CamoSettings,
  sourceSwap: boolean,
  audienceMessages: AudienceMessage[],
  activeMessageId: string | null
}) => {
  const containerRef = useRef<HTMLDivElement>(null);

  const toggleFullscreen = () => {
    if (!containerRef.current) return;
    if (document.fullscreenElement) {
      document.exitFullscreen();
    } else {
      containerRef.current.requestFullscreen();
    }
  };

  const openPopout = () => {
    window.open(window.location.href, 'AetherPopout', 'width=1280,height=720');
  };

  return (
    <div ref={containerRef} className="flex-1 flex flex-col bg-black relative">
      <div className="absolute top-4 left-4 z-10 flex items-center gap-3">
        {isStreaming && (
          <motion.div 
            initial={{ scale: 0.8, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            className="bg-accent-red text-white text-[10px] font-bold px-2 py-0.5 rounded-sm flex items-center gap-1.5"
          >
            <div className="w-1.5 h-1.5 bg-white rounded-full animate-pulse" />
            LIVE
          </motion.div>
        )}
        <div className="bg-black/60 backdrop-blur-md border border-white/10 text-white text-[10px] font-mono px-2 py-0.5 rounded-sm">
          1080p | 60fps | {isStreaming ? '4.2 Mbps' : 'IDLE'}
        </div>
      </div>

      <div className="flex-1 flex items-center justify-center p-4">
        <div className="aspect-video w-full max-w-5xl bg-gray-900 shadow-2xl border border-white/5 relative overflow-hidden flex items-center justify-center">
          <Compositor 
            activeScene={activeScene} 
            sources={sources} 
            isStreaming={isStreaming} 
            webcamStream={webcamStream} 
            remoteStreams={remoteStreams}
            screenStream={screenStream}
            transitionType={transitionType}
            layout={layout}
            lowerThirds={{
              show: lowerThirds.visible,
              name: lowerThirds.name,
              title: lowerThirds.title,
              accentColor: lowerThirds.accentColor
            }}
            graphics={{
              showBug: graphics.showBug,
              showSocials: graphics.showSocials
            }}
            backgroundImage={backgroundImage}
            theme={theme}
            background={background}
            frameStyle={frameStyle}
            motionStyle={motionStyle}
            brandColor={brandColor}
            camoSettings={camoSettings}
            sourceSwap={sourceSwap}
            audienceMessages={audienceMessages}
            activeMessageId={activeMessageId}
          />
          
          {/* Program Overlay */}
          <div className="absolute bottom-4 right-4 text-right pointer-events-none">
            <p className="text-white/20 text-4xl font-black italic tracking-tighter uppercase select-none">Aether Studio</p>
          </div>
        </div>
      </div>

      <div className="h-12 bg-panel border-t border-border flex items-center px-4 justify-between">
        <div className="flex items-center gap-4">
          <button className="btn-hardware flex items-center gap-2" onClick={toggleFullscreen}>
            <Maximize2 size={12} /> Fullscreen
          </button>
          <button className="btn-hardware flex items-center gap-2" onClick={openPopout}>
            <ExternalLink size={12} /> Popout
          </button>
        </div>
        <div className="flex items-center gap-2">
          <button 
            onClick={onToggleRecording}
            className={`btn-hardware flex items-center gap-2 transition-colors ${isRecording ? 'text-accent-red border-accent-red/30 bg-accent-red/10' : 'text-gray-400'}`}
          >
            {isRecording ? <Square size={12} fill="currentColor" /> : <Play size={12} fill="currentColor" />}
            {isRecording ? 'Stop Recording' : 'Start Recording'}
          </button>
          <button 
            onClick={onToggleStreaming}
            className={`btn-hardware flex items-center gap-2 transition-colors ${isStreaming ? 'text-accent-cyan border-accent-cyan/30 bg-accent-cyan/10' : 'text-gray-400'}`}
          >
            <Radio size={12} />
            {isStreaming ? 'Stop Streaming' : 'Start Streaming'}
          </button>
        </div>
      </div>
    </div>
  );
};

const DirectorRack = ({ 
  aiMode, 
  setAiMode, 
  layout, 
  setLayout, 
  activeGraphics, 
  toggleGraphic,
  telemetry,
  script,
  currentStepIndex,
  isScriptRunning,
  toggleScript,
  skipStep,
  isRemoteConnected,
  toggleRemote,
  activeTab,
  setActiveTab,
  lowerThirds,
  setLowerThirds,
  toggleLowerThirds,
  showLowerThirdsTimed,
  composerMode,
  setComposerMode,
  aiHealth,
  generativePrompt,
  setGenerativePrompt,
  isGenerating,
  generateBackground,
  transition,
  setTransition,
  transitionSpeed,
  setTransitionSpeed,
  phoneSlots,
  onAddPhone,
  scenePresets,
  saveScenePreset,
  loadScenePreset,
  deleteScenePreset,
  emergencyWide,
  cutToNext,
  executeAiAction,
  aiSuggestion,
  setAiSuggestion,
  activeTheme,
  setActiveTheme,
  swapSources,
  setServerLogs,
  scenes,
  setActiveScene,
  background,
  setBackground,
  frameStyle,
  setFrameStyle,
  motionStyle,
  setMotionStyle,
  brandColor,
  setBrandColor,
  camoSettings,
  setCamoSettings,
  audienceMessages,
  setAudienceMessages,
  activeMessageId,
  setActiveMessageId,
  onOpenQrModal
}: { 
  aiMode: string; 
  setAiMode: (m: string) => void; 
  layout: string; 
  setLayout: (l: string) => void;
  activeGraphics: Set<string>;
  toggleGraphic: (g: string) => void;
  telemetry: Telemetry;
  script: Script;
  currentStepIndex: number;
  isScriptRunning: boolean;
  toggleScript: () => void;
  skipStep: () => void;
  isRemoteConnected: boolean;
  toggleRemote: () => void;
  activeTab: 'CAMO' | 'PROP' | 'IN' | 'AI' | 'OPS' | 'AUD';
  setActiveTab: (t: 'CAMO' | 'PROP' | 'IN' | 'AI' | 'OPS' | 'AUD') => void;
  lowerThirds: any;
  setLowerThirds: (lt: any) => void;
  toggleLowerThirds: () => void;
  showLowerThirdsTimed: (d: number) => void;
  composerMode: boolean;
  setComposerMode: (m: boolean) => void;
  aiHealth: any;
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
  scenePresets: any[];
  saveScenePreset: () => void;
  loadScenePreset: (id: string) => void;
  deleteScenePreset: (id: string) => void;
  emergencyWide: () => void;
  cutToNext: () => void;
  executeAiAction: () => void;
  aiSuggestion: any;
  setAiSuggestion: (s: any) => void;
  activeTheme: string;
  setActiveTheme: (t: string) => void;
  swapSources: () => void;
  setServerLogs: (l: any) => void;
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
}) => {
  return (
    <div className="w-80 bg-panel border-l border-border flex flex-col shadow-2xl z-20">
      {/* Tab Navigation */}
      <div className="flex border-b border-border bg-black/20">
        {(['CAMO', 'PROP', 'IN', 'AI', 'OPS', 'AUD'] as const).map(tab => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`flex-1 py-3 text-[10px] font-bold tracking-widest transition-all relative ${
              activeTab === tab ? 'text-accent-cyan bg-white/5' : 'text-gray-500 hover:text-gray-300'
            }`}
          >
            {tab}
            {activeTab === tab && (
              <motion.div 
                layoutId="activeTab"
                className="absolute bottom-0 left-0 right-0 h-0.5 bg-accent-cyan"
              />
            )}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto custom-scrollbar p-3 space-y-4">
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
                {['Fill', 'Center', 'Reset'].map(l => (
                  <button
                    key={l}
                    onClick={() => setCamoSettings({ ...camoSettings, layout: l as any })}
                    className={`py-1.5 px-2 rounded border text-[10px] font-medium transition-all ${
                      camoSettings.layout === l 
                        ? 'bg-accent-cyan/10 border-accent-cyan text-accent-cyan' 
                        : 'bg-panel/40 border-white/5 text-gray-400 hover:border-white/20 hover:text-gray-200'
                    }`}
                  >
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
                <button
                  onClick={() => setCamoSettings({ ...camoSettings, contentFit: 'Fit' })}
                  className={`flex-1 py-2 text-[10px] font-bold ${camoSettings.contentFit === 'Fit' ? 'bg-accent-cyan text-black' : 'bg-transparent text-gray-400'}`}
                >
                  Fit <span className="font-normal opacity-70 ml-1">full</span>
                </button>
                <button
                  onClick={() => setCamoSettings({ ...camoSettings, contentFit: 'Fill' })}
                  className={`flex-1 py-2 text-[10px] font-bold ${camoSettings.contentFit === 'Fill' ? 'bg-accent-cyan text-black' : 'bg-transparent text-gray-400'}`}
                >
                  Fill <span className="font-normal opacity-70 ml-1">no bars</span>
                </button>
              </div>
              <p className="text-[9px] text-yellow-500/70">Switch to Fill to remove empty bar areas.</p>
            </div>

            {/* Transform */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <h3 className="text-[10px] font-black tracking-widest text-gray-500 uppercase">Transform</h3>
              </div>
              <div className="space-y-1">
                <div className="flex justify-between text-[10px] text-gray-400">
                  <span>Scale</span>
                  <span>{camoSettings.scale.toFixed(1)}x</span>
                </div>
                <input 
                  type="range" 
                  min="0.5" max="2.0" step="0.1"
                  value={camoSettings.scale}
                  onChange={(e) => setCamoSettings({ ...camoSettings, scale: parseFloat(e.target.value) })}
                  className="w-full accent-accent-cyan"
                />
              </div>
              <div className="flex gap-4 pt-1">
                <div className="flex-1 space-y-1">
                  <div className="flex justify-between text-[10px] text-gray-400">
                    <span>X Pos</span>
                    <span>{camoSettings.x}px</span>
                  </div>
                  <input 
                    type="range" 
                    min="-1000" max="1000" step="10"
                    value={camoSettings.x}
                    onChange={(e) => setCamoSettings({ ...camoSettings, x: parseInt(e.target.value) })}
                    className="w-full accent-accent-cyan"
                  />
                </div>
                <div className="flex-1 space-y-1">
                  <div className="flex justify-between text-[10px] text-gray-400">
                    <span>Y Pos</span>
                    <span>{camoSettings.y}px</span>
                  </div>
                  <input 
                    type="range" 
                    min="-1000" max="1000" step="10"
                    value={camoSettings.y}
                    onChange={(e) => setCamoSettings({ ...camoSettings, y: parseInt(e.target.value) })}
                    className="w-full accent-accent-cyan"
                  />
                </div>
              </div>
            </div>

            {/* Shape & Crop */}
            <div className="space-y-2">
              <h3 className="text-[10px] font-black tracking-widest text-gray-500 uppercase">Shape & Crop</h3>
              <div className="flex rounded-lg overflow-hidden border border-white/10 gap-2 bg-transparent">
                <button
                  onClick={() => setCamoSettings({ ...camoSettings, shape: 'Rect' })}
                  className={`flex-1 py-3 rounded flex flex-col items-center justify-center gap-1 ${camoSettings.shape === 'Rect' ? 'bg-accent-cyan text-black' : 'bg-white/5 text-gray-400'}`}
                >
                  <Square size={14} />
                  <span className="text-[10px] font-bold">Rect</span>
                </button>
                <button
                  onClick={() => setCamoSettings({ ...camoSettings, shape: 'Circle' })}
                  className={`flex-1 py-3 rounded flex flex-col items-center justify-center gap-1 ${camoSettings.shape === 'Circle' ? 'bg-accent-cyan text-black' : 'bg-white/5 text-gray-400'}`}
                >
                  <Circle size={14} />
                  <span className="text-[10px] font-bold">Circle</span>
                </button>
              </div>
              <div className="space-y-1 pt-2">
                <div className="flex justify-between text-[10px] text-gray-400">
                  <span>Corner Radius</span>
                  <span>{camoSettings.cornerRadius}px</span>
                </div>
                <input 
                  type="range" 
                  min="0" max="100" step="1"
                  value={camoSettings.cornerRadius}
                  onChange={(e) => setCamoSettings({ ...camoSettings, cornerRadius: parseInt(e.target.value) })}
                  className="w-full accent-accent-cyan"
                  disabled={camoSettings.shape === 'Circle'}
                />
              </div>
            </div>

            {/* Crop */}
            <div className="space-y-2">
              <h3 className="text-[10px] font-black tracking-widest text-gray-500 uppercase">Crop</h3>
              
              <div className="space-y-1">
                <div className="flex justify-between text-[10px] text-gray-400">
                  <span>Horizontal (Left / Right)</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-[9px] text-gray-500 w-8">{camoSettings.crop.left}%</span>
                  <div className="flex-1 h-2 bg-white/10 rounded-full relative">
                    <div 
                      className="absolute top-0 bottom-0 bg-accent-cyan rounded-full"
                      style={{ left: `${camoSettings.crop.left}%`, right: `${camoSettings.crop.right}%` }}
                    />
                  </div>
                  <span className="text-[9px] text-gray-500 w-8 text-right">{camoSettings.crop.right}%</span>
                </div>
                <div className="flex gap-4 pt-1">
                  <div className="flex-1">
                    <div className="flex justify-between text-[9px] text-gray-500 mb-1"><span>Left</span><span>{camoSettings.crop.left}%</span></div>
                    <input type="range" min="0" max="50" value={camoSettings.crop.left} onChange={(e) => setCamoSettings({ ...camoSettings, crop: { ...camoSettings.crop, left: parseInt(e.target.value) } })} className="w-full accent-accent-cyan" />
                  </div>
                  <div className="flex-1">
                    <div className="flex justify-between text-[9px] text-gray-500 mb-1"><span>Right</span><span>{camoSettings.crop.right}%</span></div>
                    <input type="range" min="0" max="50" value={camoSettings.crop.right} onChange={(e) => setCamoSettings({ ...camoSettings, crop: { ...camoSettings.crop, right: parseInt(e.target.value) } })} className="w-full accent-accent-cyan" />
                  </div>
                </div>
              </div>

              <div className="space-y-1 pt-2">
                <div className="flex justify-between text-[10px] text-gray-400">
                  <span>Vertical (Top / Bottom)</span>
                </div>
                <div className="flex gap-4 pt-1">
                  <div className="flex-1">
                    <div className="flex justify-between text-[9px] text-gray-500 mb-1"><span>Top</span><span>{camoSettings.crop.top}%</span></div>
                    <input type="range" min="0" max="50" value={camoSettings.crop.top} onChange={(e) => setCamoSettings({ ...camoSettings, crop: { ...camoSettings.crop, top: parseInt(e.target.value) } })} className="w-full accent-accent-cyan" />
                  </div>
                  <div className="flex-1">
                    <div className="flex justify-between text-[9px] text-gray-500 mb-1"><span>Bottom</span><span>{camoSettings.crop.bottom}%</span></div>
                    <input type="range" min="0" max="50" value={camoSettings.crop.bottom} onChange={(e) => setCamoSettings({ ...camoSettings, crop: { ...camoSettings.crop, bottom: parseInt(e.target.value) } })} className="w-full accent-accent-cyan" />
                  </div>
                </div>
              </div>
            </div>

            {/* Filters */}
            <div className="space-y-2">
              <h3 className="text-[10px] font-black tracking-widest text-gray-500 uppercase">Filters</h3>
              <div className="grid grid-cols-3 gap-2">
                {['None', 'B&W', 'Sepia', 'Vivid', 'Cool', 'Dim'].map(f => (
                  <button
                    key={f}
                    onClick={() => setCamoSettings({ ...camoSettings, filter: f as any })}
                    className={`py-2 px-2 rounded border text-[10px] font-medium transition-all ${
                      camoSettings.filter === f 
                        ? 'bg-accent-cyan/10 border-accent-cyan text-accent-cyan' 
                        : 'bg-panel/40 border-white/5 text-gray-400 hover:border-white/20 hover:text-gray-200'
                    }`}
                  >
                    {f}
                  </button>
                ))}
              </div>
            </div>

            {/* AI Effects */}
            <div className="space-y-2 pt-2">
              <div className="flex items-center justify-between">
                <h3 className="text-[10px] font-black tracking-widest text-gray-500 uppercase flex items-center gap-1"><Sparkles size={10} className="text-accent-purple" /> AI Effects</h3>
                <span className="text-[8px] bg-white/10 text-gray-300 px-1.5 py-0.5 rounded font-bold">PRO</span>
              </div>
              <div className="flex items-center justify-between bg-white/5 p-3 rounded border border-white/10">
                <span className="text-[11px] font-bold text-gray-300">Remove Background</span>
                <button 
                  onClick={() => setCamoSettings({ ...camoSettings, removeBackground: !camoSettings.removeBackground })}
                  className={`w-8 h-4 rounded-full p-0.5 transition-all duration-300 ${camoSettings.removeBackground ? 'bg-accent-cyan' : 'bg-gray-700'}`}
                >
                  <motion.div 
                    className="w-3 h-3 bg-white rounded-full shadow-lg"
                    animate={{ x: camoSettings.removeBackground ? 16 : 0 }}
                    transition={{ type: "spring", stiffness: 500, damping: 30 }}
                  />
                </button>
              </div>
              <p className="text-[8px] text-gray-500 italic">Upgrade license to unlock green screen.</p>
            </div>
          </div>
        )}

        {activeTab === 'PROP' && (
          <>
            {/* Lower Thirds Module */}
            <div className="rack-module">
              <div className="bg-gray-800/50 p-2 border-b border-border flex items-center gap-2">
                <Type size={14} className="text-accent-cyan" />
                <span className="text-[11px] font-bold uppercase tracking-wider">Lower Thirds</span>
              </div>
              <div className="p-3 space-y-3">
                <div className="space-y-2">
                  <input 
                    type="text" 
                    placeholder="Name / Primary Text"
                    value={lowerThirds.name}
                    onChange={(e) => setLowerThirds({...lowerThirds, name: e.target.value})}
                    className="w-full bg-black/40 border border-white/10 rounded px-2 py-1.5 text-[11px] focus:border-accent-cyan outline-none"
                  />
                  <input 
                    type="text" 
                    placeholder="Title / Subtext"
                    value={lowerThirds.title}
                    onChange={(e) => setLowerThirds({...lowerThirds, title: e.target.value})}
                    className="w-full bg-black/40 border border-white/10 rounded px-2 py-1.5 text-[11px] focus:border-accent-cyan outline-none"
                  />
                </div>
                <div className="flex gap-2">
                  <button 
                    onClick={toggleLowerThirds}
                    className={`flex-1 py-2 rounded text-[10px] font-bold uppercase border transition-all ${
                      lowerThirds.visible ? 'bg-accent-cyan text-bg border-accent-cyan' : 'border-white/10 text-gray-400 hover:bg-white/5'
                    }`}
                  >
                    {lowerThirds.visible ? 'Hide' : 'Show'}
                  </button>
                  <button 
                    onClick={() => showLowerThirdsTimed(lowerThirds.duration)}
                    className="px-3 py-2 rounded border border-white/10 text-gray-400 hover:bg-white/5 text-[10px] font-bold uppercase"
                  >
                    Auto {lowerThirds.duration}s
                  </button>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-[9px] text-gray-500 uppercase">Accent Color</span>
                  <div className="flex gap-1">
                    {['#00f3ff', '#ff0055', '#00ff88', '#ffaa00', '#d946ef'].map(c => (
                      <button 
                        key={c}
                        onClick={() => setLowerThirds({...lowerThirds, accentColor: c})}
                        className={`w-4 h-4 rounded-full border-2 ${lowerThirds.accentColor === c ? 'border-white' : 'border-transparent'}`}
                        style={{ backgroundColor: c }}
                      />
                    ))}
                  </div>
                </div>
              </div>
            </div>

            {/* Graphics Assets */}
            <div className="rack-module">
              <div className="bg-gray-800/50 p-2 border-b border-border flex items-center gap-2">
                <ImageIcon size={14} className="text-gray-400" />
                <span className="text-[11px] font-bold uppercase tracking-wider">Graphics Assets</span>
              </div>
              <div className="p-2 space-y-1">
                {['Bug - Logo', 'Overlay - Socials', 'Lower Third - Name'].map(g => (
                  <button 
                    key={g} 
                    onClick={() => toggleGraphic(g)}
                    className={`w-full flex items-center justify-between p-1.5 hover:bg-white/5 rounded-sm transition-colors text-[11px] ${activeGraphics.has(g) ? 'text-accent-cyan' : 'text-gray-400'}`}
                  >
                    <span>{g}</span>
                    <div className={`w-3 h-3 border rounded-sm flex items-center justify-center transition-colors ${activeGraphics.has(g) ? 'bg-accent-cyan border-accent-cyan' : 'border-gray-600'}`}>
                      {activeGraphics.has(g) && <Check size={8} className="text-bg" />}
                    </div>
                  </button>
                ))}
              </div>
            </div>
          </>
        )}

        {activeTab === 'IN' && (
          <>
            {/* Input Manager */}
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
                  <button className="btn-hardware text-[10px] py-2 flex flex-col items-center gap-1">
                    <Camera size={12} />
                    <span>CAM 1</span>
                  </button>
                  <button className="btn-hardware text-[10px] py-2 flex flex-col items-center gap-1 opacity-50">
                    <Smartphone size={12} />
                    <span>PHONE 1</span>
                  </button>
                </div>
                <div className="space-y-2">
                  <button 
                    onClick={emergencyWide}
                    className="w-full py-2 bg-accent-red/10 border border-accent-red/30 text-accent-red text-[10px] font-bold uppercase rounded hover:bg-accent-red/20"
                  >
                    Emergency Wide
                  </button>
                  <button 
                    onClick={cutToNext}
                    className="w-full py-2 bg-accent-cyan/10 border border-accent-cyan/30 text-accent-cyan text-[10px] font-bold uppercase rounded hover:bg-accent-cyan/20"
                  >
                    Cut To Next
                  </button>
                </div>
              </div>
            </div>

            {/* Remote Camera Module */}
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
                      <div className="absolute inset-0 border-4 border-white/20 pointer-events-none" />
                    </div>
                    <p className="text-[9px] text-gray-500 text-center uppercase leading-tight">
                      Open this URL on your phone to <br /> connect as wireless camera:
                    </p>
                    <div className="w-full bg-black/40 p-2 rounded border border-white/5 text-[8px] font-mono break-all text-accent-cyan select-all">
                      {window.location.origin}?mode=remote
                    </div>
                    <button 
                      onClick={() => {
                        const url = `${window.location.origin}?mode=remote`;
                        navigator.clipboard.writeText(url);
                      }}
                      className="w-full btn-hardware text-[10px] uppercase font-bold py-1.5"
                    >
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
                      <div className="w-full h-full flex items-center justify-center opacity-20">
                        <Video size={32} />
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-2 text-[9px] font-mono">
                      <div className="flex flex-col">
                        <span className="text-gray-500">Latency</span>
                        <span className="text-accent-green">42ms</span>
                      </div>
                      <div className="flex flex-col">
                        <span className="text-gray-500">Battery</span>
                        <span className="text-yellow-500">84%</span>
                      </div>
                    </div>
                    <button 
                      onClick={toggleRemote}
                      className="w-full btn-hardware text-[10px] uppercase font-bold py-1.5 text-accent-red border-accent-red/20"
                    >
                      Disconnect
                    </button>
                  </div>
                )}
              </div>
            </div>
          </>
        )}

        {activeTab === 'AI' && (
          <>
            {/* AI Health Module */}
            <div className="rack-module">
              <div className="bg-gray-800/50 p-2 border-b border-border flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Activity size={14} className="text-accent-cyan" />
                  <span className="text-[11px] font-bold uppercase tracking-wider">AI Health</span>
                </div>
                <button className="p-1 hover:bg-white/5 rounded">
                  <RefreshCw size={10} className="text-gray-500" />
                </button>
              </div>
              <div className="p-3 space-y-2">
                <div className="flex justify-between text-[10px]">
                  <span className="text-gray-500">Relay Status</span>
                  <span className="text-accent-green font-bold">OPTIMAL</span>
                </div>
                <div className="flex justify-between text-[10px]">
                  <span className="text-gray-500">Latency</span>
                  <span className="text-white">124ms</span>
                </div>
                <div className="h-1 bg-gray-900 rounded-full overflow-hidden">
                  <div className="h-full bg-accent-cyan w-3/4" />
                </div>
              </div>
            </div>

            {/* Generative Backgrounds */}
            <div className="rack-module">
              <div className="bg-gray-800/50 p-2 border-b border-border flex items-center gap-2">
                <Sparkles size={14} className="text-accent-cyan" />
                <span className="text-[11px] font-bold uppercase tracking-wider">Generative BG</span>
              </div>
              <div className="p-3 space-y-3">
                <textarea 
                  placeholder="Describe your scene background..."
                  value={generativePrompt}
                  onChange={(e) => setGenerativePrompt(e.target.value)}
                  className="w-full h-20 bg-black/40 border border-white/10 rounded p-2 text-[10px] focus:border-accent-cyan outline-none resize-none"
                />
                <div className="flex flex-wrap gap-1">
                  {['Cyberpunk', 'Minimal', 'Studio', 'Abstract'].map(hint => (
                    <button 
                      key={hint}
                      onClick={() => setGenerativePrompt(hint)}
                      className="px-1.5 py-0.5 bg-white/5 rounded text-[8px] text-gray-500 hover:text-gray-300"
                    >
                      {hint}
                    </button>
                  ))}
                </div>
                <button 
                  onClick={generateBackground}
                  disabled={isGenerating}
                  className="w-full py-2 bg-accent-cyan text-bg text-[10px] font-bold uppercase rounded flex items-center justify-center gap-2 disabled:opacity-50"
                >
                  {isGenerating ? <RefreshCw size={12} className="animate-spin" /> : <Sparkles size={12} />}
                  {isGenerating ? 'Generating...' : 'Generate Scene'}
                </button>
              </div>
            </div>

            {/* AI Director Module */}
            <div className="rack-module">
              <div className="bg-gray-800/50 p-2 border-b border-border flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Brain size={14} className="text-accent-cyan" />
                  <span className="text-[11px] font-bold uppercase tracking-wider">AI Director</span>
                </div>
                <div className={`text-[9px] px-1.5 rounded-full font-bold transition-colors ${aiMode === 'AUTO' ? 'bg-accent-cyan/20 text-accent-cyan' : 'bg-gray-700 text-gray-400'}`}>
                  {aiMode}
                </div>
              </div>
              <div className="p-3 space-y-3">
                <div className="space-y-1">
                  <p className="text-[10px] text-gray-500 uppercase font-medium">Mode Selection</p>
                  <div className="grid grid-cols-3 gap-1 bg-black/40 p-1 rounded-sm border border-white/5">
                    <button 
                      onClick={() => setAiMode('MANUAL')}
                      className={`text-[10px] py-1 rounded-sm transition-colors ${aiMode === 'MANUAL' ? 'bg-gray-700 text-white' : 'text-gray-500 hover:text-gray-300'}`}
                    >
                      Manual
                    </button>
                    <button 
                      onClick={() => setAiMode('AUTO')}
                      className={`text-[10px] py-1 rounded-sm transition-colors ${aiMode === 'AUTO' ? 'bg-accent-cyan text-bg font-bold' : 'text-gray-500 hover:text-gray-300'}`}
                      title="Audio-based switching"
                    >
                      Audio
                    </button>
                    <button 
                      onClick={() => setAiMode('TIMER')}
                      className={`text-[10px] py-1 rounded-sm transition-colors ${aiMode === 'TIMER' ? 'bg-accent-cyan text-bg font-bold' : 'text-gray-500 hover:text-gray-300'}`}
                      title="Timer-based switching"
                    >
                      Timer
                    </button>
                  </div>
                </div>
                <div className="space-y-1">
                  <div className="flex justify-between text-[9px] text-gray-500 uppercase">
                    <span>Confidence</span>
                    <span>88%</span>
                  </div>
                  <div className="h-1 bg-gray-900 rounded-full overflow-hidden">
                    <motion.div 
                      className="h-full bg-accent-cyan"
                      initial={{ width: 0 }}
                      animate={{ width: '88%' }}
                    />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <button 
                    className="btn-hardware btn-hardware-active text-[10px]" 
                    onClick={executeAiAction}
                    disabled={!aiSuggestion}
                  >
                    Execute
                  </button>
                  <button 
                    className="btn-hardware text-[10px]" 
                    onClick={() => setAiSuggestion(null)}
                    disabled={!aiSuggestion}
                  >
                    Ignore
                  </button>
                </div>
              </div>
            </div>
          </>
        )}

        {activeTab === 'OPS' && (
          <div className="h-full flex flex-col space-y-4">
            <LayoutStudio 
              layout={layout}
              setLayout={setLayout}
              composerMode={composerMode}
              setComposerMode={setComposerMode}
              onApplyLayout={() => {
                setServerLogs(prev => [{ message: `OPS: Applying layout "${layout}" ${composerMode ? '(Lumina Active)' : ''}`, type: 'info', id: Date.now() }, ...prev]);
                
                if (composerMode) {
                  setTransition('Fade');
                  setTransitionSpeed(800);
                }

                if (layout === 'Dual Split' || layout === 'Side-by-Side' || layout === 'Picture-in-Pic') {
                  const dualScene = scenes.find(s => s.type === 'DUAL');
                  if (dualScene) setActiveScene(dualScene);
                } else if (layout === 'Grid') {
                  const gridScene = scenes.find(s => s.type === 'GRID');
                  if (gridScene) setActiveScene(gridScene);
                } else if (layout === 'Solo' || layout === 'Speaker' || layout === 'Framed Solo') {
                  const cam1 = scenes.find(s => s.name === 'Cam 1');
                  if (cam1) setActiveScene(cam1);
                } else if (layout === 'Projector + Spk' || layout === 'Split Left' || layout === 'Split Right' || layout === 'PiP') {
                  const screenScene = scenes.find(s => s.type === 'SCREEN');
                  if (screenScene) setActiveScene(screenScene);
                }
              }}
              onPreviewLayout={() => {
                setServerLogs(prev => [{ message: `OPS: Previewing layout "${layout}"`, type: 'info', id: Date.now() }, ...prev]);
              }}
              onSwapLayout={swapSources}
              onSavePreset={saveScenePreset}
              activeTheme={activeTheme}
              setActiveTheme={setActiveTheme}
              background={background}
              setBackground={setBackground}
              frameStyle={frameStyle}
              setFrameStyle={setFrameStyle}
              motionStyle={motionStyle}
              setMotionStyle={setMotionStyle}
              brandColor={brandColor}
              setBrandColor={setBrandColor}
            />
            
            {/* Transitions Module */}
            <div className="rack-module">
              <div className="bg-gray-800/50 p-2 border-b border-border flex items-center gap-2">
                <Settings2 size={14} className="text-gray-400" />
                <span className="text-[11px] font-bold uppercase tracking-wider">Transitions</span>
              </div>
              <div className="p-3 space-y-3">
                <div className="grid grid-cols-3 gap-1">
                  {['Cut', 'Fade', 'Wipe'].map(t => (
                    <button 
                      key={t} 
                      onClick={() => setTransition(t)}
                      className={`btn-hardware text-[9px] py-1.5 transition-colors ${transition === t ? 'btn-hardware-active' : ''}`}
                    >
                      {t}
                    </button>
                  ))}
                </div>
                <div className="space-y-1">
                  <div className="flex justify-between text-[9px] text-gray-500 uppercase">
                    <span>Speed</span>
                    <span className="font-mono">{transitionSpeed}ms</span>
                  </div>
                  <input 
                    type="range" 
                    min="0" 
                    max="2000" 
                    step="100"
                    value={transitionSpeed}
                    onChange={(e) => setTransitionSpeed(parseInt(e.target.value))}
                    className="w-full accent-accent-cyan h-1 bg-gray-800 rounded-lg appearance-none cursor-pointer"
                  />
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
                <button 
                  onClick={saveScenePreset}
                  className="p-1 hover:bg-white/5 rounded text-accent-cyan transition-colors"
                  title="Save Current Scene as Preset"
                >
                  <Plus size={12} />
                </button>
              </div>
              <div className="p-2 space-y-1 max-h-40 overflow-y-auto custom-scrollbar">
                {scenePresets.map(preset => (
                  <div key={preset.id} className="flex items-center gap-1 group">
                    <button 
                      onClick={() => loadScenePreset(preset.id)}
                      className="flex-1 text-left p-1.5 hover:bg-white/5 rounded text-[10px] text-gray-400 hover:text-white transition-colors truncate font-medium"
                    >
                      {preset.name}
                    </button>
                    <button 
                      onClick={() => deleteScenePreset(preset.id)}
                      className="p-1.5 opacity-0 group-hover:opacity-100 text-gray-600 hover:text-accent-red hover:bg-accent-red/10 rounded transition-all"
                      title="Delete Preset"
                    >
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
                <button 
                  onClick={onAddPhone}
                  className="p-1 hover:bg-white/5 rounded text-accent-cyan transition-colors"
                  title="Connect New Phone"
                >
                  <Plus size={12} />
                </button>
              </div>
              <div className="p-3">
                <div className="grid grid-cols-4 gap-2 mb-2">
                  {[1, 2, 3, 4].map(i => {
                    const isConnected = i <= phoneSlots.length;
                    return (
                      <div 
                        key={i}
                        className={`aspect-square rounded border flex items-center justify-center transition-colors ${
                          isConnected ? 'bg-accent-cyan/10 border-accent-cyan/50 text-accent-cyan shadow-[0_0_10px_rgba(0,243,255,0.1)]' : 'bg-black/40 border-white/5 text-gray-700'
                        }`}
                        title={isConnected ? `Phone ${i} Connected` : 'Empty Slot'}
                      >
                        <span className="text-[10px] font-bold">{i}</span>
                      </div>
                    );
                  })}
                </div>
                {phoneSlots.length === 0 ? (
                  <div className="text-[9px] text-gray-500 text-center leading-tight">
                    Click + to scan QR and connect a phone camera via WebRTC.
                  </div>
                ) : (
                  <div className="text-[9px] text-accent-cyan text-center leading-tight">
                    {phoneSlots.length} phone(s) connected and streaming.
                  </div>
                )}
              </div>
            </div>

            {/* Script Runner Module */}
            <div className="rack-module">
              <div className="bg-gray-800/50 p-2 border-b border-border flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Play size={14} className={isScriptRunning ? 'text-accent-green' : 'text-gray-400'} />
                  <span className="text-[11px] font-bold uppercase tracking-wider">Script Runner</span>
                </div>
                <div className="text-[9px] text-gray-500 font-mono uppercase truncate max-w-[100px]" title={script.name}>
                  {script.name}
                </div>
              </div>
              <div className="p-3 space-y-3">
                <div className="space-y-1.5 max-h-40 overflow-y-auto custom-scrollbar pr-1">
                  {script.steps.map((step, idx) => (
                    <div 
                      key={step.id} 
                      className={`flex items-center gap-2 p-2 rounded-sm border transition-all ${idx === currentStepIndex && isScriptRunning ? 'bg-accent-green/10 border-accent-green/30 text-white shadow-sm' : 'border-transparent text-gray-500 hover:bg-white/5'}`}
                    >
                      <div className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${idx === currentStepIndex && isScriptRunning ? 'bg-accent-green animate-pulse shadow-[0_0_5px_rgba(0,255,136,0.5)]' : idx < currentStepIndex && isScriptRunning ? 'bg-gray-600' : 'bg-gray-800'}`} />
                      <span className="text-[10px] flex-1 truncate font-medium">{step.label}</span>
                      <span className="text-[9px] font-mono opacity-50 bg-black/40 px-1 rounded">{step.duration}s</span>
                    </div>
                  ))}
                </div>
                <div className="grid grid-cols-2 gap-2 pt-2 border-t border-white/5">
                  <button 
                    onClick={toggleScript}
                    className={`btn-hardware flex items-center justify-center gap-2 py-2 ${isScriptRunning ? 'text-accent-red border-accent-red/20 bg-accent-red/5 hover:bg-accent-red/10' : 'text-accent-green border-accent-green/20 hover:bg-accent-green/5'}`}
                  >
                    {isScriptRunning ? <Square size={10} fill="currentColor" /> : <Play size={10} fill="currentColor" />}
                    <span className="text-[10px] uppercase font-bold">{isScriptRunning ? 'Stop' : 'Run'}</span>
                  </button>
                  <button 
                    onClick={skipStep}
                    disabled={!isScriptRunning}
                    className="btn-hardware flex items-center justify-center gap-2 py-2 disabled:opacity-30 hover:bg-white/5"
                  >
                    <ChevronRight size={12} />
                    <span className="text-[10px] uppercase font-bold">Skip</span>
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

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
      </div>
    </div>
  );
};

const SceneSwitcher = ({ 
  scenes, 
  activeScene, 
  onSceneChange,
}: { 
  scenes: Scene[], 
  activeScene: Scene, 
  onSceneChange: (s: Scene) => void,
}) => {
  return (
    <div className="flex-1 border-r border-border flex flex-col p-3">
      <h3 className="text-[10px] font-bold uppercase tracking-widest text-gray-500 mb-3">Scenes</h3>
      <div className="flex flex-wrap gap-3">
        {scenes.map(scene => (
          <button 
            key={scene.id}
            onClick={() => onSceneChange(scene)}
            className={`w-28 h-20 rack-module flex flex-col items-center justify-center gap-2 transition-all active:scale-95 ${activeScene.id === scene.id ? 'border-accent-cyan ring-1 ring-accent-cyan/50 bg-accent-cyan/5' : 'hover:border-gray-600'}`}
          >
            {scene.type === 'CAM' && <Camera size={20} className={activeScene.id === scene.id ? 'text-accent-cyan' : 'text-gray-500'} />}
            {scene.type === 'SCREEN' && <Monitor size={20} className={activeScene.id === scene.id ? 'text-accent-cyan' : 'text-gray-500'} />}
            {scene.type === 'DUAL' && <Layers size={20} className={activeScene.id === scene.id ? 'text-accent-cyan' : 'text-gray-500'} />}
            {scene.type === 'GRID' && <Activity size={20} className={activeScene.id === scene.id ? 'text-accent-cyan' : 'text-gray-500'} />}
            {scene.type === 'PODCAST' && <Mic size={20} className={activeScene.id === scene.id ? 'text-accent-cyan' : 'text-gray-500'} />}
            <span className={`text-[10px] font-bold uppercase tracking-wider ${activeScene.id === scene.id ? 'text-white' : 'text-gray-500'}`}>{scene.name}</span>
          </button>
        ))}
      </div>
    </div>
  );
};

const AudioMixer = ({ 
  channels, 
  onToggleMute, 
  onLevelChange 
}: { 
  channels: any[], 
  onToggleMute: (name: string) => void,
  onLevelChange: (name: string, val: number) => void
}) => {
  return (
    <div className="w-80 bg-panel p-3 flex flex-col">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-[10px] font-bold uppercase tracking-widest text-gray-500">Audio Mixer</h3>
        <div className="flex gap-2">
          <Volume2 size={12} className="text-gray-500" />
          <Settings size={12} className="text-gray-500 hover:text-white transition-colors cursor-pointer" />
        </div>
      </div>
      
      <div className="flex-1 space-y-4 overflow-y-auto custom-scrollbar pr-2">
        {channels.map(ch => (
          <div key={ch.name} className="space-y-1.5">
            <div className="flex justify-between items-center text-[10px] uppercase font-medium">
              <span className={ch.muted ? 'text-gray-600' : 'text-gray-300'}>{ch.name}</span>
              <button 
                onClick={() => onToggleMute(ch.name)}
                className={`p-1 rounded-sm transition-colors ${ch.muted ? 'text-accent-red bg-accent-red/10' : 'text-gray-500 hover:text-white hover:bg-white/5'}`}
              >
                {ch.muted ? <MicOff size={10} /> : <Mic size={10} />}
              </button>
            </div>
            <div className="flex items-center gap-3">
              <div className="flex-1 space-y-1">
                <div className="h-2 bg-black rounded-sm relative overflow-hidden">
                  <motion.div 
                    className={`h-full bg-gradient-to-r from-accent-green via-yellow-400 to-accent-red transition-opacity ${ch.muted ? 'opacity-20' : 'opacity-100'}`}
                    initial={{ width: 0 }}
                    animate={{ width: `${ch.level * 100}%` }}
                    transition={{ duration: 0.1 }}
                  />
                  <div className="absolute top-0 bottom-0 w-0.5 bg-white/40" style={{ left: `${ch.peak * 100}%` }} />
                </div>
                <input 
                  type="range" 
                  className="w-full h-1 bg-gray-800 rounded-lg appearance-none cursor-pointer accent-accent-cyan"
                  value={ch.volume * 100}
                  onChange={(e) => onLevelChange(ch.name, parseInt(e.target.value) / 100)}
                />
              </div>
              <div className="flex flex-col gap-1">
                <button className="p-1 text-[8px] border border-border rounded-sm hover:bg-white/5 text-gray-500 hover:text-white transition-colors">M</button>
                <button className="p-1 text-[8px] border border-border rounded-sm hover:bg-white/5 text-gray-500 hover:text-white transition-colors">S</button>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

const RecordingGallery = ({ 
  recordings, 
  onClose,
  onDelete,
  onPlay
}: { 
  recordings: Recording[], 
  onClose: () => void,
  onDelete: (id: string) => void,
  onPlay: (rec: Recording) => void
}) => {
  return (
    <motion.div 
      initial={{ opacity: 0, x: 20 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: 20 }}
      className="fixed inset-0 z-50 flex items-center justify-center p-8 bg-black/80 backdrop-blur-sm"
    >
      <div className="w-full max-w-4xl bg-bg border border-border rounded-lg shadow-2xl flex flex-col max-h-[80vh]">
        <div className="p-4 border-b border-border flex items-center justify-between">
          <div className="flex items-center gap-3">
            <History className="text-accent-cyan" size={20} />
            <h2 className="text-lg font-bold uppercase tracking-tight">Recording Gallery</h2>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-white/5 rounded-full transition-colors">
            <X size={20} />
          </button>
        </div>
        
        <div className="flex-1 overflow-y-auto p-6 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {recordings.length === 0 ? (
            <div className="col-span-full flex flex-col items-center justify-center py-20 text-gray-500 gap-4">
              <Video size={48} className="opacity-20" />
              <p className="text-sm uppercase font-bold tracking-widest">No recordings found</p>
            </div>
          ) : (
            recordings.map(rec => (
              <div key={rec.id} className="rack-module group overflow-hidden">
                <div className="aspect-video bg-black relative">
                  <img src={rec.thumbnail} alt={rec.fileName} className="w-full h-full object-cover opacity-60 group-hover:opacity-100 transition-opacity" />
                  <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                    <button 
                      onClick={() => onPlay(rec)}
                      className="w-12 h-12 bg-accent-cyan rounded-full flex items-center justify-center text-bg shadow-xl active:scale-90 transition-transform"
                    >
                      <Play size={24} fill="currentColor" />
                    </button>
                  </div>
                  <div className="absolute bottom-2 right-2 px-1.5 py-0.5 bg-black/80 text-[10px] font-mono rounded-sm">
                    {rec.duration}
                  </div>
                </div>
                <div className="p-3 space-y-2">
                  <div className="flex justify-between items-start">
                    <div className="flex flex-col">
                      <span className="text-[11px] font-bold truncate max-w-[150px]">{rec.fileName}</span>
                      <span className="text-[9px] text-gray-500">{rec.timestamp}</span>
                    </div>
                    <span className="text-[9px] font-mono text-gray-400">{rec.size}</span>
                  </div>
                  <div className="flex gap-2 pt-2 border-t border-border/50">
                    <button className="flex-1 btn-hardware text-[9px] py-1 flex items-center justify-center gap-1.5">
                      <Download size={10} /> Download
                    </button>
                    <button 
                      onClick={() => onDelete(rec.id)}
                      className="p-1.5 btn-hardware text-accent-red border-accent-red/20 hover:bg-accent-red/10"
                    >
                      <Trash2 size={12} />
                    </button>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </motion.div>
  );
};

const ScriptEditor = ({ 
  script, 
  onClose,
  onSave
}: { 
  script: Script, 
  onClose: () => void,
  onSave: (s: Script) => void
}) => {
  const [editedScript, setEditedScript] = useState<Script>(JSON.parse(JSON.stringify(script)));

  const addStep = () => {
    const newStep: ScriptStep = {
      id: `s-${Date.now()}`,
      sceneId: '1',
      duration: 5,
      label: 'New Step'
    };
    setEditedScript(prev => ({ ...prev, steps: [...prev.steps, newStep] }));
  };

  const updateStep = (id: string, updates: Partial<ScriptStep>) => {
    setEditedScript(prev => ({
      ...prev,
      steps: prev.steps.map(s => s.id === id ? { ...s, ...updates } : s)
    }));
  };

  const removeStep = (id: string) => {
    setEditedScript(prev => ({
      ...prev,
      steps: prev.steps.filter(s => s.id !== id)
    }));
  };

  return (
    <motion.div 
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.95 }}
      className="fixed inset-0 z-50 flex items-center justify-center p-8 bg-black/80 backdrop-blur-sm"
    >
      <div className="w-full max-w-2xl bg-bg border border-border rounded-lg shadow-2xl flex flex-col max-h-[80vh]">
        <div className="p-4 border-b border-border flex items-center justify-between bg-white/5">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-accent-cyan/10 flex items-center justify-center">
              <Edit3 className="text-accent-cyan" size={20} />
            </div>
            <div>
              <h2 className="text-sm font-bold uppercase tracking-widest text-white">Script Editor</h2>
              <p className="text-[10px] text-gray-400">Automate your broadcast sequence</p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 text-gray-500 hover:text-white hover:bg-white/10 rounded-full transition-colors">
            <X size={20} />
          </button>
        </div>

        <div className="p-5 bg-black/20 border-b border-border">
          <div className="flex flex-col gap-1.5">
            <label className="text-[10px] uppercase font-bold text-gray-500 tracking-wider">Script Name</label>
            <input 
              type="text" 
              value={editedScript.name}
              onChange={(e) => setEditedScript(prev => ({ ...prev, name: e.target.value }))}
              className="bg-black border border-border rounded-lg px-3 py-2.5 text-xs text-white focus:outline-none focus:border-accent-cyan transition-colors"
              placeholder="e.g., Main Show Sequence"
            />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-3 custom-scrollbar">
          {editedScript.steps.map((step, idx) => (
            <div key={step.id} className="flex items-center gap-4 p-4 bg-black/40 rounded-xl border border-border group transition-all hover:border-white/10">
              <div className="w-8 h-8 rounded-full bg-gray-800 flex items-center justify-center text-xs font-bold text-gray-400 group-hover:bg-accent-cyan/20 group-hover:text-accent-cyan transition-colors">
                {idx + 1}
              </div>
              <div className="flex-1 grid grid-cols-3 gap-4">
                <div className="flex flex-col gap-1.5">
                  <label className="text-[9px] uppercase font-bold text-gray-500 tracking-wider">Label</label>
                  <input 
                    type="text" 
                    value={step.label}
                    onChange={(e) => updateStep(step.id, { label: e.target.value })}
                    className="bg-black border border-border rounded-md px-2.5 py-2 text-xs text-white focus:outline-none focus:border-accent-cyan transition-colors"
                    placeholder="Step description"
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <label className="text-[9px] uppercase font-bold text-gray-500 tracking-wider">Scene</label>
                  <select 
                    value={step.sceneId}
                    onChange={(e) => updateStep(step.id, { sceneId: e.target.value })}
                    className="bg-black border border-border rounded-md px-2.5 py-2 text-xs text-white focus:outline-none focus:border-accent-cyan transition-colors appearance-none cursor-pointer"
                  >
                    {SCENES.map(s => (
                      <option key={s.id} value={s.id}>{s.name}</option>
                    ))}
                  </select>
                </div>
                <div className="flex flex-col gap-1.5">
                  <label className="text-[9px] uppercase font-bold text-gray-500 tracking-wider">Duration (s)</label>
                  <input 
                    type="number" 
                    value={step.duration}
                    onChange={(e) => updateStep(step.id, { duration: parseInt(e.target.value) || 0 })}
                    className="bg-black border border-border rounded-md px-2.5 py-2 text-xs text-white focus:outline-none focus:border-accent-cyan transition-colors font-mono"
                    min="1"
                  />
                </div>
              </div>
              <button 
                onClick={() => removeStep(step.id)}
                className="p-2 text-gray-500 hover:text-accent-red hover:bg-accent-red/10 rounded-md transition-colors opacity-0 group-hover:opacity-100"
                title="Remove Step"
              >
                <Trash2 size={16} />
              </button>
            </div>
          ))}
          <button 
            onClick={addStep}
            className="w-full py-4 border border-dashed border-border rounded-xl text-gray-500 hover:text-white hover:border-gray-500 hover:bg-white/5 transition-all flex items-center justify-center gap-2 text-xs uppercase font-bold"
          >
            <Plus size={16} /> Add Step
          </button>
        </div>

        <div className="p-5 border-t border-border bg-black/20 flex justify-end gap-3">
          <button 
            onClick={onClose} 
            className="px-6 py-2.5 bg-transparent hover:bg-white/5 text-white font-bold rounded-lg transition-all uppercase tracking-widest text-[10px] border border-border"
          >
            Cancel
          </button>
          <button 
            onClick={() => onSave(editedScript)}
            className="px-8 py-2.5 bg-accent-cyan hover:bg-cyan-400 text-bg font-bold rounded-lg transition-all uppercase tracking-widest text-[10px] shadow-[0_0_15px_rgba(0,243,255,0.3)] flex items-center gap-2"
          >
            <Save size={14} />
            Save Script
          </button>
        </div>
      </div>
    </motion.div>
  );
};

// --- Main App ---

const RemoteCameraView = () => {
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [status, setStatus] = useState('Initializing...');
  const socketRef = useRef<any>(null);
  const peersRef = useRef<Map<string, any>>(new Map());

  useEffect(() => {
    const start = async () => {
      try {
        console.log('Remote: Requesting camera...');
        const s = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
        setStream(s);
        setStatus('Camera ready. Connecting to studio...');

        const socket = io();
        socketRef.current = socket;

        const params = new URLSearchParams(window.location.search);
        const roomId = params.get('room') || 'default-room';
        
        socket.emit('join-room', roomId);

        socket.on('user-joined', (userId) => {
          console.log('Remote: Studio joined:', userId);
          setStatus('Studio detected. Establishing P2P...');
          
          const peer = new Peer({ initiator: true, stream: s, trickle: false });
          
          peer.on('signal', (data) => {
            socket.emit('signal', { roomId, signal: data, to: userId });
          });
          
          peer.on('connect', () => {
            console.log('Remote: Peer connected');
            setStatus('CONNECTED TO STUDIO');
          });

          peer.on('error', (err) => {
            console.error('Remote: Peer error:', err);
            setStatus('Connection Error');
          });

          peersRef.current.set(userId, peer);
        });

        socket.on('signal', (data) => {
          console.log('Remote: Received signal from', data.from);
          const peer = peersRef.current.get(data.from);
          if (peer) {
            peer.signal(data.signal);
          }
        });

      } catch (err: any) {
        console.error('Remote: Error:', err);
        setStatus('Error: ' + err.message);
      }
    };
    start();

    return () => {
      if (socketRef.current) socketRef.current.disconnect();
      peersRef.current.forEach(p => p.destroy());
    };
  }, []);

  return (
    <div className="h-screen bg-bg flex flex-col items-center justify-center p-4 text-white font-sans">
      <div className="w-full max-w-md space-y-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-accent-cyan/10 flex items-center justify-center">
              <Smartphone size={20} className="text-accent-cyan" />
            </div>
            <div>
              <h1 className="text-sm font-bold uppercase tracking-widest">Aether Remote</h1>
              <p className="text-[10px] text-gray-400">Wireless Camera Source</p>
            </div>
          </div>
          <div className="text-[10px] font-mono text-gray-500 bg-white/5 px-2 py-1 rounded-md border border-white/10">v1.0.4</div>
        </div>

        <div className="aspect-video bg-black rounded-2xl overflow-hidden relative border border-border shadow-2xl group">
          {stream ? (
            <video 
              autoPlay 
              muted 
              playsInline 
              ref={el => { if (el) el.srcObject = stream; }} 
              className="w-full h-full object-cover"
            />
          ) : (
            <div className="w-full h-full flex flex-col items-center justify-center text-gray-700 gap-4">
              <Camera size={48} className="opacity-50" />
              <span className="text-xs uppercase tracking-widest font-bold opacity-50">Awaiting Camera</span>
            </div>
          )}
          
          <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/20 to-transparent pointer-events-none" />
          
          <div className="absolute top-4 right-4 flex gap-2">
            <div className="w-2 h-2 rounded-full bg-accent-red animate-pulse shadow-[0_0_10px_rgba(255,68,68,0.8)]" />
          </div>

          <div className="absolute bottom-4 left-4 right-4 flex items-end justify-between">
            <div className="flex flex-col gap-1">
              <span className="text-[9px] text-gray-400 uppercase font-bold tracking-widest">Connection Status</span>
              <div className="flex items-center gap-2">
                <div className={`w-1.5 h-1.5 rounded-full ${status.includes('CONNECTED') ? 'bg-accent-green' : 'bg-accent-cyan animate-pulse'}`} />
                <span className={`text-xs font-bold uppercase tracking-wider ${status.includes('CONNECTED') ? 'text-accent-green' : 'text-accent-cyan'}`}>
                  {status}
                </span>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <div className="p-2.5 bg-black/40 rounded-full backdrop-blur-md border border-white/10 text-accent-cyan">
                <Mic size={16} />
              </div>
            </div>
          </div>
        </div>

        <div className="bg-panel p-5 rounded-2xl border border-border space-y-4 shadow-xl">
          <div className="flex items-start gap-3">
            <div className="p-2 bg-accent-cyan/10 rounded-lg shrink-0">
              <Activity size={16} className="text-accent-cyan" />
            </div>
            <p className="text-[11px] text-gray-400 leading-relaxed">
              This device is now acting as a wireless camera source. 
              Keep this tab open and your screen on for continuous streaming to the studio.
            </p>
          </div>
          <div className="h-px bg-border" />
          <div className="flex items-center justify-between text-[11px] font-mono bg-black/40 p-3 rounded-xl border border-white/5">
            <span className="text-gray-500 uppercase font-bold tracking-wider">Room ID</span>
            <span className="text-white font-bold tracking-widest">DEFAULT-ROOM</span>
          </div>
        </div>
      </div>
    </div>
  );
};

export default function App() {
  const [mode, setMode] = useState<'studio' | 'remote' | 'audience'>('studio');

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const urlMode = params.get('mode');
    if (urlMode === 'remote') {
      setMode('remote');
    } else if (urlMode === 'audience') {
      setMode('audience');
    }
  }, []);

  if (mode === 'remote') {
    return <RemoteCameraView />;
  }

  if (mode === 'audience') {
    return <AudienceLanding />;
  }

  return <StudioView />;
}

function StudioView() {
  // --- State ---
  const [activeScene, setActiveScene] = useState<Scene>(SCENES[0]);
  const [scenes, setScenes] = useState<Scene[]>(SCENES);
  const [isStreaming, setIsStreaming] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [aiMode, setAiMode] = useState<'AUTO' | 'MANUAL'>('MANUAL');
  const [layout, setLayout] = useState('Solo');
  const [transition, setTransition] = useState('Cut');
  const [activeGraphics, setActiveGraphics] = useState<Set<string>>(new Set());
  const [audioChannels, setAudioChannels] = useState(AUDIO_CHANNELS);
  const [sources, setSources] = useState(SOURCES);
  
  // Layout Studio State
  const [background, setBackground] = useState('Gradient Motion');
  const [frameStyle, setFrameStyle] = useState('Glass');
  const [motionStyle, setMotionStyle] = useState('Snappy');
  const [brandColor, setBrandColor] = useState('#5d28d9');

  const [camoSettings, setCamoSettings] = useState<CamoSettings>({
    layout: 'Fill',
    contentFit: 'Fit',
    scale: 1.0,
    x: 0,
    y: 0,
    shape: 'Rect',
    cornerRadius: 0,
    crop: { left: 0, right: 0, top: 0, bottom: 0 },
    filter: 'None',
    removeBackground: false
  });

  const [telemetry, setTelemetry] = useState<Telemetry>({
    bitrate: '0.0 Mbps',
    fps: 60,
    cpu: 12,
    droppedFrames: 0,
    network: 'excellent'
  });
  const [serverLogs, setServerLogs] = useState<{ message: string, type: string, id: number }[]>([]);
  const [showServerLogs, setShowServerLogs] = useState(false);
  const [aiSuggestion, setAiSuggestion] = useState<{ scene: string, reason: string } | null>(null);

  // Script Runner State
  const [activeScript, setActiveScript] = useState<Script>(SAMPLE_SCRIPT);
  const [isScriptRunning, setIsScriptRunning] = useState(false);
  const [currentStepIndex, setCurrentStepIndex] = useState(0);
  const [stepTimeRemaining, setStepTimeRemaining] = useState(0);

  const [activeTab, setActiveTab] = useState<'CAMO' | 'PROP' | 'IN' | 'AI' | 'OPS' | 'AUD'>('IN');
  const [audienceMessages, setAudienceMessages] = useState<AudienceMessage[]>([]);
  const [activeMessageId, setActiveMessageId] = useState<string | null>(null);
  const [lowerThirds, setLowerThirds] = useState({
    name: 'Olu',
    title: 'Engineer',
    visible: false,
    duration: 5,
    accentColor: '#d946ef'
  });
  const [composerMode, setComposerMode] = useState(true);
  const [aiHealth, setAiHealth] = useState({ status: 'online', relay: 'https://aether-relay-9g68.onrender.com' });
  const [generativePrompt, setGenerativePrompt] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [backgroundImage, setBackgroundImage] = useState<string | null>(null);
  const [activeTheme, setActiveTheme] = useState('Broadcast Studio');
  const [transitionSpeed, setTransitionSpeed] = useState(300);
  const [showQrModal, setShowQrModal] = useState(false);
  const [qrMode, setQrMode] = useState<'camera' | 'audience'>('camera');
  const [phoneSlots, setPhoneSlots] = useState<string[]>([]);
  const [scenePresets, setScenePresets] = useState<any[]>([
    { id: 'p1', name: 'Main + Thumbs', layout: 'Grid', activeSceneId: '5', background: 'Brand Theme', frameStyle: 'Glass', activeTheme: 'Broadcast Studio' },
    { id: 'p2', name: 'Side by Side', layout: 'Side-by-Side', activeSceneId: '4', background: 'Gradient Motion', frameStyle: 'Flat', activeTheme: 'Neon Cyber' },
    { id: 'p3', name: 'PiP Corner', layout: 'Picture-in-Pic', activeSceneId: '1', background: 'Solid Dark', frameStyle: 'Floating', activeTheme: 'Minimalist' },
  ]);

  // Script Runner Logic
  useEffect(() => {
    let timer: any;
    if (isScriptRunning) {
      timer = setInterval(() => {
        setStepTimeRemaining(prev => {
          if (prev <= 1) {
            // Move to next step
            const nextIdx = currentStepIndex + 1;
            if (nextIdx >= activeScript.steps.length) {
              setIsScriptRunning(false);
              setCurrentStepIndex(0);
              return 0;
            }
            setCurrentStepIndex(nextIdx);
            const nextStep = activeScript.steps[nextIdx];
            
            // Auto-switch scene if step has one
            if (nextStep.sceneId) {
              const targetScene = scenes.find(s => s.id === nextStep.sceneId);
              if (targetScene) setActiveScene(targetScene);
            }
            
            return nextStep.duration;
          }
          return prev - 1;
        });
      }, 1000);
    }
    return () => clearInterval(timer);
  }, [isScriptRunning, currentStepIndex, activeScript, scenes]);

  const toggleScript = () => {
    if (!isScriptRunning) {
      setCurrentStepIndex(0);
      setStepTimeRemaining(activeScript.steps[0].duration);
      const firstStep = activeScript.steps[0];
      if (firstStep.sceneId) {
        const targetScene = scenes.find(s => s.id === firstStep.sceneId);
        if (targetScene) setActiveScene(targetScene);
      }
    }
    setIsScriptRunning(!isScriptRunning);
  };

  const skipStep = () => {
    const nextIdx = currentStepIndex + 1;
    if (nextIdx >= activeScript.steps.length) {
      setIsScriptRunning(false);
      setCurrentStepIndex(0);
      return;
    }
    setCurrentStepIndex(nextIdx);
    const nextStep = activeScript.steps[nextIdx];
    setStepTimeRemaining(nextStep.duration);
    if (nextStep.sceneId) {
      const targetScene = scenes.find(s => s.id === nextStep.sceneId);
      if (targetScene) setActiveScene(targetScene);
    }
  };

  const executeAiAction = () => {
    if (aiSuggestion) {
      const targetScene = scenes.find(s => s.name === aiSuggestion.scene);
      if (targetScene) {
        setActiveScene(targetScene);
        setServerLogs(prev => [{ message: `AI: Executed switch to ${aiSuggestion.scene}`, type: 'info', id: Date.now() }, ...prev]);
        setAiSuggestion(null);
      }
    }
  };

  const emergencyWide = () => {
    const cam1 = scenes.find(s => s.name === 'Cam 1');
    if (cam1) setActiveScene(cam1);
    setServerLogs(prev => [{ message: `OPS: Emergency Wide triggered`, type: 'warning', id: Date.now() }, ...prev]);
  };

  const cutToNext = () => {
    const currentIndex = scenes.findIndex(s => s.id === activeScene.id);
    const nextIndex = (currentIndex + 1) % scenes.length;
    setActiveScene(scenes[nextIndex]);
  };

  const swapSources = () => {
    setServerLogs(prev => [{ message: `OPS: Swapping sources`, type: 'info', id: Date.now() }, ...prev]);
    setSourceSwap(prev => !prev);
  };

  const toggleLowerThirds = () => {
    setLowerThirds(prev => ({ ...prev, visible: !prev.visible }));
  };

  const showLowerThirdsTimed = (seconds: number) => {
    setLowerThirds(prev => ({ ...prev, visible: true, duration: seconds }));
    setTimeout(() => {
      setLowerThirds(prev => ({ ...prev, visible: false }));
    }, seconds * 1000);
  };

  const generateBackground = async () => {
    if (!generativePrompt) return;
    setIsGenerating(true);
    try {
      console.log('Generating background for:', generativePrompt);
      const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || '' });
      const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash-image',
        contents: {
          parts: [
            {
              text: `A high quality, professional studio background for a live stream. Theme: ${generativePrompt}. Cinematic lighting, 4k resolution.`,
            },
          ],
        },
        config: {
          imageConfig: {
            aspectRatio: "16:9",
          },
        },
      });

      for (const part of response.candidates[0].content.parts) {
        if (part.inlineData) {
          const base64EncodeString = part.inlineData.data;
          const imageUrl = `data:image/png;base64,${base64EncodeString}`;
          setBackgroundImage(imageUrl);
          setServerLogs(prev => [{ message: `AI: Background generated for "${generativePrompt}"`, type: 'info', id: Date.now() }, ...prev]);
        }
      }
    } catch (err) {
      console.error('AI: Failed to generate background:', err);
      setServerLogs(prev => [{ message: `AI Error: Failed to generate background`, type: 'error', id: Date.now() }, ...prev]);
    } finally {
      setIsGenerating(false);
    }
  };

  // Feature States
  const [isSocketConnected, setIsSocketConnected] = useState(false);
  const [isRemoteConnected, setIsRemoteConnected] = useState(false);
  const [showRecordingGallery, setShowRecordingGallery] = useState(false);
  const [selectedVideo, setSelectedVideo] = useState<Recording | null>(null);
  const [showScriptEditor, setShowScriptEditor] = useState(false);
  const [showStreamSettings, setShowStreamSettings] = useState(false);
  const [showHardwareSetup, setShowHardwareSetup] = useState(false);
  const [destinations, setDestinations] = useState<StreamDestination[]>([
    { id: '1', name: 'YouTube', rtmpUrl: 'rtmps://a.rtmp.youtube.com:443/live2', streamKey: '', enabled: true }
  ]);
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [selectedVideoDevice, setSelectedVideoDevice] = useState<string>('');
  const [selectedVideoDevice2, setSelectedVideoDevice2] = useState<string>('');
  const [selectedAudioDevice, setSelectedAudioDevice] = useState<string>('');
  const [screenStream, setScreenStream] = useState<MediaStream | null>(null);
  const [recordings, setRecordings] = useState<Recording[]>([
    {
      id: 'rec-1',
      timestamp: '2026-03-14 10:30',
      duration: '00:45:12',
      size: '1.2 GB',
      thumbnail: 'https://picsum.photos/seed/rec1/320/180',
      fileName: 'Podcast_Ep12_Final.mp4'
    },
    {
      id: 'rec-2',
      timestamp: '2026-03-13 14:15',
      duration: '00:12:05',
      size: '450 MB',
      thumbnail: 'https://picsum.photos/seed/rec2/320/180',
      fileName: 'Interview_Snippet.mp4'
    }
  ]);

  const [webcamStream, setWebcamStream] = useState<MediaStream | null>(null);
  const [remoteStreams, setRemoteStreams] = useState<Map<string, MediaStream>>(new Map());
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordedChunksRef = useRef<Blob[]>([]);
  const socketRef = useRef<any>(null);

  // --- Effects ---

  // Sync streams with Audio Engine
  useEffect(() => {
    audioEngine.init();
    
    // Add active streams
    if (webcamStream) {
      audioEngine.addStream('Local Mic', webcamStream);
      const ch = audioChannels.find(c => c.name === 'Mic 1');
      if (ch) {
        audioEngine.setVolume('Local Mic', ch.volume);
        audioEngine.setMuted('Local Mic', ch.muted);
      }
    }
    if (screenStream) {
      audioEngine.addStream('Screen Share', screenStream);
      const ch = audioChannels.find(c => c.name === 'System');
      if (ch) {
        audioEngine.setVolume('Screen Share', ch.volume);
        audioEngine.setMuted('Screen Share', ch.muted);
      }
    }
    remoteStreams.forEach((stream, id) => {
      audioEngine.addStream(id, stream);
      const ch = audioChannels.find(c => c.name === id);
      if (ch) {
        audioEngine.setVolume(id, ch.volume);
        audioEngine.setMuted(id, ch.muted);
      }
    });

    // Remove inactive streams
    const currentIds = new Set(['Local Mic', 'Screen Share', ...Array.from(remoteStreams.keys())]);
    if (!webcamStream) currentIds.delete('Local Mic');
    if (!screenStream) currentIds.delete('Screen Share');

    Array.from(audioEngine.sources.keys()).forEach(id => {
      if (!currentIds.has(id)) {
        audioEngine.removeStream(id);
      }
    });

    // Sync UI channels
    setAudioChannels(prev => {
      const next = [...prev];
      
      // Add remote streams if missing
      remoteStreams.forEach((_, id) => {
        if (!next.find(c => c.name === id)) {
          next.push({ name: id, level: 0, volume: 1.0, peak: 0, muted: false });
        }
      });

      // Remove remote streams if gone
      return next.filter(c => {
        if (c.name === 'Mic 1' || c.name === 'Mic 2' || c.name === 'System' || c.name === 'Media') return true;
        return remoteStreams.has(c.name);
      });
    });
  }, [webcamStream, screenStream, remoteStreams]);

  // Sync audio levels to UI
  useEffect(() => {
    const interval = setInterval(() => {
      const levels = audioEngine.getLevels();
      
      setAudioChannels(prev => prev.map(c => {
        let level = 0;
        if (c.name === 'Mic 1' && levels['Local Mic']) level = levels['Local Mic'];
        else if (c.name === 'System' && levels['Screen Share']) level = levels['Screen Share'];
        else if (levels[c.name]) level = levels[c.name]; // For remote streams if names match

        return {
          ...c,
          level: Math.max(0, Math.min(1, level)),
          peak: Math.max(c.peak || 0, level)
        };
      }));

      setSources(prev => prev.map(s => {
        let level = 0;
        if (s.name === 'Cam 1' && levels['Local Mic']) level = levels['Local Mic'];
        else if (s.name === 'Screen Share' && levels['Screen Share']) level = levels['Screen Share'];
        else if (levels[s.name]) level = levels[s.name];

        return {
          ...s,
          audioLevel: Math.max(0, Math.min(1, level))
        };
      }));
    }, 100);
    return () => clearInterval(interval);
  }, []);

  const reconnectSocket = useCallback(() => {
    if (socketRef.current) {
      socketRef.current.disconnect();
    }
    console.log('Studio: Reconnecting signaling...');
    const socket = io();
    socketRef.current = socket;
    const roomId = 'default-room';
    
    socket.on('connect', () => setIsSocketConnected(true));
    socket.on('disconnect', () => setIsSocketConnected(false));
    
    socket.emit('join-room', roomId);

    socket.on('signal', (data) => {
      console.log('Studio: Received signal from remote', data.from);
      const peer = new Peer({ initiator: false, trickle: false });
      peer.on('signal', (signal) => {
        socket.emit('signal', { roomId, signal, to: data.from });
      });
      peer.on('stream', (stream) => {
        setRemoteStreams(prev => {
          const next = new Map(prev);
          next.set(data.from, stream);
          return next;
        });
        setIsRemoteConnected(true);
      });
      peer.on('error', (err) => console.error('Studio: Peer error:', err));
      peer.signal(data.signal);
    });

    socket.on('server-log', (log) => {
      setServerLogs(prev => [{ ...log, id: Date.now() }, ...prev].slice(0, 50));
    });

    socket.on('audience-message', (message) => {
      setAudienceMessages(prev => [message, ...prev].slice(0, 50));
    });
  }, []);

  useEffect(() => {
    reconnectSocket();
    return () => {
      if (socketRef.current) socketRef.current.disconnect();
    };
  }, [reconnectSocket]);

  useEffect(() => {
    const getDevices = async () => {
      try {
        const devs = await navigator.mediaDevices.enumerateDevices();
        setDevices(devs);
        const video = devs.find(d => d.kind === 'videoinput');
        const audio = devs.find(d => d.kind === 'audioinput');
        if (video) setSelectedVideoDevice(video.deviceId);
        if (audio) setSelectedAudioDevice(audio.deviceId);
      } catch (err) {
        console.error('Error enumerating devices:', err);
      }
    };
    getDevices();
  }, []);

  const startCamera = async (videoId?: string, audioId?: string, videoId2?: string) => {
    console.log('App: Starting camera...', videoId, audioId, videoId2);
    try {
      const constraints = {
        video: videoId ? { deviceId: { exact: videoId }, width: 1920, height: 1080 } : { width: 1920, height: 1080 },
        audio: audioId ? { deviceId: { exact: audioId } } : true
      };
      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      setWebcamStream(stream);
      
      if (videoId2) {
        const stream2 = await navigator.mediaDevices.getUserMedia({
          video: { deviceId: { exact: videoId2 }, width: 1920, height: 1080 }
        });
        // We'll store the second stream in remoteStreams for now to reuse the Compositor logic
        setRemoteStreams(prev => {
          const next = new Map(prev);
          next.set('local-cam-2', stream2);
          return next;
        });
      }

      setSources(prev => prev.map(s => s.name === 'Cam 1' ? { ...s, status: 'active' } : s));
      setShowHardwareSetup(false);
    } catch (err) {
      console.error('App: Error accessing camera:', err);
    }
  };

  const startScreenShare = async () => {
    console.log('App: Requesting screen share...');
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({ 
        video: { cursor: "always" } as any, 
        audio: true 
      });
      console.log('App: Screen share stream obtained:', stream.id);
      setScreenStream(stream);
      setSources(prev => prev.map(s => s.name === 'Screen Share' ? { ...s, status: 'active' } : s));
      
      // Force switch to screen scene if it exists
      const screenScene = scenes.find(s => s.type === 'SCREEN');
      if (screenScene) setActiveScene(screenScene);

      stream.getVideoTracks()[0].onended = () => {
        console.log('App: Screen share ended by user');
        setScreenStream(null);
        setSources(prev => prev.map(s => s.name === 'Screen Share' ? { ...s, status: 'standby' } : s));
      };
    } catch (err) {
      console.error('App: Error starting screen share:', err);
    }
  };

  const stopCamera = () => {
    if (webcamStream) {
      webcamStream.getTracks().forEach(track => track.stop());
      setWebcamStream(null);
      setSources(prev => prev.map(s => s.name === 'Cam 1' ? { ...s, status: 'standby' } : s));
    }
  };

  const startStreaming = async () => {
    const activeDestinations = destinations.filter(d => d.enabled);
    if (activeDestinations.length === 0 || !activeDestinations.every(d => d.streamKey)) {
      setShowStreamSettings(true);
      return;
    }

    try {
      // Check if we are running inside Tauri
      if (window.__TAURI_INTERNALS__) {
        const { invoke } = await import('@tauri-apps/api/core');
        const res = await invoke('start_stream', { destinations });
        setServerLogs(prev => [{ message: `Tauri: ${res}`, type: 'success', id: Date.now() }, ...prev]);
        setIsStreaming(true);
      } else {
        // Fallback to Web/Node.js relay behavior
        const canvas = document.querySelector('canvas');
        if (!canvas) return;

        const stream = canvas.captureStream(30);
        const mixedAudio = audioEngine.getMixedStream();
        if (mixedAudio) {
          mixedAudio.getAudioTracks().forEach(track => stream.addTrack(track));
        }

        // Request H264 if available to reduce FFmpeg transcoding overhead
        const mimeType = MediaRecorder.isTypeSupported('video/webm;codecs=h264') 
          ? 'video/webm;codecs=h264' 
          : 'video/webm';

        const recorder = new MediaRecorder(stream, { 
          mimeType,
          videoBitsPerSecond: 8000000 // 8Mbps for high quality source
        });

        recorder.ondataavailable = async (e) => {
          if (e.data.size > 0 && socketRef.current?.connected) {
            const buffer = await e.data.arrayBuffer();
            
            // Update local telemetry bitrate
            const mbps = (e.data.size * 8) / (500000); // Adjusted for 500ms chunks
            setTelemetry(prev => ({ ...prev, bitrate: `${mbps.toFixed(1)} Mbps` }));

            // For web relay, we send all active destinations
            socketRef.current.emit('stream-chunk', {
              chunk: buffer
            });
          }
        };

        recorder.onerror = (err) => {
          console.error('MediaRecorder Error:', err);
          setIsStreaming(false);
          setServerLogs(prev => [{ message: `Recorder Error: ${err}`, type: 'error', id: Date.now() }, ...prev]);
        };

        recorder.start(500); // Send 500ms chunks for lower latency and smoother buffer
        mediaRecorderRef.current = recorder;
        setIsStreaming(true);
        
        socketRef.current.emit('start-stream', { destinations: activeDestinations });
      }
    } catch (err) {
      console.error('Failed to start stream:', err);
      setServerLogs(prev => [{ message: `Stream Error: ${err}`, type: 'error', id: Date.now() }, ...prev]);
      setIsStreaming(false);
    }
  };

  const stopStreaming = async () => {
    try {
      if (window.__TAURI_INTERNALS__) {
        const { invoke } = await import('@tauri-apps/api/core');
        const res = await invoke('stop_stream');
        setServerLogs(prev => [{ message: `Tauri: ${res}`, type: 'info', id: Date.now() }, ...prev]);
        setIsStreaming(false);
      } else {
        if (mediaRecorderRef.current && isStreaming) {
          mediaRecorderRef.current.stop();
          setIsStreaming(false);
          socketRef.current.emit('stop-stream');
        }
      }
    } catch (err) {
      console.error('Failed to stop stream:', err);
    }
  };

  const handleToggleStreaming = () => {
    if (isStreaming) {
      stopStreaming();
    } else {
      startStreaming();
    }
  };

  const handleToggleRecording = () => {
    if (isRecording) {
      stopRecording();
    } else {
      startRecording();
    }
  };

  const startRecording = () => {
    const canvas = document.querySelector('canvas');
    if (!canvas) return;

    const stream = canvas.captureStream(60);
    // Add audio if available
    const mixedAudio = audioEngine.getMixedStream();
    if (mixedAudio) {
      mixedAudio.getAudioTracks().forEach(track => stream.addTrack(track));
    }

    const recorder = new MediaRecorder(stream, { mimeType: 'video/webm;codecs=vp9' });
    recordedChunksRef.current = [];
    
    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) {
        recordedChunksRef.current.push(e.data);
      }
    };

    recorder.onstop = () => {
      const blob = new Blob(recordedChunksRef.current, { type: 'video/webm' });
      const url = URL.createObjectURL(blob);
      const newRecording: Recording = {
        id: `rec-${Date.now()}`,
        fileName: `Broadcast_${new Date().toISOString().replace(/[:.]/g, '-')}.webm`,
        timestamp: new Date().toLocaleString(),
        duration: '00:00:10', // Simplified for demo
        size: `${(blob.size / (1024 * 1024)).toFixed(1)} MB`,
        thumbnail: url, // Using the video URL as thumbnail for now
        url: url
      };
      setRecordings(prev => [newRecording, ...prev]);
    };

    recorder.start();
    mediaRecorderRef.current = recorder;
    setIsRecording(true);
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
    }
  };

  const handleMenuAction = (action: string) => {
    console.log('Menu Action:', action);
    const [menu, item] = action.split(':');

    switch (item) {
      case 'Add Camera':
        setShowHardwareSetup(true);
        break;
      case 'Add Screen Share':
        startScreenShare();
        break;
      case 'Exit':
        stopCamera();
        window.close();
        break;
      case 'Start Streaming':
        setShowStreamSettings(true);
        break;
      case 'Stop Streaming':
        stopStreaming();
        break;
      case 'New Scene':
        const newScene: Scene = {
          id: `scene-${Date.now()}`,
          name: `Scene ${scenes.length + 1}`,
          type: 'CAM'
        };
        setScenes(prev => [...prev, newScene]);
        break;
      default:
        break;
    }
  };

  const [sourceSwap, setSourceSwap] = useState(false);
  const [showSavePresetModal, setShowSavePresetModal] = useState(false);
  const [presetNameInput, setPresetNameInput] = useState('');

  const addLog = (message: string, type: string = 'info') => {
    setServerLogs(prev => [{ message, type, id: Date.now() }, ...prev].slice(0, 50));
  };

  const saveScenePreset = () => {
    setPresetNameInput(`Preset ${scenePresets.length + 1}`);
    setShowSavePresetModal(true);
  };

  const confirmSavePreset = () => {
    if (presetNameInput.trim()) {
      const newPreset = {
        id: `p-${Date.now()}`,
        name: presetNameInput.trim(),
        layout,
        activeSceneId: activeScene.id,
        background,
        frameStyle,
        activeTheme,
        camoSettings
      };
      setScenePresets(prev => [...prev, newPreset]);
      addLog(`Saved preset: ${presetNameInput.trim()}`, 'success');
      setShowSavePresetModal(false);
    }
  };

  const loadScenePreset = (id: string) => {
    const preset = scenePresets.find(p => p.id === id);
    if (preset) {
      if (preset.layout) setLayout(preset.layout);
      if (preset.background) setBackground(preset.background);
      if (preset.frameStyle) setFrameStyle(preset.frameStyle);
      if (preset.activeTheme) setActiveTheme(preset.activeTheme);
      if (preset.camoSettings) setCamoSettings(preset.camoSettings);
      
      const scene = scenes.find(s => s.id === preset.activeSceneId);
      if (scene) setActiveScene(scene);
      
      addLog(`Loaded preset: ${preset.name}`, 'info');
    }
  };

  const deleteScenePreset = (id: string) => {
    setScenePresets(prev => prev.filter(p => p.id !== id));
  };

  // AI Director Logic
  useEffect(() => {
    if (aiMode !== 'AUTO') return;

    const interval = setInterval(() => {
      const randomScene = scenes[Math.floor(Math.random() * scenes.length)];
      if (randomScene.id !== activeScene.id) {
        setAiSuggestion({
          scene: randomScene.name,
          reason: 'Dynamic focus shift based on activity'
        });
        
        setActiveScene(randomScene);
        addLog(`AI Director: Switched to ${randomScene.name}`, 'info');
      }
    }, 15000);

    return () => clearInterval(interval);
  }, [aiMode, activeScene, scenes]);

  // Script Runner Logic
  useEffect(() => {
    if (!isScriptRunning) return;

    const currentStep = activeScript.steps[currentStepIndex];
    if (!currentStep) {
      setIsScriptRunning(false);
      return;
    }

    // Switch scene on step start
    const targetScene = scenes.find(s => s.id === currentStep.sceneId);
    if (targetScene && activeScene.id !== targetScene.id) {
      setActiveScene(targetScene);
    }

    setStepTimeRemaining(currentStep.duration);

    const timer = setInterval(() => {
      setStepTimeRemaining(prev => {
        if (prev <= 1) {
          // Move to next step
          if (currentStepIndex < activeScript.steps.length - 1) {
            setCurrentStepIndex(idx => idx + 1);
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

  // Simulated Telemetry
  useEffect(() => {
    const interval = setInterval(() => {
      setTelemetry(prev => ({
        ...prev,
        bitrate: isStreaming ? `${(4.1 + Math.random() * 0.3).toFixed(1)} Mbps` : '0.0 Mbps',
        cpu: Math.floor(10 + Math.random() * 15),
        droppedFrames: prev.droppedFrames + (Math.random() > 0.99 ? 1 : 0)
      }));
    }, 1000);
    return () => clearInterval(interval);
  }, [isStreaming]);

  const runAiDirector = async () => {
    if (aiMode === 'MANUAL' || !isStreaming) return;
    
    try {
      const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || '' });
      const prompt = `You are a professional broadcast director for "Selton Studio".
      Current Scene: ${activeScene.name}
      Available Scenes: ${SCENES.map(s => s.name).join(', ')}
      Telemetry: CPU ${telemetry.cpu}%, Bitrate ${telemetry.bitrate}
      
      Analyze the broadcast state and decide if we should switch scenes to maintain viewer engagement.
      If a switch is needed, return ONLY the name of the target scene. If no switch is needed, return "STAY".`;

      const response = await ai.models.generateContent({
        model: 'gemini-3-flash-preview',
        contents: prompt,
      });

      const decision = response.text?.trim().toUpperCase();
      if (decision && decision !== 'STAY') {
        const nextScene = SCENES.find(s => s.name.toUpperCase() === decision);
        if (nextScene && nextScene.id !== activeScene.id) {
          setServerLogs(prev => [{ message: `AI Director: Auto-switched to ${nextScene.name}`, type: 'info', id: Date.now() }, ...prev]);
          setActiveScene(nextScene);
        }
      }
    } catch (err) {
      console.error('AI Director Error:', err);
    }
  };

  // AI Director Logic
  useEffect(() => {
    if (aiMode === 'AUTO') {
      const checkInterval = setInterval(() => {
        const activeSource = sources.find(s => s.audioLevel > 0.8);
        if (activeSource && activeSource.name !== activeScene.name) {
          const targetScene = scenes.find(s => s.name === activeSource.name);
          if (targetScene) {
            setAiSuggestion({
              scene: targetScene.name,
              reason: `High audio activity detected on ${targetScene.name}`
            });
            // Auto switch if in AUTO mode
            setActiveScene(targetScene);
          }
        } else {
          // Periodically use Gemini for creative switching
          runAiDirector();
        }
      }, 8000);
      return () => clearInterval(checkInterval);
    } else if (aiMode === 'TIMER') {
      const timerInterval = setInterval(() => {
        const currentIndex = scenes.findIndex(s => s.id === activeScene.id);
        const nextIndex = (currentIndex + 1) % scenes.length;
        const nextScene = scenes[nextIndex];
        
        setAiSuggestion({
          scene: nextScene.name,
          reason: `Timer-based auto-switch to ${nextScene.name}`
        });
        setActiveScene(nextScene);
        setServerLogs(prev => [{ message: `AI Director: Timer auto-switched to ${nextScene.name}`, type: 'info', id: Date.now() }, ...prev]);
      }, 15000); // Switch every 15 seconds
      return () => clearInterval(timerInterval);
    } else {
      setAiSuggestion(null);
    }
  }, [aiMode, sources, activeScene, scenes, isStreaming]);

  // Keyboard Shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key >= '1' && e.key <= '6') {
        const index = parseInt(e.key) - 1;
        if (scenes[index]) setActiveScene(scenes[index]);
      }
      if (e.code === 'Space') {
        e.preventDefault();
        setTransition('Cut');
        console.log('CUT executed');
      }
      if (e.key === 'f' || e.key === 'F') {
        setTransition('Fade');
        console.log('FADE executed');
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  // --- Handlers ---
  const toggleGraphic = (g: string) => {
    const next = new Set(activeGraphics);
    if (next.has(g)) next.delete(g);
    else next.add(g);
    setActiveGraphics(next);
  };

  const toggleMute = (name: string) => {
    setAudioChannels(prev => prev.map(c => {
      if (c.name === name) {
        const newMuted = !c.muted;
        let engineId = name;
        if (name === 'Mic 1') engineId = 'Local Mic';
        if (name === 'System') engineId = 'Screen Share';
        audioEngine.setMuted(engineId, newMuted);
        return { ...c, muted: newMuted };
      }
      return c;
    }));
  };

  const onLevelChange = (name: string, val: number) => {
    setAudioChannels(prev => prev.map(c => {
      if (c.name === name) {
        let engineId = name;
        if (name === 'Mic 1') engineId = 'Local Mic';
        if (name === 'System') engineId = 'Screen Share';
        audioEngine.setVolume(engineId, val);
        return { ...c, volume: val };
      }
      return c;
    }));
  };

  const executeAiSuggestion = () => {
    if (aiSuggestion) {
      const targetScene = scenes.find(s => s.name === aiSuggestion.scene);
      if (targetScene) {
        setActiveScene(targetScene);
        setAiSuggestion(null);
      }
    }
  };

  return (
    <div className="h-screen flex flex-col bg-bg text-gray-300 overflow-hidden select-none font-sans">
      <MenuBar 
        onOpenGallery={() => setShowRecordingGallery(true)} 
        onOpenEditor={() => setShowScriptEditor(true)} 
        onAction={handleMenuAction}
      />
      <div className="flex items-center justify-end px-4 py-1 bg-black/20 border-b border-border gap-4">
        <div className="flex items-center gap-2 mr-auto">
          <div className={`w-2 h-2 rounded-full ${isSocketConnected ? 'bg-accent-cyan animate-pulse' : 'bg-accent-red'}`} />
          <span className="text-[10px] font-bold uppercase tracking-wider text-gray-500">
            {isSocketConnected ? 'Engine Connected' : 'Engine Offline'}
          </span>
          {!isSocketConnected && (
            <button 
              onClick={reconnectSocket}
              className="text-[10px] text-accent-cyan underline hover:text-white ml-2"
            >
              Reconnect
            </button>
          )}
        </div>
        <button 
          onClick={() => setShowServerLogs(!showServerLogs)}
          className={`text-[10px] font-bold uppercase tracking-wider flex items-center gap-2 px-2 py-1 rounded transition-colors ${showServerLogs ? 'bg-accent-cyan text-bg' : 'text-accent-cyan hover:bg-accent-cyan/10'}`}
        >
          <Terminal size={12} />
          Server Logs
        </button>
      </div>
      <TelemetryBar telemetry={telemetry} isStreaming={isStreaming} isRecording={isRecording} />
      
      <div className="flex-1 flex overflow-hidden">
        <SourceRack sources={sources} onSourceClick={(s) => {
          const scene = scenes.find(sc => sc.name === s.name);
          if (scene) setActiveScene(scene);
        }} />
        
        <div className="flex-1 flex flex-col min-w-0">
          <ProgramView 
            activeScene={activeScene} 
            sources={sources}
            isStreaming={isStreaming} 
            isRecording={isRecording}
            onToggleStreaming={handleToggleStreaming}
            onToggleRecording={handleToggleRecording}
            webcamStream={webcamStream}
            remoteStreams={remoteStreams}
            screenStream={screenStream}
            transitionType={transition}
            layout={layout}
            lowerThirds={lowerThirds}
            graphics={{
              showBug: activeGraphics.has('Bug - Logo'),
              showSocials: activeGraphics.has('Overlay - Socials')
            }}
            backgroundImage={backgroundImage}
            theme={activeTheme}
            background={background}
            frameStyle={frameStyle}
            motionStyle={motionStyle}
            brandColor={brandColor}
            camoSettings={camoSettings}
            sourceSwap={sourceSwap}
            audienceMessages={audienceMessages}
            activeMessageId={activeMessageId}
          />
          
          <div className="h-64 flex border-t border-border bg-panel">
            <SceneSwitcher 
              scenes={scenes}
              activeScene={activeScene} 
              onSceneChange={setActiveScene} 
            />
            <AudioMixer 
              channels={audioChannels} 
              onToggleMute={toggleMute} 
              onLevelChange={onLevelChange}
            />
          </div>
        </div>

        <DirectorRack 
          aiMode={aiMode} 
          setAiMode={setAiMode} 
          layout={layout} 
          setLayout={setLayout}
          activeGraphics={activeGraphics}
          toggleGraphic={toggleGraphic}
          telemetry={telemetry}
          script={activeScript}
          currentStepIndex={currentStepIndex}
          isScriptRunning={isScriptRunning}
          toggleScript={toggleScript}
          skipStep={skipStep}
          isRemoteConnected={isRemoteConnected}
          toggleRemote={() => setIsRemoteConnected(!isRemoteConnected)}
          activeTab={activeTab}
          setActiveTab={setActiveTab}
          lowerThirds={lowerThirds}
          setLowerThirds={setLowerThirds}
          toggleLowerThirds={toggleLowerThirds}
          showLowerThirdsTimed={showLowerThirdsTimed}
          composerMode={composerMode}
          setComposerMode={setComposerMode}
          aiHealth={aiHealth}
          generativePrompt={generativePrompt}
          setGenerativePrompt={setGenerativePrompt}
          isGenerating={isGenerating}
          generateBackground={generateBackground}
          transition={transition}
          setTransition={setTransition}
          transitionSpeed={transitionSpeed}
          setTransitionSpeed={setTransitionSpeed}
          phoneSlots={phoneSlots}
          onAddPhone={() => {
            setQrMode('camera');
            setShowQrModal(true);
          }}
          scenePresets={scenePresets}
          saveScenePreset={saveScenePreset}
          loadScenePreset={loadScenePreset}
          deleteScenePreset={deleteScenePreset}
          emergencyWide={emergencyWide}
          cutToNext={cutToNext}
          executeAiAction={executeAiAction}
          aiSuggestion={aiSuggestion}
          setAiSuggestion={setAiSuggestion}
          activeTheme={activeTheme}
          setActiveTheme={setActiveTheme}
          swapSources={swapSources}
          setServerLogs={setServerLogs}
          scenes={scenes}
          setActiveScene={setActiveScene}
          background={background}
          setBackground={setBackground}
          frameStyle={frameStyle}
          setFrameStyle={setFrameStyle}
          motionStyle={motionStyle}
          setMotionStyle={setMotionStyle}
          brandColor={brandColor}
          setBrandColor={setBrandColor}
          camoSettings={camoSettings}
          setCamoSettings={setCamoSettings}
          audienceMessages={audienceMessages}
          setAudienceMessages={setAudienceMessages}
          activeMessageId={activeMessageId}
          setActiveMessageId={setActiveMessageId}
          onOpenQrModal={() => {
            setQrMode('audience');
            setShowQrModal(true);
          }}
        />
      </div>

      {/* Server Logs Overlay */}
      <AnimatePresence>
        {showServerLogs && (
          <motion.div 
            initial={{ x: 400 }}
            animate={{ x: 0 }}
            exit={{ x: 400 }}
            className="fixed top-12 right-0 bottom-0 w-96 bg-panel border-l border-border z-40 flex flex-col shadow-2xl"
          >
            <div className="p-4 border-b border-border flex items-center justify-between bg-white/5">
              <h3 className="text-[10px] font-bold uppercase tracking-widest flex items-center gap-2">
                <Terminal size={14} className="text-accent-cyan" />
                Server Streaming Logs
              </h3>
              <button onClick={() => setShowServerLogs(false)} className="text-gray-500 hover:text-white">
                <X size={16} />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-4 font-mono text-[10px] space-y-1 bg-black/50">
              {serverLogs.length === 0 && <div className="text-gray-600 italic">No logs yet...</div>}
              {serverLogs.map(log => (
                <div key={log.id} className={`
                  ${log.type === 'error' ? 'text-accent-red' : ''}
                  ${log.type === 'success' ? 'text-accent-cyan' : ''}
                  ${log.type === 'ffmpeg' ? 'text-gray-500' : 'text-gray-300'}
                `}>
                  <span className="opacity-30 mr-2">[{new Date(log.id).toLocaleTimeString()}]</span>
                  {log.message}
                </div>
              ))}
            </div>
            <div className="p-4 border-t border-border bg-black/20">
              <button 
                onClick={() => setServerLogs([])}
                className="w-full py-2 border border-border rounded text-[10px] uppercase font-bold hover:bg-white/5"
              >
                Clear Logs
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Modals */}
      <AnimatePresence>
        {showHardwareSetup && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
            <motion.div 
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="bg-panel border border-border w-full max-w-lg rounded-2xl shadow-2xl overflow-hidden flex flex-col"
            >
              <div className="p-5 border-b border-border flex items-center justify-between bg-white/5">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-accent-cyan/10 flex items-center justify-center">
                    <Settings size={20} className="text-accent-cyan" />
                  </div>
                  <div>
                    <h2 className="text-sm font-bold uppercase tracking-widest text-white">Hardware Setup</h2>
                    <p className="text-[10px] text-gray-400">Configure local video and audio inputs</p>
                  </div>
                </div>
                <button onClick={() => setShowHardwareSetup(false)} className="p-2 text-gray-500 hover:text-white hover:bg-white/10 rounded-full transition-colors">
                  <X size={20} />
                </button>
              </div>
              
              <div className="p-6 space-y-5 flex-1 overflow-y-auto">
                <div className="bg-black/40 border border-border rounded-xl p-4 space-y-4">
                  <div className="flex items-center gap-2 mb-2">
                    <Camera size={14} className="text-gray-400" />
                    <h3 className="text-xs font-bold uppercase tracking-widest text-gray-300">Video Inputs</h3>
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-bold text-gray-500 uppercase tracking-wider">Primary Camera</label>
                    <select 
                      value={selectedVideoDevice}
                      onChange={(e) => setSelectedVideoDevice(e.target.value)}
                      className="w-full bg-black border border-border rounded-lg px-3 py-2.5 text-xs text-white focus:outline-none focus:border-accent-cyan transition-colors"
                    >
                      <option value="">None</option>
                      {devices.filter(d => d.kind === 'videoinput').map(d => (
                        <option key={d.deviceId} value={d.deviceId}>{d.label || `Camera ${d.deviceId.slice(0, 4)}`}</option>
                      ))}
                    </select>
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-bold text-gray-500 uppercase tracking-wider">Secondary Camera (Optional)</label>
                    <select 
                      value={selectedVideoDevice2}
                      onChange={(e) => setSelectedVideoDevice2(e.target.value)}
                      className="w-full bg-black border border-border rounded-lg px-3 py-2.5 text-xs text-white focus:outline-none focus:border-accent-cyan transition-colors"
                    >
                      <option value="">None</option>
                      {devices.filter(d => d.kind === 'videoinput').map(d => (
                        <option key={d.deviceId} value={d.deviceId}>{d.label || `Camera ${d.deviceId.slice(0, 4)}`}</option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className="bg-black/40 border border-border rounded-xl p-4 space-y-4">
                  <div className="flex items-center gap-2 mb-2">
                    <Mic size={14} className="text-gray-400" />
                    <h3 className="text-xs font-bold uppercase tracking-widest text-gray-300">Audio Inputs</h3>
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-bold text-gray-500 uppercase tracking-wider">Microphone Source</label>
                    <select 
                      value={selectedAudioDevice}
                      onChange={(e) => setSelectedAudioDevice(e.target.value)}
                      className="w-full bg-black border border-border rounded-lg px-3 py-2.5 text-xs text-white focus:outline-none focus:border-accent-cyan transition-colors"
                    >
                      {devices.filter(d => d.kind === 'audioinput').map(d => (
                        <option key={d.deviceId} value={d.deviceId}>{d.label || `Mic ${d.deviceId.slice(0, 4)}`}</option>
                      ))}
                    </select>
                  </div>
                </div>
              </div>

              <div className="p-5 border-t border-border bg-black/20 flex gap-3 justify-end">
                <button 
                  onClick={() => setShowHardwareSetup(false)}
                  className="px-6 py-2.5 bg-transparent hover:bg-white/5 text-white font-bold rounded-lg transition-all uppercase tracking-widest text-[10px] border border-border"
                >
                  Cancel
                </button>
                <button 
                  onClick={() => startCamera(selectedVideoDevice, selectedAudioDevice, selectedVideoDevice2)}
                  className="px-8 py-2.5 bg-accent-cyan hover:bg-cyan-400 text-black font-bold rounded-lg transition-all uppercase tracking-widest text-[10px] shadow-[0_0_15px_rgba(0,229,255,0.3)] flex items-center gap-2"
                >
                  <Check size={14} />
                  Initialize Hardware
                </button>
              </div>
            </motion.div>
          </div>
        )}

        {showStreamSettings && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
            <motion.div 
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="bg-panel border border-border w-full max-w-2xl rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[85vh]"
            >
              <div className="p-5 border-b border-border flex items-center justify-between bg-white/5">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-accent-red/10 flex items-center justify-center">
                    <Radio size={20} className="text-accent-red" />
                  </div>
                  <div>
                    <h2 className="text-sm font-bold uppercase tracking-widest text-white">Stream Destinations</h2>
                    <p className="text-[10px] text-gray-400">Configure multiple RTMP endpoints for simulcasting</p>
                  </div>
                </div>
                <button onClick={() => setShowStreamSettings(false)} className="p-2 text-gray-500 hover:text-white hover:bg-white/10 rounded-full transition-colors">
                  <X size={20} />
                </button>
              </div>
              
              <div className="flex-1 overflow-y-auto p-6 space-y-4">
                {destinations.map((dest, idx) => (
                  <div key={dest.id} className="bg-black/40 border border-border rounded-xl p-5 relative group transition-all hover:border-white/10">
                    <div className="absolute top-5 right-5 flex items-center gap-3">
                      <button 
                        onClick={() => setDestinations(prev => prev.map(d => d.id === dest.id ? { ...d, enabled: !d.enabled } : d))}
                        className={`w-10 h-5 rounded-full relative transition-colors ${dest.enabled ? 'bg-accent-cyan' : 'bg-gray-700'}`}
                      >
                        <div className={`absolute top-0.5 bottom-0.5 w-4 bg-white rounded-full transition-all ${dest.enabled ? 'left-[22px]' : 'left-0.5'}`} />
                      </button>
                      <button 
                        onClick={() => setDestinations(prev => prev.filter(d => d.id !== dest.id))}
                        className="p-1.5 text-gray-500 hover:text-accent-red hover:bg-accent-red/10 rounded-md transition-colors opacity-0 group-hover:opacity-100"
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                    
                    <div className="space-y-4 pr-20">
                      <div className="grid grid-cols-2 gap-5">
                        <div className="space-y-1.5">
                          <label className="text-[10px] font-bold text-gray-500 uppercase tracking-wider">Name</label>
                          <input 
                            type="text"
                            value={dest.name}
                            onChange={(e) => setDestinations(prev => prev.map(d => d.id === dest.id ? { ...d, name: e.target.value } : d))}
                            className="w-full bg-black border border-border rounded-lg px-3 py-2.5 text-xs text-white focus:outline-none focus:border-accent-cyan transition-colors"
                            placeholder="e.g., YouTube Main"
                          />
                        </div>
                        <div className="space-y-1.5">
                          <label className="text-[10px] font-bold text-gray-500 uppercase tracking-wider">RTMP URL</label>
                          <input 
                            type="text"
                            value={dest.rtmpUrl}
                            onChange={(e) => setDestinations(prev => prev.map(d => d.id === dest.id ? { ...d, rtmpUrl: e.target.value } : d))}
                            className="w-full bg-black border border-border rounded-lg px-3 py-2.5 text-xs text-white focus:outline-none focus:border-accent-cyan transition-colors"
                            placeholder="rtmp://..."
                          />
                        </div>
                      </div>
                      <div className="space-y-1.5">
                        <label className="text-[10px] font-bold text-gray-500 uppercase tracking-wider">Stream Key</label>
                        <input 
                          type="password"
                          value={dest.streamKey}
                          onChange={(e) => setDestinations(prev => prev.map(d => d.id === dest.id ? { ...d, streamKey: e.target.value } : d))}
                          className="w-full bg-black border border-border rounded-lg px-3 py-2.5 text-xs text-white focus:outline-none focus:border-accent-cyan transition-colors font-mono"
                          placeholder="••••••••••••••••"
                        />
                      </div>
                    </div>
                  </div>
                ))}

                <button 
                  onClick={() => setDestinations(prev => [...prev, { id: `dest-${Date.now()}`, name: 'New Destination', rtmpUrl: '', streamKey: '', enabled: true }])}
                  className="w-full py-4 border border-dashed border-border rounded-xl text-gray-500 hover:text-white hover:border-gray-500 hover:bg-white/5 transition-all flex items-center justify-center gap-2 text-xs uppercase font-bold"
                >
                  <Plus size={16} /> Add Destination
                </button>
              </div>

              <div className="p-5 border-t border-border bg-black/20 flex gap-3 justify-end">
                <button 
                  onClick={() => setShowStreamSettings(false)}
                  className="px-6 py-2.5 bg-transparent hover:bg-white/5 text-white font-bold rounded-lg transition-all uppercase tracking-widest text-[10px] border border-border"
                >
                  Cancel
                </button>
                <button 
                  onClick={() => {
                    setShowStreamSettings(false);
                    startStreaming();
                  }}
                  className="px-8 py-2.5 bg-accent-red hover:bg-red-500 text-white font-bold rounded-lg transition-all uppercase tracking-widest text-[10px] shadow-[0_0_15px_rgba(255,68,68,0.3)] flex items-center gap-2"
                >
                  <Radio size={14} />
                  Start Broadcast
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Overlays */}
      <AnimatePresence>
        {aiSuggestion && (
          <motion.div 
            initial={{ y: 100, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 100, opacity: 0 }}
            className="fixed bottom-6 right-80 z-50 w-80 bg-bg border border-accent-cyan/30 shadow-2xl rounded-lg overflow-hidden"
          >
            <div className="bg-accent-cyan/10 p-3 border-b border-accent-cyan/20 flex items-center gap-2">
              <Brain size={16} className="text-accent-cyan" />
              <span className="text-xs font-bold uppercase tracking-wider text-accent-cyan">AI Director Suggestion</span>
            </div>
            <div className="p-4 space-y-3">
              <p className="text-xs text-white">Switch to <span className="font-bold text-accent-cyan">{aiSuggestion.scene}</span>?</p>
              <p className="text-[10px] text-gray-500 italic">"{aiSuggestion.reason}"</p>
              <div className="flex gap-2">
                <button 
                  onClick={executeAiSuggestion}
                  className="flex-1 bg-accent-cyan text-bg text-[10px] font-bold py-1.5 rounded-sm hover:bg-cyan-400 active:scale-95 transition-all"
                >
                  Execute
                </button>
                <button 
                  onClick={() => setAiSuggestion(null)}
                  className="flex-1 bg-gray-800 text-gray-400 text-[10px] font-bold py-1.5 rounded-sm hover:text-white active:scale-95 transition-all"
                >
                  Dismiss
                </button>
              </div>
            </div>
          </motion.div>
        )}

        {showRecordingGallery && (
          <RecordingGallery 
            recordings={recordings} 
            onClose={() => setShowRecordingGallery(false)}
            onDelete={(id) => setRecordings(prev => prev.filter(r => r.id !== id))}
            onPlay={(rec) => setSelectedVideo(rec)}
          />
        )}

        {selectedVideo && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[60] flex items-center justify-center p-8 bg-black/95 backdrop-blur-md"
          >
            <div className="w-full max-w-5xl aspect-video bg-black relative rounded-lg overflow-hidden shadow-2xl border border-white/10">
              <video 
                src={selectedVideo.url} 
                controls 
                autoPlay 
                className="w-full h-full"
              />
              <button 
                onClick={() => setSelectedVideo(null)}
                className="absolute top-4 right-4 p-2 bg-black/50 hover:bg-black/80 rounded-full text-white transition-colors"
              >
                <X size={24} />
              </button>
              <div className="absolute bottom-4 left-4 bg-black/50 px-3 py-1.5 rounded-sm border border-white/10">
                <p className="text-xs font-bold text-accent-cyan uppercase tracking-widest">{selectedVideo.fileName}</p>
              </div>
            </div>
          </motion.div>
        )}

        {showScriptEditor && (
          <ScriptEditor 
            script={activeScript}
            onClose={() => setShowScriptEditor(false)}
            onSave={(s) => {
              setActiveScript(s);
              setShowScriptEditor(false);
              setCurrentStepIndex(0);
              setIsScriptRunning(false);
            }}
          />
        )}
      </AnimatePresence>

      {/* QR Modal */}
      <AnimatePresence>
        {showQrModal && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm"
            onClick={() => setShowQrModal(false)}
          >
            <motion.div 
              initial={{ scale: 0.9, y: 20 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.9, y: 20 }}
              className="bg-gray-900 border border-border rounded-xl p-8 max-w-2xl w-full shadow-2xl relative"
              onClick={e => e.stopPropagation()}
            >
              <button 
                onClick={() => setShowQrModal(false)}
                className="absolute top-4 right-4 text-gray-400 hover:text-white transition-colors"
              >
                <X size={20} />
              </button>
              
              <div className="flex flex-col items-center mb-6">
                <div className="w-16 h-16 bg-accent-cyan/10 rounded-full flex items-center justify-center mb-4 border border-accent-cyan/30">
                  <Smartphone size={32} className="text-accent-cyan" />
                </div>
                
                <h2 className="text-xl font-bold text-white mb-2">
                  {qrMode === 'camera' ? 'Connect Mobile Camera' : 'Audience Message Portal'}
                </h2>
                <p className="text-sm text-gray-400 mb-4 text-center max-w-md">
                  {qrMode === 'camera' 
                    ? 'Scan this code to link your phone wirelessly.' 
                    : 'Scan this code to send messages to the Studio.'}
                </p>

                <div className="flex bg-black/40 rounded-full p-1 border border-border">
                  <button
                    onClick={() => setQrMode('camera')}
                    className={`px-4 py-1.5 rounded-full text-xs font-bold transition-colors ${
                      qrMode === 'camera' ? 'bg-accent-cyan text-bg' : 'text-gray-400 hover:text-white'
                    }`}
                  >
                    Camera Mode
                  </button>
                  <button
                    onClick={() => setQrMode('audience')}
                    className={`px-4 py-1.5 rounded-full text-xs font-bold transition-colors ${
                      qrMode === 'audience' ? 'bg-orange-500 text-white' : 'text-gray-400 hover:text-white'
                    }`}
                  >
                    Audience Mode
                  </button>
                </div>
              </div>
              
              <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                <div className="flex flex-col items-center border-r border-border pr-8">
                  <h3 className="text-xs font-bold uppercase tracking-wider text-gray-400 mb-4">Option 1: Scan QR</h3>
                  <div className="bg-white p-4 rounded-lg inline-block mb-6">
                    {/* Placeholder for actual QR code */}
                    <div className="w-48 h-48 bg-gray-200 border-4 border-white flex items-center justify-center relative overflow-hidden">
                      <div className="absolute inset-0 grid grid-cols-5 grid-rows-5 gap-1 p-2 opacity-50">
                        {Array.from({length: 25}).map((_, i) => (
                          <div key={i} className={`bg-black ${Math.random() > 0.5 ? 'opacity-100' : 'opacity-0'}`} />
                        ))}
                      </div>
                      <div className="absolute top-0 left-0 w-8 h-8 border-t-4 border-l-4 border-black m-2" />
                      <div className="absolute top-0 right-0 w-8 h-8 border-t-4 border-r-4 border-black m-2" />
                      <div className="absolute bottom-0 left-0 w-8 h-8 border-b-4 border-l-4 border-black m-2" />
                      <span className="relative z-10 text-xs font-bold text-black bg-white/80 px-2 py-1 rounded">QR CODE</span>
                    </div>
                  </div>
                  
                  <div className="w-full">
                    <label className="text-[10px] font-bold uppercase tracking-wider text-gray-500 mb-1 block text-left">APP URL</label>
                    <input 
                      type="text" 
                      readOnly 
                      value={`${window.location.origin}?mode=${qrMode === 'camera' ? 'remote' : 'audience'}&room=SLTN-1234`}
                      className="w-full bg-black/40 border border-border rounded px-3 py-2 text-xs text-gray-300 mb-2"
                    />
                    <div className="flex gap-2">
                      <button 
                        onClick={() => window.open(`${window.location.origin}?mode=${qrMode === 'camera' ? 'remote' : 'audience'}&room=SLTN-1234`, '_blank')}
                        className="flex-1 px-3 py-2 bg-transparent border border-border hover:bg-white/5 rounded text-xs font-bold transition-colors flex items-center justify-center gap-1"
                      >
                        <ExternalLink size={12} /> Test Link
                      </button>
                      <button 
                        onClick={() => navigator.clipboard.writeText(`${window.location.origin}?mode=${qrMode === 'camera' ? 'remote' : 'audience'}&room=SLTN-1234`)}
                        className="flex-1 px-3 py-2 bg-transparent border border-border hover:bg-white/5 rounded text-xs font-bold transition-colors flex items-center justify-center gap-1"
                      >
                        <Copy size={12} /> Copy Link
                      </button>
                      <button 
                        onClick={() => window.open(`${window.location.origin}?mode=${qrMode === 'camera' ? 'remote' : 'audience'}&room=SLTN-1234`, '_blank')}
                        className={`flex-1 px-3 py-2 rounded text-xs font-bold transition-colors flex items-center justify-center gap-1 ${
                          qrMode === 'camera' 
                            ? 'bg-gradient-to-r from-accent-cyan to-blue-500 text-white' 
                            : 'bg-gradient-to-r from-orange-400 to-orange-600 text-white'
                        }`}
                      >
                        <Smartphone size={12} /> Launch App
                      </button>
                    </div>
                  </div>
                </div>

                <div className="flex flex-col">
                  <h3 className="text-xs font-bold uppercase tracking-wider text-orange-500 mb-4">Option 2: Manual Code</h3>
                  <p className="text-sm text-gray-300 mb-4">If the QR code fails to open the {qrMode === 'camera' ? 'camera' : 'portal'}:</p>
                  
                  <ol className="text-xs text-gray-400 space-y-2 mb-6 list-decimal list-inside">
                    <li>Open this app on your phone manually.</li>
                    <li>Tap <strong>"{qrMode === 'camera' ? 'Use Phone as Camera' : 'Join Audience'}"</strong> on the home screen.</li>
                    <li>Enter the code below:</li>
                  </ol>

                  <div className="bg-black/40 border border-border rounded-xl p-6 text-center mb-6">
                    <span className="text-[10px] font-bold uppercase tracking-widest text-gray-500 block mb-2">Connection Code</span>
                    <span className="text-3xl font-mono font-bold tracking-[0.2em] text-white">e 3 j p</span>
                  </div>

                  {qrMode === 'camera' && (
                    <button 
                      className="mt-auto w-full py-3 bg-accent-cyan/20 hover:bg-accent-cyan/30 text-accent-cyan font-bold rounded-lg transition-colors border border-accent-cyan/50"
                      onClick={() => {
                        // Simulate connecting a phone
                        if (phoneSlots.length < 4) {
                          setPhoneSlots(prev => [...prev, `phone-${Date.now()}`]);
                          addLog(`Remote phone connected to slot ${phoneSlots.length + 1}`, 'success');
                          setShowQrModal(false);
                        }
                      }}
                    >
                      Simulate Connection
                    </button>
                  )}
                  {qrMode === 'audience' && (
                    <button 
                      className="mt-auto w-full py-3 bg-orange-500/20 hover:bg-orange-500/30 text-orange-500 font-bold rounded-lg transition-colors border border-orange-500/50"
                      onClick={() => {
                        window.open(`${window.location.origin}?mode=audience&room=SLTN-1234`, '_blank');
                      }}
                    >
                      Open Audience Portal
                    </button>
                  )}
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Save Preset Modal */}
      <AnimatePresence>
        {showSavePresetModal && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm"
            onClick={() => setShowSavePresetModal(false)}
          >
            <motion.div 
              initial={{ scale: 0.9, y: 20 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.9, y: 20 }}
              className="bg-gray-900 border border-border rounded-xl p-6 max-w-sm w-full shadow-2xl relative"
              onClick={e => e.stopPropagation()}
            >
              <h2 className="text-lg font-bold text-white mb-4">Save Scene Preset</h2>
              <input
                type="text"
                value={presetNameInput}
                onChange={e => setPresetNameInput(e.target.value)}
                placeholder="Enter preset name..."
                className="w-full bg-black/50 border border-white/10 rounded px-3 py-2 text-sm text-white focus:outline-none focus:border-accent-cyan mb-4"
                autoFocus
                onKeyDown={e => {
                  if (e.key === 'Enter') confirmSavePreset();
                }}
              />
              <div className="flex justify-end gap-2">
                <button 
                  onClick={() => setShowSavePresetModal(false)}
                  className="px-4 py-2 rounded text-xs font-bold text-gray-400 hover:bg-white/5 transition-colors"
                >
                  Cancel
                </button>
                <button 
                  onClick={confirmSavePreset}
                  className="px-4 py-2 rounded text-xs font-bold bg-accent-cyan text-black hover:bg-accent-cyan/90 transition-colors"
                >
                  Save Preset
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Status Bar */}
      <div className="h-6 bg-bg border-t border-border flex items-center px-3 justify-between text-[10px] text-gray-500 font-medium">
        <div className="flex items-center gap-4">
          <span className="flex items-center gap-1.5">
            <div className="w-1.5 h-1.5 rounded-full bg-accent-green" />
            System: Nominal
          </span>
          <span>Buffer: 0.2s</span>
        </div>
        <div className="flex items-center gap-4">
          <span>{new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })}</span>
          <span className="text-gray-600">v1.0.4-stable</span>
        </div>
      </div>
    </div>
  );
}
