const BASE = 'https://coolify.tiwaton.co.uk';
const TOKEN = process.env.COOLIFY_TOKEN;
if (!TOKEN) throw new Error('Set COOLIFY_TOKEN.');
const headers = { 'Authorization': `Bearer ${TOKEN}`, 'Accept': 'application/json' };

const res = await fetch(`${BASE}/api/v1/applications`, { headers });
const apps = await res.json();
if (!Array.isArray(apps)) { console.log(JSON.stringify(apps, null, 2)); process.exit(1); }
for (const app of apps) {
  console.log(`uuid:${app.uuid} name:${app.name} fqdn:${app.fqdn}`);
}
