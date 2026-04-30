import type { EncodingProfile, StreamDestination } from '../types';

export type NativeFrameMode = 'raw' | 'native-scene';

export type NativeCaptureProfile = {
  width: number;
  height: number;
  fps: number;
  bitrate: number;
  reliabilityMode: boolean;
  note?: string;
};

type ProfileOverrideOptions = {
  width?: number;
  height?: number;
  fps?: number;
  bitrate?: number;
};

type ResolveNativeCaptureProfileOptions = {
  mode?: NativeFrameMode;
  destinations?: Array<Pick<StreamDestination, 'enabled' | 'protocol' | 'rtmpUrl' | 'url'>>;
  platform?: string;
  overrides?: ProfileOverrideOptions;
};

export type OutputProgressSnapshot = {
  measuredFps?: number;
  bitrateKbps?: number;
  bitrateMbps?: number;
  encoderSpeed?: number;
};

export type NativeSourceHealthSnapshot = {
  source_id: string;
  state?: string | null;
  last_error?: string | null;
};

function inferProtocol(destination: Pick<StreamDestination, 'protocol' | 'rtmpUrl' | 'url'>): string {
  const explicit = destination.protocol?.trim().toLowerCase();
  if (explicit) {
    return explicit;
  }

  const url = (destination.rtmpUrl || destination.url || '').trim().toLowerCase();
  if (url.startsWith('srt://')) return 'srt';
  if (url.startsWith('rist://')) return 'rist';
  return 'rtmp';
}

function resolvePlatformHint(platform?: string): string {
  if (platform) {
    return platform;
  }

  if (typeof navigator === 'undefined') {
    return 'unknown';
  }

  return `${navigator.userAgent} ${navigator.platform}`;
}

function isWindowsPlatform(platform?: string): boolean {
  return /windows/i.test(resolvePlatformHint(platform));
}

function hasEnabledRtmpDestination(
  destinations: ResolveNativeCaptureProfileOptions['destinations'],
): boolean {
  return (destinations || []).some((destination) => {
    if (destination.enabled === false) {
      return false;
    }

    return inferProtocol(destination) === 'rtmp';
  });
}

export function resolveNativeCaptureProfile(
  encodingProfile: EncodingProfile | undefined,
  isGPU: boolean,
  options: ResolveNativeCaptureProfileOptions = {},
): NativeCaptureProfile {
  const profile = encodingProfile || '1080p30';
  const { overrides } = options;

  let base: NativeCaptureProfile;
  switch (profile) {
    case '1080p60':
    case '1080p30':
      base = isGPU
        ? { width: 1280, height: 720, fps: 30, bitrate: 6000, reliabilityMode: false }
        : { width: 960, height: 540, fps: 30, bitrate: 3500, reliabilityMode: false };
      break;
    case '720p30':
      base = isGPU
        ? { width: 1280, height: 720, fps: 30, bitrate: 4500, reliabilityMode: false }
        : { width: 960, height: 540, fps: 30, bitrate: 3000, reliabilityMode: false };
      break;
    case '480p30':
    default:
      base = { width: 854, height: 480, fps: 30, bitrate: 2000, reliabilityMode: false };
      break;
  }

  const shouldUseWindowsReliabilityMode =
    isGPU
    && options.mode === 'native-scene'
    && isWindowsPlatform(options.platform)
    && hasEnabledRtmpDestination(options.destinations);

  if (shouldUseWindowsReliabilityMode) {
    switch (profile) {
      case '1080p60':
      case '1080p30':
        base = {
          width: 960,
          height: 540,
          fps: 30,
          bitrate: 3000,
          reliabilityMode: true,
          note: 'Windows native live reliability mode',
        };
        break;
      case '720p30':
        base = {
          width: 854,
          height: 480,
          fps: 30,
          bitrate: 2000,
          reliabilityMode: true,
          note: 'Windows native live reliability mode',
        };
        break;
      case '480p30':
      default:
        base = {
          width: 854,
          height: 480,
          fps: 30,
          bitrate: 1500,
          reliabilityMode: true,
          note: 'Windows native live reliability mode',
        };
        break;
    }
  }

  return {
    width: overrides?.width || base.width,
    height: overrides?.height || base.height,
    fps: overrides?.fps || base.fps,
    bitrate: overrides?.bitrate || base.bitrate,
    reliabilityMode: base.reliabilityMode,
    note: base.note,
  };
}

function parseProgressNumber(line: string, key: string): number | undefined {
  const index = line.toLowerCase().lastIndexOf(key.toLowerCase());
  if (index < 0) {
    return undefined;
  }

  let cursor = index + key.length;
  while (cursor < line.length && /\s/.test(line[cursor])) {
    cursor += 1;
  }

  let value = '';
  while (cursor < line.length && /[0-9.]/.test(line[cursor])) {
    value += line[cursor];
    cursor += 1;
  }

  if (!value) {
    return undefined;
  }

  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export function parseOutputProgressLine(line: string): OutputProgressSnapshot {
  const measuredFps = parseProgressNumber(line, 'fps=');
  const bitrateKbps = parseProgressNumber(line, 'bitrate=');
  const encoderSpeed = parseProgressNumber(line, 'speed=');

  return {
    measuredFps,
    bitrateKbps,
    bitrateMbps: bitrateKbps !== undefined ? bitrateKbps / 1000 : undefined,
    encoderSpeed,
  };
}

export function filterBrowserFedNativeSceneSources<T extends { sourceId: string }>(
  sources: T[],
  nativeVideoSourceIds: Iterable<string>,
): T[] {
  const nativeIds = new Set(nativeVideoSourceIds);
  return sources.filter((source) => !nativeIds.has(source.sourceId));
}

export function shouldPreferNativeSourceFrame(
  sourceId: string,
  nativeVideoSourceIds: Iterable<string>,
  sourceStatuses: NativeSourceHealthSnapshot[],
): boolean {
  const nativeIds = new Set(nativeVideoSourceIds);
  if (!nativeIds.has(sourceId)) {
    return false;
  }

  const nativeSourceStatus = sourceStatuses.find((source) => source.source_id === sourceId);
  return nativeSourceStatus?.state === 'active' && !nativeSourceStatus?.last_error;
}
