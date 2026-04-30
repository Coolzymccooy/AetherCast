const TOKEN = process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
const REPO = 'Coolzymccooy/AetherCast';
const TAG = process.argv[2] || 'v1.0.19';
if (!TOKEN) throw new Error('Set GH_TOKEN or GITHUB_TOKEN.');
const res = await fetch(`https://api.github.com/repos/${REPO}/releases/tags/${TAG}`, {
  headers: { 'Authorization': `token ${TOKEN}`, 'User-Agent': 'check' }
});
const r = await res.json();
console.log('status:', res.status, 'id:', r.id, 'name:', r.name, 'published:', r.published_at);
if (r.assets) {
  for (const a of r.assets) {
    console.log(' asset:', a.name, `(${(a.size / 1024 / 1024).toFixed(1)} MB)`);
  }
}
