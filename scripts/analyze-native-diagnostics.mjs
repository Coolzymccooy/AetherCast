import fs from 'node:fs';
import path from 'node:path';

function fail(message) {
  console.error(message);
  process.exit(1);
}

const filePath = process.argv[2];
if (!filePath) {
  fail('Usage: npm run diagnostics:check -- <path-to-diagnostics.json>');
}

const resolvedPath = path.resolve(process.cwd(), filePath);
if (!fs.existsSync(resolvedPath)) {
  fail(`Diagnostics file not found: ${resolvedPath}`);
}

const payload = JSON.parse(fs.readFileSync(resolvedPath, 'utf8'));
const history = Array.isArray(payload.history) ? payload.history : [];
const latest = payload.latest || history.at(-1)?.stats || null;

if (history.length === 0 || !latest) {
  fail('Diagnostics payload does not contain any history samples.');
}

const restartCount = latest.restart_count || 0;
const watchdogRenders = latest.watchdog_renders || 0;
const outputErrors = (latest.output_statuses || []).filter((output) => output.state === 'error');
const archiveState = latest.archive_status?.state || 'inactive';
const archiveRestartCount = latest.archive_status?.restart_count || 0;
const maxFrameAgeMs = history.reduce((max, sample) => {
  const age = sample?.stats?.last_frame_age_ms || 0;
  return Math.max(max, age);
}, 0);
const degradedSamples = history.filter((sample) => {
  const stats = sample?.stats;
  return !stats || stats.restarting || stats.last_error || (stats.output_statuses || []).some((output) => output.state === 'recovering' || output.state === 'degraded');
}).length;
const totalSamples = history.length;
const degradedRatio = totalSamples > 0 ? degradedSamples / totalSamples : 1;
const firstCapturedAt = history[0]?.capturedAt || Date.now();
const lastCapturedAt = history.at(-1)?.capturedAt || firstCapturedAt;
const durationMinutes = (lastCapturedAt - firstCapturedAt) / 60000;

console.log(JSON.stringify({
  durationMinutes: Number(durationMinutes.toFixed(2)),
  samples: totalSamples,
  restartCount,
  watchdogRenders,
  maxFrameAgeMs,
  degradedRatio: Number(degradedRatio.toFixed(4)),
  archiveState,
  archiveRestartCount,
  outputErrors: outputErrors.map((output) => ({
    name: output.name,
    protocol: output.protocol,
    lastError: output.last_error || null,
  })),
}, null, 2));

if (restartCount > 3) {
  fail(`Diagnostics check failed: restart count too high (${restartCount}).`);
}

if (maxFrameAgeMs > 5000) {
  fail(`Diagnostics check failed: max frame age too high (${maxFrameAgeMs}ms).`);
}

if (degradedRatio > 0.1) {
  fail(`Diagnostics check failed: degraded ratio too high (${(degradedRatio * 100).toFixed(2)}%).`);
}

if (archiveState === 'error') {
  fail('Diagnostics check failed: archive entered error state.');
}

if (outputErrors.length > 0) {
  fail(`Diagnostics check failed: ${outputErrors.length} output(s) ended in error state.`);
}

console.log('Diagnostics check passed.');
