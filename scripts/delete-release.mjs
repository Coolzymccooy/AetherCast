const TOKEN = process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
const REPO = 'Coolzymccooy/AetherCast';
if (!TOKEN) throw new Error('Set GH_TOKEN or GITHUB_TOKEN.');

// Delete release id 305600259 (v1.0.19 manually created)
const res = await fetch(`https://api.github.com/repos/${REPO}/releases/305600259`, {
  method: 'DELETE',
  headers: { 'Authorization': `token ${TOKEN}`, 'User-Agent': 'cleanup' }
});
console.log('Delete release status:', res.status, res.status === 204 ? '(success)' : '');
