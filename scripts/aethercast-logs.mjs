const BASE = 'https://coolify.tiwaton.co.uk';
const TOKEN = process.env.COOLIFY_TOKEN;
const UUID = 'gksoc4o44og8s0wgsow8o0wg'; // aethercast.tiwaton.co.uk
if (!TOKEN) throw new Error('Set COOLIFY_TOKEN.');

const headers = { 'Authorization': `Bearer ${TOKEN}`, 'Accept': 'application/json' };

const res = await fetch(`${BASE}/api/v1/applications/${UUID}/logs`, { headers });
console.log('HTTP', res.status);
const text = await res.text();
// Try to parse as JSON
try {
  const json = JSON.parse(text);
  const logs = typeof json.logs === 'string' ? json.logs : JSON.stringify(json, null, 2);
  // Print last 80 lines
  const lines = logs.split('\n').filter(l => l.trim());
  console.log(lines.slice(-80).join('\n'));
} catch {
  console.log(text.slice(-6000));
}
