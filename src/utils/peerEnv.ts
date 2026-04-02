export type PeerEnv = { host: string; port: number; secure: boolean; path: string };

type PeerMode = 'cloud' | 'custom';

const CLOUD_DEFAULT: PeerEnv = {
  host: '0.peerjs.com',
  port: 443,
  secure: true,
  path: '/',
};

export const PEER_STORAGE_KEYS = {
  mode: 'aether_peer_mode',
  host: 'aether_peer_host',
  port: 'aether_peer_port',
  path: 'aether_peer_path',
  secure: 'aether_peer_secure',
};

const parseBool = (v: string | null, fallback: boolean): boolean => {
  if (typeof v !== 'string') return fallback;
  const s = v.trim().toLowerCase();
  if (s === 'true') return true;
  if (s === 'false') return false;
  return fallback;
};

const parseNum = (v: string | null, fallback: number): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
};

/**
 * Resolves PeerJS server configuration using 3-tier priority:
 *   1. URL query params  (phones receive this via QR code)
 *   2. localStorage      (Studio settings panel)
 *   3. Hard-coded cloud defaults (0.peerjs.com)
 */
export function getPeerEnv(): PeerEnv {
  let queryMode: PeerMode | null = null;
  let queryHost: string | null = null;
  let queryPort: string | null = null;
  let queryPath: string | null = null;
  let querySecure: string | null = null;

  try {
    const params = new URLSearchParams(window.location.search);
    queryMode = (params.get('peerMode') as PeerMode | null) || null;
    queryHost = params.get('peerHost');
    queryPort = params.get('peerPort');
    queryPath = params.get('peerPath');
    querySecure = params.get('peerSecure');
  } catch { /* ok */ }

  const storedMode = (localStorage.getItem(PEER_STORAGE_KEYS.mode) as PeerMode | null) || null;
  const storedHost = localStorage.getItem(PEER_STORAGE_KEYS.host);
  const storedPort = localStorage.getItem(PEER_STORAGE_KEYS.port);
  const storedPath = localStorage.getItem(PEER_STORAGE_KEYS.path);
  const storedSecure = localStorage.getItem(PEER_STORAGE_KEYS.secure);

  const mode: PeerMode = queryMode || storedMode || 'cloud';

  if (mode === 'cloud') {
    return { ...CLOUD_DEFAULT };
  }

  // Custom / local mode
  const rawHost = (queryHost?.trim()) || (storedHost?.trim()) || '';
  const host = rawHost.replace(/^https?:\/\//i, '').trim();

  const rawPath = (queryPath?.trim()) || (storedPath?.trim()) || '/peerjs';
  const path = rawPath.startsWith('/') ? rawPath : `/${rawPath}`;

  const isLocalTarget = !host || host === 'localhost' || host === '127.0.0.1';
  const secureDefault = !isLocalTarget;
  const secure = parseBool(querySecure || storedSecure, secureDefault);

  const fallbackPort = host ? (secure ? 443 : 9000) : 9000;
  const port = parseNum(queryPort || storedPort, fallbackPort);

  return {
    host: host || CLOUD_DEFAULT.host,
    port,
    secure,
    path,
  };
}

/** Build the PeerJS query params string to embed in QR codes (custom mode only) */
export function buildPeerQueryParams(): string {
  const mode = (localStorage.getItem(PEER_STORAGE_KEYS.mode) as PeerMode | null) || 'cloud';
  if (mode === 'cloud') return '';

  const host = localStorage.getItem(PEER_STORAGE_KEYS.host) || '';
  const port = localStorage.getItem(PEER_STORAGE_KEYS.port) || '';
  const path = localStorage.getItem(PEER_STORAGE_KEYS.path) || '/peerjs';
  const secure = localStorage.getItem(PEER_STORAGE_KEYS.secure) || 'true';

  const params = new URLSearchParams();
  params.set('peerMode', 'custom');
  if (host) params.set('peerHost', host);
  if (port) params.set('peerPort', port);
  params.set('peerPath', path);
  params.set('peerSecure', secure);
  return params.toString();
}
