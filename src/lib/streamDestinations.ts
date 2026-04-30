import type { StreamDestination } from '../types';

const TWITCH_LEGACY_URL_RE = /^(rtmps?):\/\/live\.twitch\.tv(?::(\d+))?\/(?:live|app)$/i;
const TWITCH_INGEST_HOST = 'ingest.global-contribute.live-video.net';

export function normalizeDestinationUrl(rawUrl: string): string {
  const trimmed = rawUrl.trim().replace(/\/+$/, '');
  const twitchMatch = trimmed.match(TWITCH_LEGACY_URL_RE);
  if (twitchMatch) {
    const [, scheme, port] = twitchMatch;
    const portSuffix = port ? `:${port}` : '';
    return `${scheme}://${TWITCH_INGEST_HOST}${portSuffix}/app`;
  }
  return trimmed;
}

export function normalizeStreamKey(rawKey: string): string {
  return rawKey.trim().replace(/^key=/i, '');
}

export function normalizeStreamDestination(destination: StreamDestination): StreamDestination {
  const normalizedUrl = normalizeDestinationUrl(destination.url || destination.rtmpUrl || '');
  return {
    ...destination,
    rtmpUrl: normalizedUrl,
    ...(destination.url !== undefined ? { url: normalizedUrl } : {}),
    streamKey: normalizeStreamKey(destination.streamKey || ''),
  };
}

export function normalizeStreamDestinations(
  destinations: StreamDestination[],
): StreamDestination[] {
  return destinations.map(normalizeStreamDestination);
}
