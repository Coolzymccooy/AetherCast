import { readFileSync, createReadStream, statSync } from 'fs';
import { resolve } from 'path';

const TOKEN = process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
const REPO = 'Coolzymccooy/AetherCast';
const VERSION = '1.0.19';
const BASE = 'src-tauri/target/release/bundle';
if (!TOKEN) throw new Error('Set GH_TOKEN or GITHUB_TOKEN.');

const HEADERS = {
  'Authorization': `token ${TOKEN}`,
  'User-Agent': 'selton-release-script',
};

async function apiPost(path, body) {
  const res = await fetch(`https://api.github.com${path}`, {
    method: 'POST',
    headers: { ...HEADERS, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(`API error ${res.status}: ${JSON.stringify(json)}`);
  return json;
}

async function uploadAsset(uploadUrl, filePath, name) {
  const url = uploadUrl.replace('{?name,label}', `?name=${encodeURIComponent(name)}`);
  const data = readFileSync(filePath);
  const isSig = name.endsWith('.sig') || name.endsWith('.json');
  const contentType = isSig ? 'text/plain' : 'application/octet-stream';
  const res = await fetch(url, {
    method: 'POST',
    headers: { ...HEADERS, 'Content-Type': contentType, 'Content-Length': String(data.length) },
    body: data,
  });
  const json = await res.json();
  if (!res.ok) throw new Error(`Upload error ${res.status}: ${JSON.stringify(json)}`);
  console.log(`  ✓ ${name} (${(data.length / 1024 / 1024).toFixed(1)} MB)`);
  return json;
}

// Check if release already exists
async function getExistingRelease() {
  const res = await fetch(`https://api.github.com/repos/${REPO}/releases/tags/v${VERSION}`, {
    headers: HEADERS,
  });
  if (res.status === 404) return null;
  return res.json();
}

async function main() {
  console.log(`Creating release v${VERSION} on ${REPO}...`);

  let release = await getExistingRelease();
  if (release && release.id) {
    console.log(`Release v${VERSION} already exists (id=${release.id}), deleting and recreating...`);
    await fetch(`https://api.github.com/repos/${REPO}/releases/${release.id}`, {
      method: 'DELETE', headers: HEADERS,
    });
    // Also delete the tag
    await fetch(`https://api.github.com/repos/${REPO}/git/refs/tags/v${VERSION}`, {
      method: 'DELETE', headers: HEADERS,
    });
  }

  release = await apiPost(`/repos/${REPO}/releases`, {
    tag_name: `v${VERSION}`,
    target_commitish: 'main',
    name: `Selton Studio v${VERSION}`,
    body: [
      '## What\'s new in v1.0.19',
      '',
      '### UI Fixes',
      '- Bottom panel (AudioMixer / Scenes) no longer clips — fully scrollable',
      '- Director Rack tab bar split into 2 clean rows of 5 each',
      '- Layout Studio Toggle collapses/expands with smooth animation',
      '',
      '### Features (v1.0.14–1.0.18)',
      '- In-app auto-update via Help menu',
      '- Virtual camera WebSocket bridge',
      '- 15s FFmpeg liveness watchdog',
      '- Socket auth token persistence across restarts',
      '- Scene transitions (cut / fade / dissolve)',
      '- High-bitrate local recording pipeline',
      '- Server modularised into ai.ts + lumina.ts sub-routers',
    ].join('\n'),
    draft: false,
    prerelease: false,
  });

  console.log(`Release created: ${release.html_url}`);
  console.log('Uploading assets...');

  const uploadUrl = release.upload_url;
  const assets = [
    [`${BASE}/msi/Selton Studio_1.0.19_x64_en-US.msi`,     'Selton.Studio_1.0.19_x64_en-US.msi'],
    [`${BASE}/msi/Selton Studio_1.0.19_x64_en-US.msi.sig`, 'Selton.Studio_1.0.19_x64_en-US.msi.sig'],
    [`${BASE}/nsis/Selton Studio_1.0.19_x64-setup.exe`,     'Selton.Studio_1.0.19_x64-setup.exe'],
    [`${BASE}/nsis/Selton Studio_1.0.19_x64-setup.exe.sig`, 'Selton.Studio_1.0.19_x64-setup.exe.sig'],
    [`${BASE}/latest.json`,                                  'latest.json'],
  ];

  for (const [filePath, name] of assets) {
    await uploadAsset(uploadUrl, filePath, name);
  }

  console.log(`\nDone! Release URL: ${release.html_url}`);
  console.log('Auto-updater endpoint: https://github.com/Coolzymccooy/AetherCast/releases/latest/download/latest.json');
}

main().catch(e => { console.error('FAILED:', e.message); process.exit(1); });
