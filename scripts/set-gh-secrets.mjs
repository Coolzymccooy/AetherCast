import _sodium from 'libsodium-wrappers';
import { readFileSync } from 'fs';

const TOKEN = process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
if (!TOKEN) throw new Error('Set GH_TOKEN env var to your GitHub personal access token');
const REPO = 'Coolzymccooy/AetherCast';

const HEADERS = {
  'Authorization': `token ${TOKEN}`,
  'User-Agent': 'aethercast-secret-setup',
  'Accept': 'application/vnd.github+json',
};

async function getRepoPublicKey() {
  const res = await fetch(`https://api.github.com/repos/${REPO}/actions/secrets/public-key`, {
    headers: HEADERS,
  });
  if (!res.ok) throw new Error(`Failed to get public key: ${res.status}`);
  return res.json(); // { key_id, key }
}

async function encryptSecret(publicKeyB64, secretValue) {
  await _sodium.ready;
  const sodium = _sodium;

  const keyBytes = Buffer.from(publicKeyB64, 'base64');
  const secretBytes = Buffer.from(secretValue, 'utf8');
  const encryptedBytes = sodium.crypto_box_seal(secretBytes, keyBytes);
  return Buffer.from(encryptedBytes).toString('base64');
}

async function setSecret(name, value, keyId, encryptedValue) {
  const res = await fetch(`https://api.github.com/repos/${REPO}/actions/secrets/${name}`, {
    method: 'PUT',
    headers: { ...HEADERS, 'Content-Type': 'application/json' },
    body: JSON.stringify({ encrypted_value: encryptedValue, key_id: keyId }),
  });
  if (!res.ok && res.status !== 204) {
    const body = await res.text();
    throw new Error(`Failed to set secret ${name}: ${res.status} ${body}`);
  }
  console.log(`  ✓ ${name} set`);
}

async function main() {
  console.log('Fetching repo public key...');
  const { key_id, key } = await getRepoPublicKey();
  console.log(`  key_id: ${key_id}`);

  // The key file stores the minisign key as base64; decode it to get the raw key text
  // that Tauri expects (starting with "untrusted comment: rsign encrypted secret key")
  const privateKey = Buffer.from(readFileSync('signing-keys/aethercast.key', 'utf8').trim(), 'base64').toString('utf8');
  const password = 'Bigshegz@27';

  console.log('Encrypting and setting secrets...');
  const [encPrivKey, encPassword] = await Promise.all([
    encryptSecret(key, privateKey),
    encryptSecret(key, password),
  ]);

  await setSecret('TAURI_SIGNING_PRIVATE_KEY', privateKey, key_id, encPrivKey);
  await setSecret('TAURI_SIGNING_PRIVATE_KEY_PASSWORD', password, key_id, encPassword);

  console.log('\nDone! Both secrets are set in GitHub Actions.');
}

main().catch(e => { console.error('FAILED:', e.message); process.exit(1); });
