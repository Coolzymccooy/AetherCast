import { useCallback, useEffect, useRef } from 'react';
import type { NativeSceneCaptureSource } from './useNativeEngine';

type UseNativeSourceFeedsArgs = {
  webcamStream: MediaStream | null;
  screenStream: MediaStream | null;
  remoteStreams: Map<string, MediaStream>;
  mediaElement: HTMLVideoElement | null;
  browserElement: HTMLVideoElement | HTMLImageElement | HTMLCanvasElement | null;
};

function ensureVideoElement(
  elementMap: Map<string, HTMLVideoElement>,
  sourceId: string,
): HTMLVideoElement {
  const existing = elementMap.get(sourceId);
  if (existing) {
    return existing;
  }

  const video = document.createElement('video');
  video.muted = true;
  video.autoplay = true;
  video.playsInline = true;
  video.preload = 'auto';
  video.style.position = 'fixed';
  video.style.left = '-10000px';
  video.style.top = '-10000px';
  video.style.width = '1px';
  video.style.height = '1px';
  video.style.opacity = '0';
  video.style.pointerEvents = 'none';
  document.body.appendChild(video);
  elementMap.set(sourceId, video);
  return video;
}

function attachStream(video: HTMLVideoElement, stream: MediaStream) {
  if (video.srcObject !== stream) {
    video.srcObject = stream;
  }

  const playback = video.play();
  if (playback && typeof playback.catch === 'function') {
    playback.catch(() => {
      // Ignore autoplay failures. The element still carries the stream for capture.
    });
  }
}

function detachAndDisposeVideo(video: HTMLVideoElement) {
  try {
    video.pause();
  } catch {
    // Ignore pause failures during cleanup.
  }
  video.srcObject = null;
  video.remove();
}

export function useNativeSourceFeeds({
  webcamStream,
  screenStream,
  remoteStreams,
  mediaElement,
  browserElement,
}: UseNativeSourceFeedsArgs) {
  const videoElementsRef = useRef<Map<string, HTMLVideoElement>>(new Map());
  const mediaElementRef = useRef<HTMLVideoElement | null>(mediaElement);
  const browserElementRef = useRef<HTMLVideoElement | HTMLImageElement | HTMLCanvasElement | null>(browserElement);

  useEffect(() => {
    mediaElementRef.current = mediaElement;
  }, [mediaElement]);

  useEffect(() => {
    browserElementRef.current = browserElement;
  }, [browserElement]);

  useEffect(() => {
    const desiredStreams = new Map<string, MediaStream>();

    if (webcamStream) {
      desiredStreams.set('camera:local-1', webcamStream);
    }

    const localCam2 = remoteStreams.get('local-cam-2');
    if (localCam2) {
      desiredStreams.set('camera:local-2', localCam2);
    }

    if (screenStream) {
      desiredStreams.set('screen:main', screenStream);
    }

    const remoteEntries = Array.from(remoteStreams.entries())
      .filter(([id]) => !id.startsWith('local-cam-'));

    remoteEntries.forEach(([_, stream], index) => {
      desiredStreams.set(`remote:${index + 1}`, stream);
    });

    desiredStreams.forEach((stream, sourceId) => {
      const video = ensureVideoElement(videoElementsRef.current, sourceId);
      attachStream(video, stream);
    });

    Array.from(videoElementsRef.current.entries()).forEach(([sourceId, video]) => {
      if (desiredStreams.has(sourceId)) {
        return;
      }

      detachAndDisposeVideo(video);
      videoElementsRef.current.delete(sourceId);
    });
  }, [webcamStream, screenStream, remoteStreams]);

  useEffect(() => {
    return () => {
      Array.from(videoElementsRef.current.values()).forEach(detachAndDisposeVideo);
      videoElementsRef.current.clear();
    };
  }, []);

  const getCaptureSources = useCallback((): NativeSceneCaptureSource[] => {
    const sources: NativeSceneCaptureSource[] = Array.from(videoElementsRef.current.entries()).map(([sourceId, element]) => ({
      sourceId,
      element,
    }));

    const media = mediaElementRef.current;
    if (media) {
      sources.push({
        sourceId: 'media:loop',
        element: media,
      });
    }

    const browser = browserElementRef.current;
    if (browser) {
      sources.push({
        sourceId: 'browser:main',
        element: browser,
      });
    }

    return sources;
  }, []);

  return {
    getCaptureSources,
  };
}
