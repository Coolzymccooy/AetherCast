import { isValidRoomId as isValidNormalizedRoomId } from '../utils/roomId';

/** Sanitize user-supplied strings to prevent XSS injection */
export function sanitizeText(input: string, maxLength = 500): string {
  if (typeof input !== 'string') return '';
  return input
    .slice(0, maxLength)
    .replace(/[<>&"']/g, (c) => {
      const entities: Record<string, string> = { '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&#x27;' };
      return entities[c] || c;
    });
}

/** Validate a room ID: alphanumeric + hyphens/underscores, max 64 chars */
export function isValidRoomId(roomId: unknown): roomId is string {
  return isValidNormalizedRoomId(roomId);
}

/** Validate RTMP URL format */
export function isValidRtmpUrl(url: unknown): url is string {
  return typeof url === 'string' && /^rtmps?:\/\//.test(url);
}

/** Allowed audience message types */
export const AUDIENCE_MESSAGE_TYPES = ['Q&A', 'Prayer', 'Testimony', 'Welcome', 'Poll'] as const;

export function isValidMessageType(type: unknown): type is typeof AUDIENCE_MESSAGE_TYPES[number] {
  return typeof type === 'string' && (AUDIENCE_MESSAGE_TYPES as readonly string[]).includes(type);
}
