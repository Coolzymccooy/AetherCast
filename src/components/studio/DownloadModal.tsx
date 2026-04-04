import React, { useEffect, useMemo, useState } from 'react';
import { X, Monitor, Apple, Download, ExternalLink, Shield, Zap, Cpu } from 'lucide-react';
import { motion } from 'motion/react';

interface DownloadModalProps {
  onClose: () => void;
}

interface DownloadFile {
  label: string;
  url: string;
  size: string;
}

interface LatestReleaseSummary {
  tagName: string;
  releaseUrl: string;
  publishedAt: string | null;
  files: DownloadFile[];
}

interface GitHubReleaseAsset {
  name?: string;
  browser_download_url?: string;
  size?: number;
}

interface GitHubLatestReleaseResponse {
  tag_name?: string;
  html_url?: string;
  published_at?: string;
  assets?: GitHubReleaseAsset[];
}

const GITHUB_REPO = 'https://github.com/Coolzymccooy/AetherCast';
const GITHUB_LATEST_RELEASE_API = 'https://api.github.com/repos/Coolzymccooy/AetherCast/releases/latest';
const GITHUB_LATEST_RELEASE_URL = `${GITHUB_REPO}/releases/latest`;
const FALLBACK_WINDOWS_FILES: DownloadFile[] = [
  {
    label: 'Installer (.exe)',
    url: `${GITHUB_REPO}/releases/latest/download/Selton.Studio_latest_x64-setup.exe`,
    size: 'Latest build',
  },
  {
    label: 'MSI Package',
    url: `${GITHUB_REPO}/releases/latest/download/Selton.Studio_latest_x64_en-US.msi`,
    size: 'Latest build',
  },
];

function formatFileSize(sizeBytes?: number): string {
  if (!sizeBytes || Number.isNaN(sizeBytes) || sizeBytes <= 0) {
    return 'Latest build';
  }

  const sizeMb = sizeBytes / (1024 * 1024);
  if (sizeMb >= 100) {
    return `${sizeMb.toFixed(0)} MB`;
  }
  if (sizeMb >= 10) {
    return `${sizeMb.toFixed(1)} MB`;
  }
  return `${sizeMb.toFixed(2)} MB`;
}

function parseLatestRelease(payload: GitHubLatestReleaseResponse): LatestReleaseSummary | null {
  const assets = Array.isArray(payload.assets) ? payload.assets : [];
  const exeAsset = assets.find(asset => asset.name?.endsWith('-setup.exe'));
  const msiAsset = assets.find(asset => asset.name?.endsWith('.msi'));

  if (!exeAsset?.browser_download_url || !msiAsset?.browser_download_url) {
    return null;
  }

  return {
    tagName: payload.tag_name?.trim() || 'Latest',
    releaseUrl: payload.html_url?.trim() || GITHUB_LATEST_RELEASE_URL,
    publishedAt: payload.published_at?.trim() || null,
    files: [
      {
        label: 'Installer (.exe)',
        url: exeAsset.browser_download_url,
        size: formatFileSize(exeAsset.size),
      },
      {
        label: 'MSI Package',
        url: msiAsset.browser_download_url,
        size: formatFileSize(msiAsset.size),
      },
    ],
  };
}

function formatPublishedAt(input: string | null): string | null {
  if (!input) {
    return null;
  }

  const parsed = new Date(input);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }

  return parsed.toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

export const DownloadModal: React.FC<DownloadModalProps> = ({ onClose }) => {
  const [latestRelease, setLatestRelease] = useState<LatestReleaseSummary | null>(null);
  const [loadingRelease, setLoadingRelease] = useState(true);
  const [releaseLookupFailed, setReleaseLookupFailed] = useState(false);

  useEffect(() => {
    const controller = new AbortController();

    const loadLatestRelease = async () => {
      try {
        const response = await fetch(GITHUB_LATEST_RELEASE_API, {
          signal: controller.signal,
          headers: {
            Accept: 'application/vnd.github+json',
          },
        });

        if (!response.ok) {
          throw new Error(`GitHub latest release lookup failed: ${response.status}`);
        }

        const payload = (await response.json()) as GitHubLatestReleaseResponse;
        const parsed = parseLatestRelease(payload);

        if (!parsed) {
          throw new Error('Latest desktop assets were not present on the latest release');
        }

        setLatestRelease(parsed);
        setReleaseLookupFailed(false);
      } catch (error) {
        if (controller.signal.aborted) {
          return;
        }
        console.warn('[aether] Failed to load latest desktop release metadata', error);
        setLatestRelease(null);
        setReleaseLookupFailed(true);
      } finally {
        if (!controller.signal.aborted) {
          setLoadingRelease(false);
        }
      }
    };

    void loadLatestRelease();

    return () => {
      controller.abort();
    };
  }, []);

  const latestReleaseUrl = latestRelease?.releaseUrl ?? GITHUB_LATEST_RELEASE_URL;
  const publishedAt = formatPublishedAt(latestRelease?.publishedAt ?? null);

  const downloads = useMemo(
    () => [
      {
        platform: 'Windows',
        icon: <Monitor size={24} />,
        description: latestRelease
          ? `Windows 10/11 (64-bit) - ${latestRelease.tagName}`
          : 'Windows 10/11 (64-bit)',
        files: latestRelease?.files ?? FALLBACK_WINDOWS_FILES,
        features: [
          'GPU encoding (NVIDIA NVENC, Intel QSV, AMD AMF)',
          'Direct RTMP output - no server needed',
          'Lower CPU usage than browser mode',
        ],
        color: 'accent-cyan',
      },
      {
        platform: 'macOS',
        icon: <Apple size={24} />,
        description: 'Coming soon',
        files: [],
        features: ['macOS build is in progress - check back soon'],
        color: 'gray-300',
      },
    ],
    [latestRelease]
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
      <motion.div
        initial={{ scale: 0.95, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.95, opacity: 0 }}
        className="bg-panel border border-border w-full max-w-3xl rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]"
      >
        <div className="p-5 border-b border-border flex items-center justify-between bg-white/5">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-accent-cyan/10 flex items-center justify-center">
              <Download size={20} className="text-accent-cyan" />
            </div>
            <div>
              <h2 className="text-sm font-bold uppercase tracking-widest text-white">Download Desktop App</h2>
              <p className="text-[10px] text-gray-400">GPU-accelerated streaming - no browser limitations</p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 text-gray-500 hover:text-white hover:bg-white/10 rounded-full transition-colors">
            <X size={20} />
          </button>
        </div>

        <div className="px-6 py-4 bg-accent-cyan/5 border-b border-border">
          <div className="grid grid-cols-3 gap-4">
            <div className="flex items-center gap-2 text-[10px]">
              <Zap size={14} className="text-accent-cyan shrink-0" />
              <span className="text-gray-300">GPU encoding - faster than browser mode</span>
            </div>
            <div className="flex items-center gap-2 text-[10px]">
              <Cpu size={14} className="text-accent-cyan shrink-0" />
              <span className="text-gray-300">Lower CPU overhead on long sessions</span>
            </div>
            <div className="flex items-center gap-2 text-[10px]">
              <Shield size={14} className="text-accent-cyan shrink-0" />
              <span className="text-gray-300">Direct RTMP output - no browser relay</span>
            </div>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-[10px] text-gray-400">
            <span>
              Latest release:{' '}
              <span className="text-white">{latestRelease?.tagName ?? (loadingRelease ? 'Loading...' : 'Latest')}</span>
            </span>
            {publishedAt ? <span>Published: {publishedAt}</span> : null}
            {releaseLookupFailed ? <span>Using stable fallback download links</span> : null}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-4">
          {downloads.map(platform => (
            <div key={platform.platform} className="bg-black/40 border border-border rounded-xl p-5 hover:border-white/20 transition-all">
              <div className="flex items-start gap-4">
                <div className="w-12 h-12 bg-white/5 rounded-xl flex items-center justify-center text-gray-400 shrink-0">
                  {platform.icon}
                </div>
                <div className="flex-1">
                  <h3 className="text-sm font-bold text-white">{platform.platform}</h3>
                  <p className="text-[10px] text-gray-500 mt-0.5">{platform.description}</p>

                  <div className="flex flex-wrap gap-2 mt-3">
                    {platform.files.map(file => (
                      <a
                        key={file.label}
                        href={file.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-2 px-4 py-2 bg-accent-cyan hover:bg-cyan-400 text-black text-[10px] font-bold uppercase rounded-lg transition-all active:scale-95"
                      >
                        <Download size={12} />
                        {file.label}
                        <span className="text-[8px] opacity-60">{file.size}</span>
                      </a>
                    ))}
                    {platform.files.length === 0 ? (
                      <a
                        href={latestReleaseUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-2 px-4 py-2 bg-white/5 hover:bg-white/10 text-white text-[10px] font-bold uppercase rounded-lg transition-all active:scale-95 border border-border"
                      >
                        <ExternalLink size={12} />
                        View release page
                      </a>
                    ) : null}
                  </div>

                  <div className="flex flex-wrap gap-x-4 gap-y-1 mt-3">
                    {platform.features.map(feature => (
                      <span key={feature} className="text-[9px] text-gray-500">- {feature}</span>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>

        <div className="p-5 border-t border-border bg-black/20 flex items-center justify-between">
          <a
            href={latestReleaseUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-[10px] text-gray-500 hover:text-accent-cyan flex items-center gap-1 transition-colors"
          >
            <ExternalLink size={10} /> View latest release on GitHub
          </a>
          <button
            onClick={onClose}
            className="px-6 py-2.5 bg-transparent hover:bg-white/5 text-white font-bold rounded-lg transition-all uppercase tracking-widest text-[10px] border border-border"
          >
            Close
          </button>
        </div>
      </motion.div>
    </div>
  );
};
