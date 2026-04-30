const BASE = 'https://coolify.tiwaton.co.uk';
const TOKEN = process.env.COOLIFY_TOKEN;
const UUID = 'gksoc4o44og8s0wgsow8o0wg'; // aethercast.tiwaton.co.uk
if (!TOKEN) throw new Error('Set COOLIFY_TOKEN.');

const headers = { 'Authorization': `Bearer ${TOKEN}`, 'Accept': 'application/json' };

const res = await fetch(`${BASE}/api/v1/applications/${UUID}/envs`, { headers });
console.log('HTTP', res.status);
const data = await res.json();
if (Array.isArray(data)) {
  for (const env of data) {
    // Don't print secret values, just names
    console.log(`${env.key}=${env.is_secret ? '***' : env.value}`);
  }
} else {
  console.log(JSON.stringify(data, null, 2));
}
