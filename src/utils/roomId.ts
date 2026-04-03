export const DEFAULT_ROOM_ID = 'SLTN-1234';

export function normalizeRoomId(roomId: string): string {
  return roomId.trim().toUpperCase();
}

export function isValidRoomId(roomId: unknown): roomId is string {
  return typeof roomId === 'string' && roomId.length > 0 && roomId.length <= 64 && /^[\w-]+$/.test(roomId);
}

export function resolveRoomId(roomId: string | null | undefined, fallback = DEFAULT_ROOM_ID): string {
  const normalized = typeof roomId === 'string' ? normalizeRoomId(roomId) : '';
  return isValidRoomId(normalized) ? normalized : fallback;
}

export function getRoomIdFromSearch(search?: string): string {
  if (typeof search === 'string') {
    const params = new URLSearchParams(search);
    return resolveRoomId(params.get('room'));
  }

  if (typeof window !== 'undefined') {
    return getRoomIdFromSearch(window.location.search);
  }

  return DEFAULT_ROOM_ID;
}

export function peerRoomKey(roomId: string): string {
  return resolveRoomId(roomId).replace(/[^A-Z0-9]/g, '').toLowerCase();
}
