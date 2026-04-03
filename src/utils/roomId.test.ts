import { describe, expect, it } from 'vitest';
import { DEFAULT_ROOM_ID, getRoomIdFromSearch, peerRoomKey, resolveRoomId } from './roomId';

describe('roomId utilities', () => {
  it('normalizes room IDs to the canonical socket form', () => {
    expect(resolveRoomId('sltn-1234')).toBe('SLTN-1234');
    expect(resolveRoomId('  sltn_5678  ')).toBe('SLTN_5678');
  });

  it('falls back to the default room when the input is invalid', () => {
    expect(resolveRoomId('')).toBe(DEFAULT_ROOM_ID);
    expect(resolveRoomId('bad room')).toBe(DEFAULT_ROOM_ID);
    expect(resolveRoomId(null)).toBe(DEFAULT_ROOM_ID);
  });

  it('builds stable peer room keys', () => {
    expect(peerRoomKey('SLTN-1234')).toBe('sltn1234');
    expect(peerRoomKey('sltn_1234')).toBe('sltn1234');
  });

  it('reads and normalizes room IDs from a query string', () => {
    expect(getRoomIdFromSearch('?mode=audience&room=sltn-1234')).toBe('SLTN-1234');
    expect(getRoomIdFromSearch('?mode=audience')).toBe(DEFAULT_ROOM_ID);
  });
});
