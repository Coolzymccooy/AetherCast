import React, { useRef, useState } from 'react';
import { FolderOpen, X, Save, Upload, Undo2, Redo2, Download, AlertTriangle } from 'lucide-react';
import { motion } from 'motion/react';

interface Props {
  projectName: string;
  onSetProjectName: (name: string) => void;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  onSave: () => void;
  onLoad: (file: File) => void;
  hasAutoSave: boolean;
  onRecoverAutoSave: () => void;
  onClose: () => void;
}

export const ProjectDialog: React.FC<Props> = ({
  projectName,
  onSetProjectName,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  onSave,
  onLoad,
  hasAutoSave,
  onRecoverAutoSave,
  onClose,
}) => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) onLoad(file);
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) onLoad(file);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
      <motion.div
        initial={{ scale: 0.95, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.95, opacity: 0 }}
        className="bg-panel border border-border w-full max-w-lg rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[85vh]"
      >
        {/* Header */}
        <div className="p-5 border-b border-border flex items-center justify-between bg-white/5">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-accent-cyan/10 flex items-center justify-center">
              <FolderOpen size={20} className="text-accent-cyan" />
            </div>
            <div>
              <h2 className="text-sm font-bold uppercase tracking-widest text-white">Project Manager</h2>
              <p className="text-[10px] text-gray-400">Save, load, and manage project files</p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 text-gray-500 hover:text-white hover:bg-white/10 rounded-full transition-colors">
            <X size={20} />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6 space-y-5">
          {/* Auto-save Recovery Banner */}
          {hasAutoSave && (
            <motion.div
              initial={{ opacity: 0, y: -8 }}
              animate={{ opacity: 1, y: 0 }}
              className="bg-yellow-400/10 border border-yellow-400/30 rounded-xl p-4 flex items-center gap-3"
            >
              <AlertTriangle size={20} className="text-yellow-400 flex-shrink-0" />
              <div className="flex-1">
                <div className="text-[11px] font-bold text-yellow-400 uppercase">Unsaved session found</div>
                <div className="text-[9px] text-gray-400 mt-0.5">A previous session was not saved properly.</div>
              </div>
              <button
                onClick={onRecoverAutoSave}
                className="px-4 py-2 bg-yellow-400/20 hover:bg-yellow-400/30 text-yellow-400 text-[10px] font-bold uppercase rounded-lg border border-yellow-400/30 transition-colors"
              >
                Recover
              </button>
            </motion.div>
          )}

          {/* Project Name */}
          <div className="space-y-1.5">
            <label className="text-[10px] font-bold text-gray-500 uppercase tracking-wider">Project Name</label>
            <input
              type="text"
              value={projectName}
              onChange={(e) => onSetProjectName(e.target.value)}
              className="w-full bg-black border border-border rounded-lg px-3 py-2.5 text-xs text-white focus:outline-none focus:border-accent-cyan transition-colors"
              placeholder="My Broadcast Project"
            />
          </div>

          {/* Undo / Redo Toolbar */}
          <div className="flex items-center gap-2">
            <button
              onClick={onUndo}
              disabled={!canUndo}
              className="flex-1 flex items-center justify-center gap-2 py-2.5 border border-border rounded-lg text-[10px] font-bold uppercase tracking-wider transition-all disabled:opacity-30 hover:bg-white/5"
            >
              <Undo2 size={14} />
              Undo
            </button>
            <button
              onClick={onRedo}
              disabled={!canRedo}
              className="flex-1 flex items-center justify-center gap-2 py-2.5 border border-border rounded-lg text-[10px] font-bold uppercase tracking-wider transition-all disabled:opacity-30 hover:bg-white/5"
            >
              <Redo2 size={14} />
              Redo
            </button>
          </div>

          {/* Save Section */}
          <div className="space-y-2">
            <label className="text-[10px] font-bold text-gray-500 uppercase tracking-wider">Save</label>
            <div className="grid grid-cols-2 gap-3">
              <button
                onClick={onSave}
                className="flex items-center justify-center gap-2 py-3 bg-accent-cyan/10 border border-accent-cyan/30 text-accent-cyan rounded-xl text-[10px] font-bold uppercase hover:bg-accent-cyan/20 transition-all"
              >
                <Save size={14} />
                Save Project
              </button>
              <button
                onClick={onSave}
                className="flex items-center justify-center gap-2 py-3 border border-border rounded-xl text-[10px] font-bold uppercase text-gray-400 hover:bg-white/5 hover:text-white transition-all"
              >
                <Download size={14} />
                Export JSON
              </button>
            </div>
          </div>

          {/* Load Section */}
          <div className="space-y-2">
            <label className="text-[10px] font-bold text-gray-500 uppercase tracking-wider">Load</label>
            <div
              onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
              onDragLeave={() => setIsDragging(false)}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
              className={`w-full py-8 border border-dashed rounded-xl flex flex-col items-center justify-center gap-2 cursor-pointer transition-all ${
                isDragging
                  ? 'border-accent-cyan bg-accent-cyan/10 text-accent-cyan'
                  : 'border-border text-gray-500 hover:text-white hover:border-gray-500 hover:bg-white/5'
              }`}
            >
              <Upload size={24} />
              <span className="text-[10px] font-bold uppercase tracking-wider">Drop .aether file or click to browse</span>
              <span className="text-[8px] text-gray-600">Supports .aether and .json project files</span>
              <input
                ref={fileInputRef}
                type="file"
                accept=".aether,.json"
                onChange={handleFileSelect}
                className="hidden"
              />
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="p-5 border-t border-border bg-black/20 flex gap-3 justify-end">
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
