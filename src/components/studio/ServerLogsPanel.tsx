import React from 'react';
import { Terminal, X } from 'lucide-react';
import { motion } from 'motion/react';
import { ServerLog } from '../../types';

interface ServerLogsPanelProps {
  logs: ServerLog[];
  onClose: () => void;
  onClear: () => void;
}

export const ServerLogsPanel: React.FC<ServerLogsPanelProps> = ({ logs, onClose, onClear }) => (
  <motion.div
    initial={{ x: 400 }}
    animate={{ x: 0 }}
    exit={{ x: 400 }}
    className="fixed top-12 right-0 bottom-0 w-96 bg-panel border-l border-border z-40 flex flex-col shadow-2xl"
  >
    <div className="p-4 border-b border-border flex items-center justify-between bg-white/5">
      <h3 className="text-[10px] font-bold uppercase tracking-widest flex items-center gap-2">
        <Terminal size={14} className="text-accent-cyan" />
        Server Streaming Logs
      </h3>
      <button onClick={onClose} className="text-gray-500 hover:text-white">
        <X size={16} />
      </button>
    </div>

    <div className="flex-1 overflow-y-auto p-4 font-mono text-[10px] space-y-1 bg-black/50">
      {logs.length === 0 && <div className="text-gray-600 italic">No logs yet...</div>}
      {logs.map((log, index) => (
        <div key={`${log.id}-${index}`} className={`
          ${log.type === 'error' ? 'text-accent-red' : ''}
          ${log.type === 'success' ? 'text-accent-cyan' : ''}
          ${log.type === 'warning' ? 'text-yellow-400' : ''}
          ${log.type === 'ffmpeg' ? 'text-gray-500' : 'text-gray-300'}
        `}>
          <span className="opacity-30 mr-2">[{new Date(log.id).toLocaleTimeString()}]</span>
          {log.message}
        </div>
      ))}
    </div>

    <div className="p-4 border-t border-border bg-black/20">
      <button
        onClick={onClear}
        className="w-full py-2 border border-border rounded text-[10px] uppercase font-bold hover:bg-white/5"
      >
        Clear Logs
      </button>
    </div>
  </motion.div>
);
