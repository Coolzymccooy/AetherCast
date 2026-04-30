#!/usr/bin/env node
'use strict';

let grandiose = null;
let receiver = null;
let running = true;
let framesReceived = 0;
let droppedFrames = 0;
let lastFrameMs = 0;
let lastError = null;

function loadGrandiose() {
  if (grandiose) return { ok: true };
  try {
    grandiose = require('@stagetimerio/grandiose');
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err?.message || String(err) };
  }
}

function log(event, payload = {}) {
  process.stderr.write(`${JSON.stringify({ event, ...payload })}\n`);
}

function normalizeSource(source) {
  return {
    name: String(source?.name || ''),
    urlAddress: source?.urlAddress ? String(source.urlAddress) : null,
  };
}

async function discover(timeoutMs = 1500) {
  const loaded = loadGrandiose();
  if (!loaded.ok) {
    process.stdout.write(JSON.stringify({ ok: false, error: loaded.error, sources: [] }));
    process.exit(2);
    return;
  }

  const finder = await grandiose.find({ showLocalSources: true });
  try {
    finder.wait(timeoutMs);
    const sources = finder.sources().map(normalizeSource).filter((source) => source.name);
    process.stdout.write(JSON.stringify({ ok: true, sources }));
  } finally {
    await finder.destroy();
  }
}

function packet(header, payload) {
  const payloadBytes = payload ? payload.length : 0;
  const headerBytes = Buffer.from(JSON.stringify({ ...header, payloadBytes }), 'utf8');
  const len = Buffer.allocUnsafe(4);
  len.writeUInt32LE(headerBytes.length, 0);
  process.stdout.write(len);
  process.stdout.write(headerBytes);
  if (payloadBytes > 0) process.stdout.write(payload);
}

function bgraToRgba(input, alphaValue = 255) {
  const output = Buffer.allocUnsafe(input.length);
  for (let index = 0; index + 3 < input.length; index += 4) {
    output[index] = input[index + 2];
    output[index + 1] = input[index + 1];
    output[index + 2] = input[index];
    output[index + 3] = alphaValue === null ? input[index + 3] : alphaValue;
  }
  return output;
}

function normalizeVideoFrame(frame) {
  const width = Number(frame?.xres) || 0;
  const height = Number(frame?.yres) || 0;
  if (!width || !height || !Buffer.isBuffer(frame?.data)) {
    throw new Error('Invalid NDI video frame');
  }

  const stride = Number(frame.lineStrideBytes) || width * 4;
  const expected = width * height * 4;
  const packed = Buffer.allocUnsafe(expected);
  const source = frame.data;
  for (let row = 0; row < height; row++) {
    const srcOffset = row * stride;
    const dstOffset = row * width * 4;
    source.copy(packed, dstOffset, srcOffset, srcOffset + width * 4);
  }

  switch (frame.fourCC) {
    case grandiose.FOURCC_RGBA:
      return packed;
    case grandiose.FOURCC_RGBX: {
      for (let index = 3; index < packed.length; index += 4) packed[index] = 255;
      return packed;
    }
    case grandiose.FOURCC_BGRA:
      return bgraToRgba(packed, null);
    case grandiose.FOURCC_BGRX:
      return bgraToRgba(packed, 255);
    default:
      throw new Error(`Unsupported NDI video FourCC: ${frame.fourCC}`);
  }
}

async function receiveLoop(sourceName) {
  const loaded = loadGrandiose();
  if (!loaded.ok) throw new Error(loaded.error);

  const finder = await grandiose.find({ showLocalSources: true });
  let source = null;
  try {
    const deadline = Date.now() + 5000;
    while (!source && Date.now() < deadline) {
      finder.wait(500);
      source = finder.sources().find((candidate) => candidate.name === sourceName) || null;
    }
  } finally {
    await finder.destroy();
  }

  if (!source) throw new Error(`NDI source not found: ${sourceName}`);

  receiver = await grandiose.receive({
    source,
    colorFormat: grandiose.COLOR_FORMAT_RGBX_RGBA,
    bandwidth: grandiose.BANDWIDTH_HIGHEST,
    allowVideoFields: false,
    name: 'Aether-NDI-Input',
  });

  log('started', { source: normalizeSource(source) });

  while (running) {
    try {
      const frame = await receiver.video(2000);
      if (!frame || frame.type !== 'video') continue;
      const rgba = normalizeVideoFrame(frame);
      framesReceived += 1;
      lastFrameMs = Date.now();
      packet({
        event: 'frame',
        width: frame.xres,
        height: frame.yres,
        framesReceived,
        droppedFrames,
        lastFrameMs,
      }, rgba);
    } catch (err) {
      droppedFrames += 1;
      lastError = err?.message || String(err);
      log('receive-error', { error: lastError, framesReceived, droppedFrames, lastFrameMs });
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }
}

async function stop() {
  running = false;
  if (receiver) {
    try {
      await receiver.destroy();
    } catch {
      // Best-effort cleanup.
    }
    receiver = null;
  }
}

async function main() {
  if (process.argv.includes('--discover')) {
    const idx = process.argv.indexOf('--timeout');
    const timeout = idx >= 0 ? Number(process.argv[idx + 1]) || 1500 : 1500;
    await discover(timeout);
    return;
  }

  const sourceIdx = process.argv.indexOf('--source');
  const sourceName = sourceIdx >= 0 ? process.argv[sourceIdx + 1] : '';
  if (!sourceName) {
    throw new Error('Missing --source <name>');
  }
  await receiveLoop(sourceName);
}

process.on('SIGTERM', () => {
  stop().finally(() => process.exit(0));
});
process.on('SIGINT', () => {
  stop().finally(() => process.exit(0));
});

if (require.main === module) {
  main().catch((err) => {
    lastError = err?.message || String(err);
    log('fatal', { error: lastError, framesReceived, droppedFrames, lastFrameMs });
    process.exit(2);
  });
}

module.exports = {
  bgraToRgba,
  normalizeSource,
};
