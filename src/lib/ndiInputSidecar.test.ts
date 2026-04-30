import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const sidecar = require('../../scripts/ndi-input-sidecar.cjs') as {
  bgraToRgba: (input: Buffer, alphaValue?: number | null) => Buffer;
  normalizeSource: (source: { name?: string; urlAddress?: string }) => { name: string; urlAddress: string | null };
};

describe('NDI input sidecar helpers', () => {
  it('converts BGRA receiver frames to RGBA', () => {
    const bgra = Buffer.from([
      0x33, 0x22, 0x11, 0x44,
      0xcc, 0xbb, 0xaa, 0xdd,
    ]);

    const rgba = sidecar.bgraToRgba(bgra, null);

    expect([...rgba]).toEqual([
      0x11, 0x22, 0x33, 0x44,
      0xaa, 0xbb, 0xcc, 0xdd,
    ]);
  });

  it('normalizes discovered source metadata for the UI', () => {
    expect(sidecar.normalizeSource({ name: 'Camera A', urlAddress: '192.168.1.20' })).toEqual({
      name: 'Camera A',
      urlAddress: '192.168.1.20',
    });
  });
});
