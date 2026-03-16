// ─── Media Player Engine ─────────────────────────────────────────────────────
// Playback engine for video, audio, and image files used as broadcast sources.
// Wraps a hidden HTMLVideoElement and exposes playlist management, transport
// controls, and Web Audio output suitable for routing into the audio engine.
// ─────────────────────────────────────────────────────────────────────────────

// ── Types ────────────────────────────────────────────────────────────────────

export interface MediaItem {
  id: string;
  name: string;
  url: string;            // blob URL, file URL, or HTTP URL
  type: 'video' | 'audio' | 'image';
  duration?: number;       // seconds (populated after load)
  thumbnail?: string;
}

export interface PlaybackState {
  currentItem: MediaItem | null;
  isPlaying: boolean;
  currentTime: number;
  duration: number;
  volume: number;
  loop: boolean;
  playlistIndex: number;
}

export type PlaybackEvent =
  | 'play'
  | 'pause'
  | 'ended'
  | 'timeupdate'
  | 'error'
  | 'loaded';

// ── Supported formats ────────────────────────────────────────────────────────

const VIDEO_EXTENSIONS = new Set(['mp4', 'webm', 'mov']);
const AUDIO_EXTENSIONS = new Set(['mp3', 'wav', 'ogg', 'aac']);
const IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp']);

// ── Helpers ──────────────────────────────────────────────────────────────────

function extensionOf(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot === -1 ? '' : name.slice(dot + 1).toLowerCase();
}

function detectMediaType(file: File): 'video' | 'audio' | 'image' {
  const ext = extensionOf(file.name);
  if (VIDEO_EXTENSIONS.has(ext)) return 'video';
  if (AUDIO_EXTENSIONS.has(ext)) return 'audio';
  if (IMAGE_EXTENSIONS.has(ext)) return 'image';

  // Fall back to MIME prefix
  if (file.type.startsWith('video/')) return 'video';
  if (file.type.startsWith('audio/')) return 'audio';
  if (file.type.startsWith('image/')) return 'image';

  return 'video'; // default
}

function generateId(): string {
  return `media-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

// ── EventEmitter (minimal) ──────────────────────────────────────────────────

type EventCallback = (data?: unknown) => void;

class EventEmitter<E extends string> {
  private listeners = new Map<E, Set<EventCallback>>();

  on(event: E, cb: EventCallback): void {
    if (!this.listeners.has(event)) this.listeners.set(event, new Set());
    this.listeners.get(event)!.add(cb);
  }

  off(event: E, cb: EventCallback): void {
    this.listeners.get(event)?.delete(cb);
  }

  protected emit(event: E, data?: unknown): void {
    this.listeners.get(event)?.forEach((cb) => {
      try {
        cb(data);
      } catch {
        // listener errors must not break the player
      }
    });
  }

  protected removeAllListeners(): void {
    this.listeners.clear();
  }
}

// ── MediaPlayer ─────────────────────────────────────────────────────────────

export class MediaPlayer extends EventEmitter<PlaybackEvent> {
  private playlist: MediaItem[] = [];
  private playlistIndex = -1;
  private videoEl: HTMLVideoElement;
  private imageCanvas: HTMLCanvasElement | null = null;
  private imageStream: MediaStream | null = null;
  private volume = 1;
  private loopItem = false;
  private loopPlaylist = false;
  private audioSourceNode: MediaElementAudioSourceNode | null = null;

  // Used for preloading the next item
  private preloadEl: HTMLVideoElement | null = null;

  constructor() {
    super();

    this.videoEl = document.createElement('video');
    this.videoEl.playsInline = true;
    this.videoEl.style.display = 'none';
    document.body.appendChild(this.videoEl);

    this.bindVideoEvents();
  }

  // ── Playlist management ─────────────────────────────────────────────────

  setPlaylist(items: MediaItem[]): void {
    this.stop();
    this.playlist = [...items];
    this.playlistIndex = items.length > 0 ? 0 : -1;
  }

  addItem(item: MediaItem): void {
    this.playlist.push(item);
    if (this.playlistIndex === -1) this.playlistIndex = 0;
  }

  removeItem(id: string): void {
    const idx = this.playlist.findIndex((i) => i.id === id);
    if (idx === -1) return;

    const wasCurrent = idx === this.playlistIndex;
    this.playlist.splice(idx, 1);

    if (wasCurrent) {
      this.stop();
      if (this.playlist.length > 0) {
        this.playlistIndex = Math.min(idx, this.playlist.length - 1);
      } else {
        this.playlistIndex = -1;
      }
    } else if (idx < this.playlistIndex) {
      this.playlistIndex--;
    }
  }

  getPlaylist(): MediaItem[] {
    return [...this.playlist];
  }

  // ── Playback controls ───────────────────────────────────────────────────

  play(): void {
    const item = this.currentItem();
    if (!item) return;

    if (item.type === 'image') {
      this.loadImage(item);
      this.emit('play');
      return;
    }

    if (this.videoEl.src !== item.url) {
      this.loadMediaElement(this.videoEl, item);
    }
    this.videoEl.play().catch((err) => this.emit('error', err));
  }

  pause(): void {
    this.videoEl.pause();
  }

  stop(): void {
    this.videoEl.pause();
    this.videoEl.currentTime = 0;
    this.cleanupImageStream();
    this.emit('pause');
  }

  seek(time: number): void {
    if (!isFinite(time) || time < 0) return;
    this.videoEl.currentTime = Math.min(time, this.videoEl.duration || 0);
  }

  next(): void {
    if (this.playlist.length === 0) return;

    let nextIdx = this.playlistIndex + 1;
    if (nextIdx >= this.playlist.length) {
      if (this.loopPlaylist) {
        nextIdx = 0;
      } else {
        this.emit('ended');
        return;
      }
    }

    this.playlistIndex = nextIdx;
    this.stop();
    this.play();
  }

  previous(): void {
    if (this.playlist.length === 0) return;

    let prevIdx = this.playlistIndex - 1;
    if (prevIdx < 0) {
      prevIdx = this.loopPlaylist ? this.playlist.length - 1 : 0;
    }

    this.playlistIndex = prevIdx;
    this.stop();
    this.play();
  }

  // ── Settings ────────────────────────────────────────────────────────────

  setVolume(volume: number): void {
    this.volume = Math.max(0, Math.min(1, volume));
    this.videoEl.volume = this.volume;
  }

  setLoop(loop: boolean): void {
    this.loopItem = loop;
    this.videoEl.loop = loop;
  }

  setLoopPlaylist(loop: boolean): void {
    this.loopPlaylist = loop;
  }

  // ── Output ──────────────────────────────────────────────────────────────

  getVideoElement(): HTMLVideoElement {
    return this.videoEl;
  }

  getAudioOutput(context: AudioContext): MediaElementAudioSourceNode {
    // A MediaElement can only have one source node per AudioContext. Reuse if
    // already created for this context.
    if (this.audioSourceNode && this.audioSourceNode.context === context) {
      return this.audioSourceNode;
    }
    this.audioSourceNode = context.createMediaElementSource(this.videoEl);
    return this.audioSourceNode;
  }

  // ── State ───────────────────────────────────────────────────────────────

  getState(): PlaybackState {
    return {
      currentItem: this.currentItem(),
      isPlaying: !this.videoEl.paused,
      currentTime: this.videoEl.currentTime,
      duration: this.videoEl.duration || 0,
      volume: this.volume,
      loop: this.loopItem,
      playlistIndex: this.playlistIndex,
    };
  }

  // ── Events (inherited from EventEmitter) ────────────────────────────────

  // on / off are inherited

  // ── Static helpers ──────────────────────────────────────────────────────

  static async fromFile(file: File): Promise<MediaItem> {
    const url = URL.createObjectURL(file);
    const type = detectMediaType(file);

    const item: MediaItem = {
      id: generateId(),
      name: file.name,
      url,
      type,
    };

    // Extract duration & thumbnail
    if (type === 'video') {
      const { duration, thumbnail } = await MediaPlayer.probeVideo(url);
      item.duration = duration;
      item.thumbnail = thumbnail;
    } else if (type === 'audio') {
      item.duration = await MediaPlayer.probeAudio(url);
    } else if (type === 'image') {
      item.thumbnail = url;
    }

    return item;
  }

  // ── Cleanup ─────────────────────────────────────────────────────────────

  destroy(): void {
    this.stop();
    this.removeAllListeners();
    this.cleanupImageStream();
    this.cleanupPreload();

    if (this.audioSourceNode) {
      try {
        this.audioSourceNode.disconnect();
      } catch {
        // already disconnected
      }
      this.audioSourceNode = null;
    }

    this.videoEl.removeAttribute('src');
    this.videoEl.load();
    this.videoEl.remove();
    this.playlist = [];
    this.playlistIndex = -1;
  }

  // ── Private ─────────────────────────────────────────────────────────────

  private currentItem(): MediaItem | null {
    if (this.playlistIndex < 0 || this.playlistIndex >= this.playlist.length) {
      return null;
    }
    return this.playlist[this.playlistIndex];
  }

  private bindVideoEvents(): void {
    this.videoEl.addEventListener('play', () => this.emit('play'));
    this.videoEl.addEventListener('pause', () => this.emit('pause'));
    this.videoEl.addEventListener('timeupdate', () =>
      this.emit('timeupdate', {
        currentTime: this.videoEl.currentTime,
        duration: this.videoEl.duration,
      }),
    );
    this.videoEl.addEventListener('loadedmetadata', () => {
      const item = this.currentItem();
      if (item) {
        item.duration = this.videoEl.duration;
      }
      this.emit('loaded', { duration: this.videoEl.duration });
      this.preloadNext();
    });
    this.videoEl.addEventListener('ended', () => {
      if (this.loopItem) return; // HTMLVideoElement.loop handles repetition
      this.next();
    });
    this.videoEl.addEventListener('error', () =>
      this.emit('error', this.videoEl.error),
    );
  }

  private loadMediaElement(el: HTMLVideoElement, item: MediaItem): void {
    el.src = item.url;
    el.volume = this.volume;
    el.loop = this.loopItem;
    el.load();
  }

  // ── Image handling ──────────────────────────────────────────────────────

  private loadImage(item: MediaItem): void {
    this.cleanupImageStream();

    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth || 1920;
      canvas.height = img.naturalHeight || 1080;

      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

      this.imageCanvas = canvas;
      // captureStream(0) = no automatic frame updates; we only need one frame
      this.imageStream = canvas.captureStream(0);

      // Route the static stream into the video element so the compositor
      // can treat it identically to a video source.
      this.videoEl.srcObject = this.imageStream;
      this.videoEl.play().catch((err) => this.emit('error', err));

      this.emit('loaded', { duration: 0 });
    };
    img.onerror = () => this.emit('error', new Error(`Failed to load image: ${item.name}`));
    img.src = item.url;
  }

  private cleanupImageStream(): void {
    if (this.imageStream) {
      this.imageStream.getTracks().forEach((t) => t.stop());
      this.imageStream = null;
    }
    if (this.imageCanvas) {
      this.imageCanvas = null;
    }
    if (this.videoEl.srcObject) {
      this.videoEl.srcObject = null;
    }
  }

  // ── Preloading ──────────────────────────────────────────────────────────

  private preloadNext(): void {
    this.cleanupPreload();

    const nextIdx = this.playlistIndex + 1;
    const nextItem =
      nextIdx < this.playlist.length
        ? this.playlist[nextIdx]
        : this.loopPlaylist && this.playlist.length > 0
          ? this.playlist[0]
          : null;

    if (!nextItem || nextItem.type === 'image') return;

    this.preloadEl = document.createElement('video');
    this.preloadEl.preload = 'auto';
    this.preloadEl.muted = true;
    this.preloadEl.src = nextItem.url;
    this.preloadEl.load();
  }

  private cleanupPreload(): void {
    if (this.preloadEl) {
      this.preloadEl.removeAttribute('src');
      this.preloadEl.load();
      this.preloadEl = null;
    }
  }

  // ── Probing helpers ─────────────────────────────────────────────────────

  private static probeVideo(
    url: string,
  ): Promise<{ duration: number; thumbnail: string | undefined }> {
    return new Promise((resolve) => {
      const el = document.createElement('video');
      el.preload = 'metadata';
      el.muted = true;
      el.src = url;

      const cleanup = () => {
        el.removeAttribute('src');
        el.load();
      };

      el.addEventListener('loadeddata', () => {
        // Seek to 1 second (or 0 if shorter) to grab a representative frame
        el.currentTime = Math.min(1, el.duration);
      });

      el.addEventListener('seeked', () => {
        let thumbnail: string | undefined;
        try {
          const canvas = document.createElement('canvas');
          canvas.width = el.videoWidth;
          canvas.height = el.videoHeight;
          const ctx = canvas.getContext('2d');
          if (ctx) {
            ctx.drawImage(el, 0, 0);
            thumbnail = canvas.toDataURL('image/jpeg', 0.7);
          }
        } catch {
          // cross-origin or other canvas tainting
        }
        const duration = el.duration;
        cleanup();
        resolve({ duration, thumbnail });
      });

      el.addEventListener('error', () => {
        cleanup();
        resolve({ duration: 0, thumbnail: undefined });
      });

      el.load();
    });
  }

  private static probeAudio(url: string): Promise<number> {
    return new Promise((resolve) => {
      const el = document.createElement('audio');
      el.preload = 'metadata';
      el.src = url;

      el.addEventListener('loadedmetadata', () => {
        const duration = el.duration;
        el.removeAttribute('src');
        el.load();
        resolve(duration);
      });

      el.addEventListener('error', () => {
        el.removeAttribute('src');
        el.load();
        resolve(0);
      });

      el.load();
    });
  }
}
