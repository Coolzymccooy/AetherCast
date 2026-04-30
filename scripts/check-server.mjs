// Check if the aethercast cloud server is responding
const BASE = 'https://coolify.tiwaton.co.uk';
const TOKEN = process.env.COOLIFY_TOKEN;
const UUID = 'gksoc4o44og8s0wgsow8o0wg';
if (!TOKEN) throw new Error('Set COOLIFY_TOKEN.');

const headers = { 'Authorization': `Bearer ${TOKEN}`, 'Accept': 'application/json' };

// Check app status
const res = await fetch(`${BASE}/api/v1/applications/${UUID}`, { headers });
const app = await res.json();
console.log('App status:', app.status);
console.log('App git commit SHA:', app.git_commit_sha);
console.log('App last deployment:', app.updated_at);

// Also hit the server health endpoint directly
try {
  const health = await fetch('https://aethercast.tiwaton.co.uk/api/health', { signal: AbortSignal.timeout(5000) });
  console.log('Health HTTP:', health.status, await health.text());
} catch (e) {
  console.log('Health check failed:', e.message);
}
