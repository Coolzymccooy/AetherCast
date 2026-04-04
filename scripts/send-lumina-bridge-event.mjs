import fs from 'node:fs';
import path from 'node:path';

const cwd = process.cwd();

function readEnvFile(filename) {
  const fullPath = path.join(cwd, filename);
  if (!fs.existsSync(fullPath)) {
    return {};
  }

  const values = {};
  const content = fs.readFileSync(fullPath, 'utf8');
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const separator = line.indexOf('=');
    if (separator <= 0) continue;
    const key = line.slice(0, separator).trim();
    const value = line.slice(separator + 1).trim().replace(/^"(.*)"$/, '$1');
    values[key] = value;
  }
  return values;
}

function getArgValue(flag) {
  const index = process.argv.indexOf(flag);
  if (index === -1) return undefined;
  return process.argv[index + 1];
}

function hasFlag(flag) {
  return process.argv.includes(flag);
}

function printUsage() {
  console.log(`
Usage:
  npm run lumina:bridge -- --event <event> --workspace <workspace> --session <session> [options]

Required:
  --event        Lumina bridge event name
  --workspace    Workspace identifier
  --session      Session identifier

Optional:
  --payload      Inline JSON payload string
  --payload-file Path to JSON file whose contents become the request body
  --url          Full bridge URL (default: https://aethercast.tiwaton.co.uk/api/lumina/bridge)
  --token        Bridge token override
  --pretty       Pretty-print JSON response

Examples:
  npm run lumina:bridge -- --event lumina.bridge.ping --workspace sunday-service --session rehearsal-1
  npm run lumina:bridge -- --event lumina.stream.request --workspace sunday-service --session service-1 --payload "{\"payload\":{\"action\":\"start\",\"sceneName\":\"Screen\",\"profile\":\"1080p30\",\"destinationNames\":[\"YouTube\"]}}"
  npm run lumina:bridge -- --event lumina.stream.request --workspace sunday-service --session service-1 --payload-file docs/examples/lumina-start.json --pretty
`);
}

if (hasFlag('--help') || hasFlag('-h')) {
  printUsage();
  process.exit(0);
}

const fileEnv = {
  ...readEnvFile('.env'),
  ...readEnvFile('.env.local'),
};

const event = getArgValue('--event');
const workspace = getArgValue('--workspace');
const session = getArgValue('--session');
const url = getArgValue('--url') || 'https://aethercast.tiwaton.co.uk/api/lumina/bridge';
const token = getArgValue('--token') || process.env.LUMINA_BRIDGE_TOKEN || fileEnv.LUMINA_BRIDGE_TOKEN || '';
const payloadFile = getArgValue('--payload-file');
const payloadInline = getArgValue('--payload');

if (!event || !workspace || !session) {
  console.error('Missing required arguments. Use --help for usage.');
  process.exit(1);
}

let requestBody = {};

if (payloadFile) {
  const fullPayloadPath = path.isAbsolute(payloadFile)
    ? payloadFile
    : path.join(cwd, payloadFile);
  requestBody = JSON.parse(fs.readFileSync(fullPayloadPath, 'utf8'));
} else if (payloadInline) {
  requestBody = JSON.parse(payloadInline);
}

const headers = {
  'content-type': 'application/json',
  'x-lumina-event': event,
  'x-lumina-workspace': workspace,
  'x-lumina-session': session,
};

if (token) {
  headers['x-lumina-token'] = token;
}

const response = await fetch(url, {
  method: 'POST',
  headers,
  body: JSON.stringify(requestBody),
});

const bodyText = await response.text();
let parsedBody = bodyText;
try {
  parsedBody = JSON.parse(bodyText);
} catch {
  // Keep raw text if not JSON.
}

console.log(`POST ${url}`);
console.log(`Status: ${response.status}`);
console.log(`Event: ${event}`);
console.log(`Workspace: ${workspace}`);
console.log(`Session: ${session}`);
console.log(`Token sent: ${token ? 'yes' : 'no'}`);

if (hasFlag('--pretty') && typeof parsedBody !== 'string') {
  console.log(JSON.stringify(parsedBody, null, 2));
} else if (typeof parsedBody === 'string') {
  console.log(parsedBody);
} else {
  console.log(JSON.stringify(parsedBody));
}

if (!response.ok) {
  process.exit(1);
}
