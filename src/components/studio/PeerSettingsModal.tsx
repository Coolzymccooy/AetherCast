import React, { useState } from 'react';
import { X, Cloud, Monitor, Server, CheckCircle, XCircle, Loader } from 'lucide-react';
import { motion } from 'motion/react';
import { PEER_STORAGE_KEYS, getPeerEnv } from '../../utils/peerEnv';

interface PeerSettingsModalProps {
  onClose: () => void;
}

type UiMode = 'auto' | 'local' | 'advanced';

function uiModeToStorageMode(uiMode: UiMode): string {
  return uiMode === 'auto' ? 'cloud' : 'custom';
}

function storageModeToUiMode(stored: string | null): UiMode {
  if (stored === 'custom') {
    const host = localStorage.getItem(PEER_STORAGE_KEYS.host) || '';
    const isLocal = !host || host === 'localhost' || host === '127.0.0.1';
    return isLocal ? 'local' : 'advanced';
  }
  return 'auto';
}

export const PeerSettingsModal: React.FC<PeerSettingsModalProps> = ({ onClose }) => {
  const [uiMode, setUiMode] = useState<UiMode>(() =>
    storageModeToUiMode(localStorage.getItem(PEER_STORAGE_KEYS.mode))
  );
  const [host, setHost] = useState(() => localStorage.getItem(PEER_STORAGE_KEYS.host) || '');
  const [port, setPort] = useState(() => localStorage.getItem(PEER_STORAGE_KEYS.port) || '443');
  const [path, setPath] = useState(() => localStorage.getItem(PEER_STORAGE_KEYS.path) || '/peerjs');
  const [secure, setSecure] = useState(() => {
    const v = localStorage.getItem(PEER_STORAGE_KEYS.secure);
    return v === null ? true : v === 'true';
  });

  const [testState, setTestState] = useState<'idle' | 'testing' | 'ok' | 'fail'>('idle');
  const [testMsg, setTestMsg] = useState('');

  const applyAndReload = () => {
    localStorage.setItem(PEER_STORAGE_KEYS.mode, uiModeToStorageMode(uiMode));
    if (uiMode === 'local') {
      localStorage.setItem(PEER_STORAGE_KEYS.host, 'localhost');
      localStorage.setItem(PEER_STORAGE_KEYS.port, '9000');
      localStorage.setItem(PEER_STORAGE_KEYS.path, '/peerjs');
      localStorage.setItem(PEER_STORAGE_KEYS.secure, 'false');
    } else if (uiMode === 'advanced') {
      const cleanHost = host.trim().replace(/^https?:\/\//i, '');
      localStorage.setItem(PEER_STORAGE_KEYS.host, cleanHost);
      localStorage.setItem(PEER_STORAGE_KEYS.port, String(Number(port) || 443));
      localStorage.setItem(PEER_STORAGE_KEYS.path, path.trim() || '/peerjs');
      localStorage.setItem(PEER_STORAGE_KEYS.secure, secure ? 'true' : 'false');
    }
    window.location.reload();
  };

  const testConnection = async () => {
    setTestState('testing');
    setTestMsg('');

    let testHost = host.trim().replace(/^https?:\/\//i, '');
    let testPort = Number(port) || 443;
    let testPath = path.trim() || '/peerjs';
    let testSecure = secure;

    if (uiMode === 'auto') {
      testHost = '0.peerjs.com';
      testPort = 443;
      testPath = '/';
      testSecure = true;
    } else if (uiMode === 'local') {
      testHost = 'localhost';
      testPort = 9000;
      testPath = '/peerjs';
      testSecure = false;
    }

    const proto = testSecure ? 'https' : 'http';
    const url = `${proto}://${testHost}:${testPort}${testPath}`;

    try {
      const res = await fetch(url, { method: 'GET', mode: 'no-cors' });
      // no-cors always succeeds if reachable
      setTestState('ok');
      setTestMsg(`Reachable: ${url}`);
    } catch {
      setTestState('fail');
      setTestMsg(`Cannot reach: ${url}`);
    }
  };

  const currentEnv = getPeerEnv();

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm"
      onClick={onClose}
    >
      <motion.div
        initial={{ scale: 0.9, y: 20 }}
        animate={{ scale: 1, y: 0 }}
        exit={{ scale: 0.9, y: 20 }}
        className="bg-gray-900 border border-border rounded-xl p-6 max-w-lg w-full shadow-2xl relative"
        onClick={e => e.stopPropagation()}
      >
        <button onClick={onClose} className="absolute top-4 right-4 text-gray-400 hover:text-white">
          <X size={18} />
        </button>

        <h2 className="text-base font-bold text-white mb-1">Settings</h2>

        {/* Connection Mode */}
        <div className="mb-5">
          <h3 className="text-xs font-bold uppercase tracking-wider text-gray-400 mb-1">Connection Mode</h3>
          <p className="text-[11px] text-gray-500 mb-3 bg-black/30 border border-border rounded p-2 leading-relaxed">
            <strong className="text-gray-300">Auto:</strong> Easiest. Uses PeerJS cloud.<br />
            <strong className="text-gray-300">Local:</strong> Uses your computer at <code className="font-mono">localhost:9000</code>.<br />
            <strong className="text-gray-300">Advanced:</strong> Use a custom server or VPS.
          </p>

          <select
            value={uiMode}
            onChange={e => setUiMode(e.target.value as UiMode)}
            className="w-full bg-gray-800 border border-border rounded p-2 text-sm text-white focus:border-accent-cyan outline-none mb-2"
          >
            <option value="auto">Auto (Recommended)</option>
            <option value="local">Local (This Computer)</option>
            <option value="advanced">Advanced (Custom Server)</option>
          </select>

          {uiMode === 'local' && (
            <p className="text-[11px] text-gray-500">
              Requires a PeerJS server running on <code className="font-mono">localhost:9000</code>.
              Run: <code className="font-mono text-accent-cyan">npx peer --port 9000</code>
            </p>
          )}

          {uiMode === 'advanced' && (
            <div className="space-y-3 mt-3">
              <div>
                <label className="text-xs text-gray-400 mb-1 block">Host</label>
                <input
                  type="text"
                  value={host}
                  onChange={e => setHost(e.target.value)}
                  placeholder="e.g. aether-peerjs-server.onrender.com"
                  className="w-full bg-gray-800 border border-border rounded p-2 text-sm text-white focus:border-accent-cyan outline-none"
                />
                <p className="text-[10px] text-gray-500 mt-0.5">Example: yourdomain.com</p>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-gray-400 mb-1 block">Port</label>
                  <input
                    type="number"
                    value={port}
                    onChange={e => setPort(e.target.value)}
                    placeholder="443"
                    className="w-full bg-gray-800 border border-border rounded p-2 text-sm text-white focus:border-accent-cyan outline-none"
                  />
                  <p className="text-[10px] text-gray-500 mt-0.5">443 (secure), 9000 (local)</p>
                </div>
                <div>
                  <label className="text-xs text-gray-400 mb-1 block">Path</label>
                  <input
                    type="text"
                    value={path}
                    onChange={e => setPath(e.target.value)}
                    placeholder="/peerjs"
                    className="w-full bg-gray-800 border border-border rounded p-2 text-sm text-white focus:border-accent-cyan outline-none"
                  />
                  <p className="text-[10px] text-gray-500 mt-0.5">Default: /peerjs</p>
                </div>
              </div>
              <label className="flex items-center gap-2 text-sm text-gray-300 cursor-pointer">
                <input
                  type="checkbox"
                  checked={secure}
                  onChange={e => setSecure(e.target.checked)}
                  className="accent-accent-cyan"
                />
                Use TLS (wss/https)
              </label>
            </div>
          )}
        </div>

        {/* Active config display */}
        <div className="bg-black/40 border border-border rounded p-3 mb-4 text-[11px] font-mono text-gray-400">
          <span className="text-gray-500">Active: </span>
          <span className="text-white">
            {currentEnv.secure ? 'wss' : 'ws'}://{currentEnv.host}:{currentEnv.port}{currentEnv.path}
          </span>
        </div>

        {/* Test result */}
        {testState !== 'idle' && (
          <div className={`flex items-center gap-2 text-xs mb-3 p-2 rounded border ${
            testState === 'ok' ? 'bg-green-900/30 border-green-700/50 text-green-400' :
            testState === 'fail' ? 'bg-red-900/30 border-red-700/50 text-red-400' :
            'bg-gray-800 border-border text-gray-400'
          }`}>
            {testState === 'testing' && <Loader size={12} className="animate-spin" />}
            {testState === 'ok' && <CheckCircle size={12} />}
            {testState === 'fail' && <XCircle size={12} />}
            <span>{testState === 'testing' ? 'Testing connection...' : testMsg}</span>
          </div>
        )}

        <div className="flex gap-2">
          <button
            onClick={testConnection}
            className="flex-1 px-3 py-2 bg-gray-800 border border-border hover:bg-gray-700 rounded text-xs font-bold text-white transition-colors flex items-center justify-center gap-1.5"
          >
            {testState === 'testing' ? <Loader size={12} className="animate-spin" /> : <Server size={12} />}
            Test Connection
          </button>
          <button
            onClick={applyAndReload}
            className="flex-1 px-3 py-2 bg-accent-cyan text-bg rounded text-xs font-bold hover:bg-cyan-400 transition-colors"
          >
            Apply &amp; Reload
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
};
