import { useEffect, useRef, useCallback, useState } from 'react';
import { CompositorWorkerBridge, WorkerSceneConfig, WorkerOverlays } from '../lib/compositorWorker';

interface UseCompositorWorkerOptions {
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
  fps?: number;
  // Source video elements
  webcamVideo?: HTMLVideoElement | null;
  screenVideo?: HTMLVideoElement | null;
  remoteVideos?: Map<string, HTMLVideoElement>;
  // Scene config
  sceneType: string;
  sceneName: string;
  layout: string;
  frameStyle: string;
  motionStyle: string;
  transition: string;
  sourceSwap: boolean;
  isStreaming: boolean;
  // Background
  background: string;
  brandColor: string;
  // Overlays
  showBug: boolean;
  showSocials: boolean;
  lowerThirds: { show: boolean; name: string; title: string; accentColor: string };
}

/**
 * Hook that manages the OffscreenCanvas compositor worker.
 * When OffscreenCanvas is available, rendering happens entirely off the main thread.
 * Falls back to the existing Canvas 2D compositor when not supported.
 */
export function useCompositorWorker({
  canvasRef,
  fps = 30,
  webcamVideo,
  screenVideo,
  remoteVideos,
  sceneType,
  sceneName,
  layout,
  frameStyle,
  motionStyle,
  transition,
  sourceSwap,
  isStreaming,
  background,
  brandColor,
  showBug,
  showSocials,
  lowerThirds,
}: UseCompositorWorkerOptions) {
  const bridgeRef = useRef<CompositorWorkerBridge | null>(null);
  const [renderStats, setRenderStats] = useState({ frameCount: 0, renderTimeMs: 0 });
  const [isWorkerMode, setIsWorkerMode] = useState(false);

  // Initialize worker on mount
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const bridge = new CompositorWorkerBridge(canvas, fps, (frameCount, renderTimeMs) => {
      setRenderStats({ frameCount, renderTimeMs });
    });

    if (!bridge.isFallback()) {
      bridgeRef.current = bridge;
      setIsWorkerMode(true);
    }

    return () => {
      bridge.destroy();
      bridgeRef.current = null;
      setIsWorkerMode(false);
    };
  }, [canvasRef.current, fps]);

  // Register/unregister video sources
  useEffect(() => {
    const bridge = bridgeRef.current;
    if (!bridge) return;

    if (webcamVideo) bridge.registerSource('cam1', webcamVideo);
    if (screenVideo) bridge.registerSource('screen', screenVideo);
    remoteVideos?.forEach((video, id) => {
      bridge.registerSource(id, video);
    });

    return () => {
      bridge.unregisterSource('cam1');
      bridge.unregisterSource('screen');
      remoteVideos?.forEach((_, id) => bridge.unregisterSource(id));
    };
  }, [webcamVideo, screenVideo, remoteVideos]);

  // Update scene config
  useEffect(() => {
    bridgeRef.current?.setScene({
      sceneType: sceneType as WorkerSceneConfig['sceneType'],
      sceneName,
      layout,
      frameStyle,
      motionStyle,
      transition,
      transitionProgress: 1,
      sourceSwap,
      isStreaming,
    });
  }, [sceneType, sceneName, layout, frameStyle, motionStyle, transition, sourceSwap, isStreaming]);

  // Update background
  useEffect(() => {
    bridgeRef.current?.setBackground(background, brandColor);
  }, [background, brandColor]);

  // Update overlays
  useEffect(() => {
    bridgeRef.current?.setOverlays({ showBug, showSocials, lowerThirds });
  }, [showBug, showSocials, lowerThirds]);

  return {
    isWorkerMode,
    renderStats,
  };
}
