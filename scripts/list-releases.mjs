const TOKEN = process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
const REPO = 'Coolzymccooy/AetherCast';
if (!TOKEN) throw new Error('Set GH_TOKEN or GITHUB_TOKEN.');
const res = await fetch(`https://api.github.com/repos/${REPO}/releases?per_page=5`, {
  headers: { 'Authorization': `token ${TOKEN}`, 'User-Agent': 'check' }
});
const releases = await res.json();
for (const r of releases) {
  console.log(`id:${r.id} tag:${r.tag_name} name:${r.name} assets:${r.assets?.length}`);
}
