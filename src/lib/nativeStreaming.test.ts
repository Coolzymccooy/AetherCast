import { describe, expect, it } from 'vitest';
import {
  filterBrowserFedNativeSceneSources,
  parseOutputProgressLine,
  resolveNativeCaptureProfile,
  shouldPreferNativeSourceFrame,
} from './nativeStreaming';

describe('resolveNativeCaptureProfile', () => {
  it('uses Windows native-scene RTMP reliability mapping for GPU profiles', () => {
    const profile = resolveNativeCaptureProfile('1080p30', true, {
      mode: 'native-scene',
      platform: 'Windows 11',
      destinations: [{ enabled: true, protocol: 'rtmp', rtmpUrl: 'rtmp://example.test/live', url: '' }],
    });

    expect(profile).toMatchObject({
      width: 960,
      height: 540,
      fps: 30,
      bitrate: 3000,
      reliabilityMode: true,
    });
  });

  it('keeps the existing raw-mode profile outside reliability mode', () => {
    const profile = resolveNativeCaptureProfile('1080p30', true, {
      mode: 'raw',
      platform: 'Windows 11',
      destinations: [{ enabled: true, protocol: 'rtmp', rtmpUrl: 'rtmp://example.test/live', url: '' }],
    });

    expect(profile).toMatchObject({
      width: 1280,
      height: 720,
      fps: 30,
      bitrate: 6000,
      reliabilityMode: false,
    });
  });
});

describe('filterBrowserFedNativeSceneSources', () => {
  it('removes only overlapping native local cameras', () => {
    const filtered = filterBrowserFedNativeSceneSources(
      [
        { sourceId: 'camera:local-1', label: 'Local cam' },
        { sourceId: 'screen:main', label: 'Screen share' },
        { sourceId: 'remote:guest-1', label: 'Guest' },
      ],
      ['camera:local-1', 'camera:local-2'],
    );

    expect(filtered).toEqual([
      { sourceId: 'screen:main', label: 'Screen share' },
      { sourceId: 'remote:guest-1', label: 'Guest' },
    ]);
  });
});

describe('parseOutputProgressLine', () => {
  it('extracts fps, bitrate, and speed from ffmpeg progress output', () => {
    const progress = parseOutputProgressLine(
      'frame= 2720 fps= 17 q=-0.0 size=   51474KiB time=00:01:30.66 bitrate=4650.8kbits/s speed=0.565x elapsed=0:02:40.49',
    );

    expect(progress).toEqual({
      measuredFps: 17,
      bitrateKbps: 4650.8,
      bitrateMbps: 4.6508,
      encoderSpeed: 0.565,
    });
  });
});

describe('shouldPreferNativeSourceFrame', () => {
  it('prefers native frames only when the native source is active and clean', () => {
    expect(shouldPreferNativeSourceFrame(
      'camera:local-1',
      ['camera:local-1'],
      [{ source_id: 'camera:local-1', state: 'active', last_error: null }],
    )).toBe(true);
  });

  it('falls back to browser-fed frames when the native source still has an error', () => {
    expect(shouldPreferNativeSourceFrame(
      'camera:local-1',
      ['camera:local-1'],
      [{ source_id: 'camera:local-1', state: 'active', last_error: 'Device busy' }],
    )).toBe(false);
  });

  it('falls back to browser-fed frames when the source is not native-owned', () => {
    expect(shouldPreferNativeSourceFrame(
      'remote:guest-1',
      ['camera:local-1'],
      [{ source_id: 'remote:guest-1', state: 'active', last_error: null }],
    )).toBe(false);
  });
});
