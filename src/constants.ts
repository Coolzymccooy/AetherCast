import { Scene, Source, AudioChannel, Script } from './types';

export const SCENES: Scene[] = [
  { id: '1', name: 'Cam 1', type: 'CAM' },
  { id: '2', name: 'Cam 2', type: 'CAM' },
  { id: '3', name: 'Screen', type: 'SCREEN' },
  { id: '4', name: 'Dual View', type: 'DUAL' },
  { id: '5', name: 'Grid', type: 'GRID' },
  { id: '6', name: 'Podcast', type: 'PODCAST' },
];

export const SOURCES: Source[] = [
  { id: '1', name: 'Cam 1', status: 'active', resolution: '1080p', fps: 60, audioLevel: 0.65 },
  { id: '2', name: 'Cam 2', status: 'standby', resolution: '1080p', fps: 60, audioLevel: 0.12 },
  { id: '3', name: 'Screen Share', status: 'standby', resolution: '4K', fps: 30, audioLevel: 0.0 },
  { id: '4', name: 'Media Loop', status: 'offline', resolution: '1080p', fps: 24, audioLevel: 0.0 },
  { id: '5', name: 'Browser Source', status: 'active', resolution: '1080p', fps: 60, audioLevel: 0.45 },
];

export const AUDIO_CHANNELS: AudioChannel[] = [
  { name: 'Mic 1', level: 0, volume: 0.6, peak: 0, muted: false },
  { name: 'Mic 2', level: 0, volume: 0.2, peak: 0, muted: true },
  { name: 'System', level: 0, volume: 0.4, peak: 0, muted: false },
  { name: 'Media', level: 0, volume: 0.0, peak: 0, muted: false },
];

export const SAMPLE_SCRIPT: Script = {
  id: 'script-1',
  name: 'Podcast Intro',
  steps: [
    { id: 's1', sceneId: '1', duration: 5, label: 'Intro: Host' },
    { id: 's2', sceneId: '4', duration: 10, label: 'Dual: Discussion' },
    { id: 's3', sceneId: '2', duration: 5, label: 'Guest: Reaction' },
    { id: 's4', sceneId: '5', duration: 8, label: 'Grid: Group Chat' },
    { id: 's5', sceneId: '3', duration: 12, label: 'Screen: Demo' },
    { id: 's6', sceneId: '1', duration: 5, label: 'Outro: Host' },
  ],
};

export const DEFAULT_CAMO_SETTINGS = {
  layout: 'Fill' as const,
  contentFit: 'Fit' as const,
  scale: 1.0,
  x: 0,
  y: 0,
  shape: 'Rect' as const,
  cornerRadius: 0,
  crop: { left: 0, right: 0, top: 0, bottom: 0 },
  filter: 'None' as const,
  removeBackground: false,
};

/** Room ID — reads from URL ?room= parameter, falls back to 'default-room' */
export function getRoomId(): string {
  if (typeof window !== 'undefined') {
    const params = new URLSearchParams(window.location.search);
    const room = params.get('room');
    if (room && /^[\w-]+$/.test(room) && room.length <= 64) {
      return room;
    }
  }
  return 'default-room';
}

/** @deprecated Use getRoomId() instead — retained for backward compatibility */
export const ROOM_ID = getRoomId();

/** Public cloud URL — used by Tauri desktop to bridge audience messages from remote phones */
export const CLOUD_URL = 'https://aethercast.tiwaton.co.uk';
