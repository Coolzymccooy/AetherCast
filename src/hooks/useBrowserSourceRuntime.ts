import { useEffect, useMemo, useRef, useState } from 'react';

type BrowserSourceKind = 'none' | 'image' | 'video' | 'page';
type BrowserSourceState = 'offline' | 'loading' | 'active' | 'error' | 'unsupported';

function inferBrowserSourceKind(url: string): BrowserSourceKind {
  const normalized = url.trim().toLowerCase();
  if (!normalized) return 'none';
  if (normalized.startsWith('data:image/')) return 'image';
  if (normalized.startsWith('data:video/')) return 'video';
  if (/\.(png|jpg|jpeg|gif|webp|avif|svg)(\?.*)?$/.test(normalized)) return 'image';
  if (/\.(mp4|webm|mov|m4v|ogg|ogv)(\?.*)?$/.test(normalized)) return 'video';
  return 'page';
}

function formatResolution(width: number, height: number): string {
  return width > 0 && height > 0 ? `${width}x${height}` : 'Unknown';
}

function disposeHiddenElement(element: HTMLElement | null) {
  if (!element) return;
  if (element instanceof HTMLVideoElement) {
    try {
      element.pause();
    } catch {
      // Ignore pause failure during teardown.
    }
    element.removeAttribute('src');
    element.srcObject = null;
    element.load();
  } else if (element instanceof HTMLImageElement) {
    element.removeAttribute('src');
  }
  element.remove();
}

type BrowserSourceRuntime = {
  url: string;
  kind: BrowserSourceKind;
  state: BrowserSourceState;
  resolution: string;
  fps: number;
  error: string | null;
  captureElement: HTMLVideoElement | HTMLImageElement | null;
  isCapturable: boolean;
};

export function useBrowserSourceRuntime(url: string) {
  const hiddenElementRef = useRef<HTMLVideoElement | HTMLImageElement | null>(null);
  const [runtime, setRuntime] = useState<BrowserSourceRuntime>({
    url: '',
    kind: 'none',
    state: 'offline',
    resolution: 'Unknown',
    fps: 0,
    error: null,
    captureElement: null,
    isCapturable: false,
  });

  const trimmedUrl = useMemo(() => url.trim(), [url]);

  useEffect(() => {
    const kind = inferBrowserSourceKind(trimmedUrl);
    disposeHiddenElement(hiddenElementRef.current);
    hiddenElementRef.current = null;

    if (!trimmedUrl) {
      setRuntime({
        url: '',
        kind: 'none',
        state: 'offline',
        resolution: 'Unknown',
        fps: 0,
        error: null,
        captureElement: null,
        isCapturable: false,
      });
      return;
    }

    if (kind === 'page') {
      setRuntime({
        url: trimmedUrl,
        kind,
        state: 'unsupported',
        resolution: 'Unknown',
        fps: 0,
        error: 'Page browser sources are not capturable yet. Use a direct image or video URL.',
        captureElement: null,
        isCapturable: false,
      });
      return;
    }

    if (kind === 'image') {
      const image = document.createElement('img');
      image.crossOrigin = 'anonymous';
      image.decoding = 'async';
      image.loading = 'eager';
      image.referrerPolicy = 'no-referrer';
      image.style.position = 'fixed';
      image.style.left = '-10000px';
      image.style.top = '-10000px';
      image.style.width = '1px';
      image.style.height = '1px';
      image.style.opacity = '0';
      image.style.pointerEvents = 'none';
      document.body.appendChild(image);
      hiddenElementRef.current = image;

      setRuntime({
        url: trimmedUrl,
        kind,
        state: 'loading',
        resolution: 'Unknown',
        fps: 0,
        error: null,
        captureElement: null,
        isCapturable: false,
      });

      image.onload = () => {
        setRuntime({
          url: trimmedUrl,
          kind,
          state: 'active',
          resolution: formatResolution(image.naturalWidth, image.naturalHeight),
          fps: 0,
          error: null,
          captureElement: image,
          isCapturable: true,
        });
      };

      image.onerror = () => {
        setRuntime({
          url: trimmedUrl,
          kind,
          state: 'error',
          resolution: 'Unknown',
          fps: 0,
          error: 'Browser image source failed to load.',
          captureElement: null,
          isCapturable: false,
        });
      };

      image.src = trimmedUrl;
      return () => disposeHiddenElement(image);
    }

    const video = document.createElement('video');
    video.crossOrigin = 'anonymous';
    video.muted = true;
    video.autoplay = true;
    video.loop = true;
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
    hiddenElementRef.current = video;

    setRuntime({
      url: trimmedUrl,
      kind,
      state: 'loading',
      resolution: 'Unknown',
      fps: 30,
      error: null,
      captureElement: null,
      isCapturable: false,
    });

    video.onloadedmetadata = () => {
      const playback = video.play();
      if (playback && typeof playback.catch === 'function') {
        playback.catch(() => {
          // Ignore autoplay failures; metadata is still enough for capture attempts.
        });
      }

      setRuntime({
        url: trimmedUrl,
        kind,
        state: 'active',
        resolution: formatResolution(video.videoWidth, video.videoHeight),
        fps: 30,
        error: null,
        captureElement: video,
        isCapturable: true,
      });
    };

    video.onerror = () => {
      setRuntime({
        url: trimmedUrl,
        kind,
        state: 'error',
        resolution: 'Unknown',
        fps: 0,
        error: 'Browser video source failed to load.',
        captureElement: null,
        isCapturable: false,
      });
    };

    video.src = trimmedUrl;
    return () => disposeHiddenElement(video);
  }, [trimmedUrl]);

  useEffect(() => {
    return () => {
      disposeHiddenElement(hiddenElementRef.current);
      hiddenElementRef.current = null;
    };
  }, []);

  return runtime;
}
