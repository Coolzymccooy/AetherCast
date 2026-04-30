const TOKEN = process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
const REPO = 'Coolzymccooy/AetherCast';
if (!TOKEN) throw new Error('Set GH_TOKEN or GITHUB_TOKEN.');

const res = await fetch(`https://api.github.com/repos/${REPO}/actions/runs?per_page=5&event=push`, {
  headers: { 'Authorization': `token ${TOKEN}`, 'User-Agent': 'check' }
});
const data = await res.json();
for (const run of data.workflow_runs ?? []) {
  console.log(`run:${run.id} workflow:${run.name} status:${run.status} conclusion:${run.conclusion} branch:${run.head_branch} sha:${run.head_sha?.slice(0,7)} url:${run.html_url}`);
}
