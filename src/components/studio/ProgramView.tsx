import React, { useImperativeHandle, useRef } from 'react';
import { Maximize2, ExternalLink, Radio, Play, Square, Network } from 'lucide-react';
import { motion } from 'motion/react';
import { Scene, Source, CamoSettings, AudienceMessage, LowerThirds, Graphics } from '../../types';
import { Compositor, type CompositorHandle, type NativeCaptureSource } from '../Compositor';

interface ProgramViewProps {
  activeScene: Scene;
  sources: Source[];
  isStreaming: boolean;
  isRecording: boolean;
  streamSummary?: string;
  ndiSummary?: string;
  isNdiActive?: boolean;
  onToggleStreaming: () => void;
  onToggleNdi?: () => void;
  onToggleRecording: () => void;
  webcamStream: MediaStream | null;
  remoteStreams: Map<string, MediaStream>;
  screenStream: MediaStream | null;
  transitionType: string;
  layout: string;
  lowerThirds: LowerThirds;
  graphics: Graphics;
  backgroundImage: string | null;
  theme: string;
  background: string;
  frameStyle: string;
  motionStyle: string;
  brandColor: string;
  camoSettings: CamoSettings;
  sourceSwap: boolean;
  audienceMessages: AudienceMessage[];
  activeMessageId: string | null;
  extraCaptureSources?: NativeCaptureSource[];
}

export interface ProgramViewHandle {
  getNativeCaptureSurface: () => {
    canvas: HTMLCanvasElement | null;
    captureSources: () => NativeCaptureSource[];
  };
}

export const ProgramView = React.forwardRef<ProgramViewHandle, ProgramViewProps>(({
  activeScene, sources, isStreaming, isRecording,
  streamSummary, ndiSummary, isNdiActive = false,
  onToggleStreaming, onToggleNdi, onToggleRecording,
  webcamStream, remoteStreams, screenStream,
  transitionType, layout, lowerThirds, graphics,
  backgroundImage, theme, background, frameStyle, motionStyle,
  brandColor, camoSettings, sourceSwap, audienceMessages, activeMessageId,
  extraCaptureSources = [],
}, ref) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const compositorRef = useRef<CompositorHandle>(null);

  useImperativeHandle(ref, () => ({
    getNativeCaptureSurface: () => ({
      canvas: compositorRef.current?.getCanvas() || null,
      captureSources: () => compositorRef.current?.captureNativeSceneSources() || [],
    }),
  }), []);

  const toggleFullscreen = () => {
    if (!containerRef.current) return;
    if (document.fullscreenElement) {
      document.exitFullscreen();
    } else {
      containerRef.current.requestFullscreen();
    }
  };

  // Fix: use origin only, not full href (avoids propagating ?mode=remote etc.)
  const openPopout = () => {
    window.open(`${window.location.origin}`, 'AetherPopout', 'width=1280,height=720');
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
          {isStreaming ? (streamSummary || 'LIVE') : 'IDLE'}
        </div>
      </div>

      <div className="flex-1 flex items-center justify-center p-4">
        <div className="aspect-video w-full max-w-5xl bg-gray-900 shadow-2xl border border-white/5 relative overflow-hidden flex items-center justify-center">
          <Compositor
            ref={compositorRef}
            activeScene={activeScene}
            sources={sources}
            isStreaming={isStreaming}
            webcamStream={webcamStream}
            remoteStreams={remoteStreams}
            screenStream={screenStream}
            transitionType={transitionType}
            layout={layout}
            lowerThirds={{ show: lowerThirds.visible, name: lowerThirds.name, title: lowerThirds.title, accentColor: lowerThirds.accentColor }}
            graphics={{ showBug: graphics.showBug, showSocials: graphics.showSocials }}
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
            extraCaptureSources={extraCaptureSources}
          />
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
          {onToggleNdi && (
            <button
              onClick={onToggleNdi}
              title={ndiSummary || 'NDI 5 output'}
              className={`btn-hardware flex items-center gap-2 transition-colors ${isNdiActive ? 'text-accent-green border-accent-green/30 bg-accent-green/10' : 'text-gray-400'}`}
            >
              <Network size={12} />
              {isNdiActive ? 'Stop NDI' : 'Start NDI'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
});

ProgramView.displayName = 'ProgramView';
