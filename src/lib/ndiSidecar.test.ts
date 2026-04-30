import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const sidecar = require('../../scripts/ndi-sidecar.cjs') as {
  rgbaToBgra: (rgba: Buffer) => Buffer;
  SOURCE_NAMES: Record<string, string>;
};

describe('NDI sidecar helpers', () => {
  it('converts RGBA frames to BGRA while preserving alpha', () => {
    const rgba = Buffer.from([
      0x11, 0x22, 0x33, 0x44,
      0xaa, 0xbb, 0xcc, 0xdd,
    ]);

    const bgra = sidecar.rgbaToBgra(rgba);

    expect([...bgra]).toEqual([
      0x33, 0x22, 0x11, 0x44,
      0xcc, 0xbb, 0xaa, 0xdd,
    ]);
  });

  it('keeps fixed source names for switcher routing', () => {
    expect(sidecar.SOURCE_NAMES.program).toBe('Aether-Program');
    expect(sidecar.SOURCE_NAMES.alpha).toBe('Aether-Alpha');
  });
});
