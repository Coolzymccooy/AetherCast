import React, { useEffect, useState } from 'react';
import { X, RefreshCw, CheckCircle, ArrowUpCircle, AlertCircle, Download, ExternalLink } from 'lucide-react';
import { motion } from 'motion/react';

interface CheckForUpdatesModalProps {
  onClose: () => void;
}

interface ReleaseInfo {
  tagName: string;
  version: string;
  releaseUrl: string;
  publishedAt: string | null;
  body: string;
  exeUrl: string | null;
  msiUrl: string | null;
}

const GITHUB_LATEST_API = 'https://api.github.com/repos/Coolzymccooy/AetherCast/releases/latest';
const GITHUB_RELEASES_URL = 'https://github.com/Coolzymccooy/AetherCast/releases';

/** Strip leading 'v' from a semver tag: "v1.0.14" → "1.0.14" */
function stripV(tag: string): string {
  return tag.replace(/^v/, '');
}

/** Compare two semver strings. Returns 1 if a > b, -1 if a < b, 0 if equal. */
function compareSemver(a: string, b: string): number {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const na = pa[i] ?? 0;
    const nb = pb[i] ?? 0;
    if (na > nb) return 1;
    if (na < nb) return -1;
  }
  return 0;
}

/** Read current version from Tauri's __TAURI_METADATA__ if available, else fallback. */
async function getCurrentVersion(): Promise<string> {
  if (window.__TAURI_INTERNALS__) {
    try {
      const { getVersion } = await import('@tauri-apps/api/app');
      return await getVersion();
    } catch {
      // Tauri API unavailable — use fallback
    }
  }
  // Injected at build time via Vite define, or hardcoded fallback
  return (window as any).__APP_VERSION__ ?? '1.0.13';
}

export const CheckForUpdatesModal: React.FC<CheckForUpdatesModalProps> = ({ onClose }) => {
  const [status, setStatus] = useState<'checking' | 'up-to-date' | 'update-available' | 'error'>('checking');
  const [currentVersion, setCurrentVersion] = useState<string>('…');
  const [release, setRelease] = useState<ReleaseInfo | null>(null);
  const [errorMsg, setErrorMsg] = useState<string>('');

  useEffect(() => {
    let cancelled = false;

    const check = async () => {
      const current = await getCurrentVersion();
      if (cancelled) return;
      setCurrentVersion(current);

      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 10_000);
        let res: Response;
        try {
          res = await fetch(GITHUB_LATEST_API, {
            headers: { Accept: 'application/vnd.github+json' },
            signal: controller.signal,
          });
        } finally {
          clearTimeout(timeoutId);
        }
        if (!res.ok) throw new Error(`GitHub API returned ${res.status}`);

        const data = await res.json();
        if (cancelled) return;

        const tagName: string = (data.tag_name ?? '').trim();
        const latestVersion = stripV(tagName);
        const publishedAt: string | null = data.published_at ?? null;
        const body: string = data.body ?? '';
        const releaseUrl: string = data.html_url ?? GITHUB_RELEASES_URL;

        const assets: any[] = Array.isArray(data.assets) ? data.assets : [];
        const exeAsset = assets.find((a: any) => typeof a.name === 'string' && a.name.endsWith('-setup.exe'));
        const msiAsset = assets.find((a: any) => typeof a.name === 'string' && a.name.endsWith('.msi'));

        const info: ReleaseInfo = {
          tagName,
          version: latestVersion,
          releaseUrl,
          publishedAt,
          body,
          exeUrl: exeAsset?.browser_download_url ?? null,
          msiUrl: msiAsset?.browser_download_url ?? null,
        };

        setRelease(info);

        const cmp = compareSemver(latestVersion, current);
        setStatus(cmp > 0 ? 'update-available' : 'up-to-date');
      } catch (err: any) {
        if (!cancelled) {
          setErrorMsg(err?.message ?? 'Unknown error');
          setStatus('error');
        }
      }
    };

    void check();
    return () => { cancelled = true; };
  }, []);

  const formatDate = (iso: string | null): string => {
    if (!iso) return '';
    const d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
      <motion.div
        initial={{ scale: 0.95, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.95, opacity: 0 }}
        className="bg-panel border border-border w-full max-w-md rounded-2xl shadow-2xl overflow-hidden flex flex-col"
      >
        {/* Header */}
        <div className="p-5 border-b border-border flex items-center justify-between bg-white/5">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-full bg-accent-cyan/10 flex items-center justify-center">
              <RefreshCw size={16} className="text-accent-cyan" />
            </div>
            <div>
              <h2 className="text-sm font-bold uppercase tracking-widest text-white">Check for Updates</h2>
              <p className="text-[10px] text-gray-400">Aether Studio</p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 text-gray-500 hover:text-white hover:bg-white/10 rounded-full transition-colors">
            <X size={18} />
          </button>
        </div>

        {/* Body */}
        <div className="p-6 space-y-5">
          {/* Version row */}
          <div className="flex items-center justify-between text-[11px]">
            <span className="text-gray-500 uppercase tracking-wider">Current version</span>
            <span className="font-mono text-white">{currentVersion}</span>
          </div>

          {/* Status */}
          {status === 'checking' && (
            <div className="flex items-center gap-3 py-4 justify-center">
              <RefreshCw size={18} className="text-accent-cyan animate-spin" />
              <span className="text-[12px] text-gray-400">Checking for updates…</span>
            </div>
          )}

          {status === 'up-to-date' && (
            <div className="flex items-center gap-3 px-4 py-3 rounded-xl bg-emerald-950/40 border border-emerald-800/40">
              <CheckCircle size={18} className="text-emerald-400 shrink-0" />
              <div>
                <p className="text-[12px] font-semibold text-emerald-300">You're up to date</p>
                <p className="text-[10px] text-gray-500">
                  {release ? `${release.tagName} is the latest release` : 'No newer version found'}
                  {release?.publishedAt ? ` · Published ${formatDate(release.publishedAt)}` : ''}
                </p>
              </div>
            </div>
          )}

          {status === 'update-available' && release && (
            <div className="space-y-3">
              <div className="flex items-center gap-3 px-4 py-3 rounded-xl bg-accent-cyan/10 border border-accent-cyan/30">
                <ArrowUpCircle size={18} className="text-accent-cyan shrink-0" />
                <div>
                  <p className="text-[12px] font-semibold text-accent-cyan">Update available — {release.tagName}</p>
                  <p className="text-[10px] text-gray-400">
                    {formatDate(release.publishedAt) ? `Published ${formatDate(release.publishedAt)}` : 'New release ready to install'}
                  </p>
                </div>
              </div>

              {release.body.trim() && (
                <div className="bg-black/30 rounded-lg p-3 border border-border max-h-32 overflow-y-auto">
                  <p className="text-[9px] text-gray-500 uppercase tracking-wider mb-1">Release notes</p>
                  <pre className="text-[10px] text-gray-300 whitespace-pre-wrap font-sans leading-relaxed">{release.body.trim().slice(0, 600)}{release.body.trim().length > 600 ? '…' : ''}</pre>
                </div>
              )}

              <div className="flex flex-wrap gap-2">
                {release.exeUrl && (
                  <a
                    href={release.exeUrl}
                    className="inline-flex items-center gap-2 px-4 py-2 bg-accent-cyan hover:bg-cyan-400 text-black text-[10px] font-bold uppercase rounded-lg transition-all active:scale-95"
                  >
                    <Download size={12} />
                    Download Installer (.exe)
                  </a>
                )}
                {release.msiUrl && (
                  <a
                    href={release.msiUrl}
                    className="inline-flex items-center gap-2 px-4 py-2 bg-white/10 hover:bg-white/20 text-white text-[10px] font-bold uppercase rounded-lg transition-all active:scale-95 border border-border"
                  >
                    <Download size={12} />
                    MSI Package
                  </a>
                )}
              </div>

              <a
                href={release.releaseUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1 text-[10px] text-gray-500 hover:text-accent-cyan transition-colors"
              >
                <ExternalLink size={10} /> View release on GitHub
              </a>
            </div>
          )}

          {status === 'error' && (
            <div className="flex items-center gap-3 px-4 py-3 rounded-xl bg-red-950/40 border border-red-800/40">
              <AlertCircle size={18} className="text-red-400 shrink-0" />
              <div>
                <p className="text-[12px] font-semibold text-red-300">Could not check for updates</p>
                <p className="text-[10px] text-gray-500">{errorMsg}</p>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 pb-5 flex justify-end">
          <button
            onClick={onClose}
            className="px-5 py-2 bg-transparent hover:bg-white/5 text-white font-bold rounded-lg transition-all uppercase tracking-widest text-[10px] border border-border"
          >
            Close
          </button>
        </div>
      </motion.div>
    </div>
  );
};
