import { describe, it, expect } from 'vitest';
import { sanitizeText, isValidRoomId, isValidRtmpUrl, isValidMessageType } from './sanitize';

describe('sanitizeText', () => {
  it('should escape HTML entities', () => {
    expect(sanitizeText('<script>alert("xss")</script>')).toBe(
      '&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;'
    );
  });

  it('should escape ampersands', () => {
    expect(sanitizeText('hello & world')).toBe('hello &amp; world');
  });

  it('should escape single quotes', () => {
    expect(sanitizeText("it's")).toBe('it&#x27;s');
  });

  it('should truncate to maxLength', () => {
    const long = 'a'.repeat(1000);
    expect(sanitizeText(long, 10)).toHaveLength(10);
  });

  it('should return empty string for non-string input', () => {
    expect(sanitizeText(123 as any)).toBe('');
    expect(sanitizeText(null as any)).toBe('');
    expect(sanitizeText(undefined as any)).toBe('');
  });

  it('should pass through normal text unchanged', () => {
    expect(sanitizeText('Hello World')).toBe('Hello World');
  });
});

describe('isValidRoomId', () => {
  it('should accept valid room IDs', () => {
    expect(isValidRoomId('default-room')).toBe(true);
    expect(isValidRoomId('room_123')).toBe(true);
    expect(isValidRoomId('abc')).toBe(true);
  });

  it('should reject invalid room IDs', () => {
    expect(isValidRoomId('')).toBe(false);
    expect(isValidRoomId('a'.repeat(65))).toBe(false);
    expect(isValidRoomId('room with spaces')).toBe(false);
    expect(isValidRoomId('room<script>')).toBe(false);
    expect(isValidRoomId(123)).toBe(false);
    expect(isValidRoomId(null)).toBe(false);
  });
});

describe('isValidRtmpUrl', () => {
  it('should accept valid RTMP URLs', () => {
    expect(isValidRtmpUrl('rtmp://a.rtmp.youtube.com/live')).toBe(true);
    expect(isValidRtmpUrl('rtmps://a.rtmp.youtube.com:443/live2')).toBe(true);
  });

  it('should reject non-RTMP URLs', () => {
    expect(isValidRtmpUrl('http://example.com')).toBe(false);
    expect(isValidRtmpUrl('ftp://example.com')).toBe(false);
    expect(isValidRtmpUrl('')).toBe(false);
    expect(isValidRtmpUrl(123)).toBe(false);
  });
});

describe('isValidMessageType', () => {
  it('should accept valid types', () => {
    expect(isValidMessageType('Q&A')).toBe(true);
    expect(isValidMessageType('Prayer')).toBe(true);
    expect(isValidMessageType('Testimony')).toBe(true);
    expect(isValidMessageType('Welcome')).toBe(true);
    expect(isValidMessageType('Poll')).toBe(true);
  });

  it('should reject invalid types', () => {
    expect(isValidMessageType('Invalid')).toBe(false);
    expect(isValidMessageType('')).toBe(false);
    expect(isValidMessageType(123)).toBe(false);
    expect(isValidMessageType(null)).toBe(false);
  });
});
