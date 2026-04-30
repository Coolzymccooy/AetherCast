const BASE = 'https://coolify.tiwaton.co.uk';
const TOKEN = process.env.COOLIFY_TOKEN;
const BACKEND_UUID = 't8wkwokc4g8w484c0swg8og8';
if (!TOKEN) throw new Error('Set COOLIFY_TOKEN.');

const headers = { 'Authorization': `Bearer ${TOKEN}`, 'Accept': 'application/json' };

// Try application logs endpoint
const res = await fetch(`${BASE}/api/v1/applications/${BACKEND_UUID}/logs`, { headers });
console.log('status:', res.status);
if (res.ok) {
  const text = await res.text();
  // Print last 100 lines
  const lines = text.split('\n');
  console.log(lines.slice(-100).join('\n'));
} else {
  const body = await res.text();
  console.log('body:', body.slice(0, 500));
  // Try services endpoint
  const res2 = await fetch(`${BASE}/api/v1/services/${BACKEND_UUID}/logs`, { headers });
  console.log('services status:', res2.status, await res2.text().then(t => t.slice(0, 500)));
}
