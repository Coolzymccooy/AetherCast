#!/usr/bin/env node
'use strict';

const SOURCE_NAMES = {
  program: 'Aether-Program',
  alpha: 'Aether-Alpha',
};

let grandiose = null;
let senders = new Map();
let status = {
  state: 'inactive',
  health: { ok: false, error: null },
  active: false,
  width: 1920,
  height: 1080,
  fps: 30,
  alphaEnabled: true,
  framesSent: 0,
  droppedFrames: 0,
  lastFrameMs: 0,
  lastError: null,
  sources: [],
};

const isMock = process.env.AETHER_NDI_MOCK === '1';

function emit(event, payload = {}) {
  process.stdout.write(`${JSON.stringify({ event, ...payload })}\n`);
}

function loadGrandiose() {
  if (isMock) {
    status.health = { ok: true, error: null, mock: true };
    return { ok: true, mock: true };
  }
  if (grandiose) return { ok: true };
  try {
    grandiose = require('@stagetimerio/grandiose');
    status.health = { ok: true, error: null };
    return { ok: true };
  } catch (err) {
    const error = err?.message || String(err);
    status.health = { ok: false, error };
    status.state = 'error';
    status.lastError = error;
    return { ok: false, error };
  }
}

async function createSender(sourceKey) {
  const name = SOURCE_NAMES[sourceKey];
  if (isMock) {
    return {
      async video() {},
      async destroy() {},
    };
  }
  return grandiose.send({
    name,
    clockVideo: true,
    clockAudio: false,
  });
}

async function stopSenders() {
  const current = Array.from(senders.values());
  senders = new Map();
  await Promise.all(current.map(async (sender) => {
    try {
      await sender.destroy();
    } catch {
      // Best-effort cleanup. Rust owns the process lifetime.
    }
  }));
  status.active = false;
  status.state = 'stopped';
  status.sources = [];
}

function rgbaToBgra(rgba) {
  const bgra = Buffer.allocUnsafe(rgba.length);
  for (let index = 0; index + 3 < rgba.length; index += 4) {
    bgra[index] = rgba[index + 2];
    bgra[index + 1] = rgba[index + 1];
    bgra[index + 2] = rgba[index];
    bgra[index + 3] = rgba[index + 3];
  }
  return bgra;
}

async function start(payload) {
  const loaded = loadGrandiose();
  if (!loaded.ok) {
    emit('error', { error: loaded.error, status });
    process.exitCode = 2;
    return;
  }

  await stopSenders();

  status = {
    ...status,
    state: 'starting',
    active: false,
    width: Number(payload.width) || 1920,
    height: Number(payload.height) || 1080,
    fps: Number(payload.fps) || 30,
    alphaEnabled: payload.alphaEnabled !== false,
    framesSent: 0,
    droppedFrames: 0,
    lastFrameMs: 0,
    lastError: null,
    sources: [],
  };

  const sourceKeys = status.alphaEnabled ? ['program', 'alpha'] : ['program'];
  for (const sourceKey of sourceKeys) {
    const sender = await createSender(sourceKey);
    senders.set(sourceKey, sender);
    status.sources.push({
      key: sourceKey,
      name: SOURCE_NAMES[sourceKey],
      state: 'active',
      framesSent: 0,
      droppedFrames: 0,
      lastFrameMs: 0,
      lastError: null,
    });
  }

  status.state = 'active';
  status.active = true;
  emit('started', { status });
}

async function sendFrame(header, rgba) {
  if (!status.active) return;
  const sourceKey = header.source === 'alpha' ? 'alpha' : 'program';
  const sender = senders.get(sourceKey);
  const sourceStatus = status.sources.find((source) => source.key === sourceKey);
  if (!sender || !sourceStatus) return;

  try {
    const width = Number(header.width) || status.width;
    const height = Number(header.height) || status.height;
    const expected = width * height * 4;
    if (!rgba || rgba.length !== expected) {
      throw new Error(`Invalid ${sourceKey} frame size: got ${rgba?.length || 0}, expected ${expected}`);
    }

    const bgra = rgbaToBgra(rgba);
    if (!isMock) {
      const frame = {
        xres: width,
        yres: height,
        frameRateN: 30000,
        frameRateD: 1001,
        pictureAspectRatio: width / height,
        frameFormatType: grandiose.FORMAT_TYPE_PROGRESSIVE,
        lineStrideBytes: width * 4,
        fourCC: grandiose.FOURCC_BGRA,
        data: bgra,
      };
      if (typeof header.timecode === 'string') {
        try {
          frame.timecode = BigInt(header.timecode);
        } catch {
          // Synthesized NDI timecode is acceptable if parsing fails.
        }
      }
      await sender.video(frame);
    }

    const now = Date.now();
    status.framesSent += 1;
    status.lastFrameMs = now;
    sourceStatus.framesSent += 1;
    sourceStatus.lastFrameMs = now;
  } catch (err) {
    const error = err?.message || String(err);
    status.droppedFrames += 1;
    status.lastError = error;
    if (sourceStatus) {
      sourceStatus.droppedFrames += 1;
      sourceStatus.lastError = error;
    }
    emit('frame-error', { error, source: sourceKey, status });
  }
}

async function handlePacket(header, payload) {
  switch (header.command) {
    case 'start':
      await start(header);
      break;
    case 'stop':
      await stopSenders();
      emit('stopped', { status });
      break;
    case 'status':
      emit('status', { status });
      break;
    case 'frame':
      await sendFrame(header, payload);
      break;
    default:
      emit('error', { error: `Unknown command: ${header.command || '<missing>'}`, status });
      break;
  }
}

function runProbe() {
  const result = loadGrandiose();
  process.stdout.write(`${JSON.stringify(result)}\n`);
  process.exit(result.ok ? 0 : 2);
}

function readPackets() {
  let buffer = Buffer.alloc(0);
  let pendingLength = null;
  let pendingHeader = null;

  process.stdin.on('data', (chunk) => {
    buffer = Buffer.concat([buffer, chunk]);
    void drain();
  });

  async function drain() {
    while (true) {
      if (pendingLength === null) {
        if (buffer.length < 4) return;
        pendingLength = buffer.readUInt32LE(0);
        buffer = buffer.subarray(4);
      }
      if (!pendingHeader) {
        if (buffer.length < pendingLength) return;
        const headerBytes = buffer.subarray(0, pendingLength);
        buffer = buffer.subarray(pendingLength);
        pendingHeader = JSON.parse(headerBytes.toString('utf8'));
      }

      const header = pendingHeader;
      const payloadBytes = Number(header.payloadBytes) || 0;
      if (buffer.length < payloadBytes) {
        return;
      }
      const payload = payloadBytes > 0 ? buffer.subarray(0, payloadBytes) : null;
      buffer = buffer.subarray(payloadBytes);
      pendingHeader = null;
      pendingLength = null;
      await handlePacket(header, payload);
    }
  }
}

process.on('SIGTERM', () => {
  stopSenders().finally(() => process.exit(0));
});

if (require.main === module) {
  if (process.argv.includes('--probe')) {
    runProbe();
  } else {
    const loaded = loadGrandiose();
    emit(loaded.ok ? 'health' : 'error', loaded.ok ? { status } : { error: loaded.error, status });
    if (!loaded.ok) process.exitCode = 2;
    readPackets();
  }
}

module.exports = {
  rgbaToBgra,
  SOURCE_NAMES,
};
