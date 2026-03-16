import React, { useState } from 'react';
import { Edit3, X, Plus, Trash2, Save } from 'lucide-react';
import { motion } from 'motion/react';
import { Script, ScriptStep } from '../../types';
import { SCENES } from '../../constants';

interface ScriptEditorProps {
  script: Script;
  onClose: () => void;
  onSave: (s: Script) => void;
}

export const ScriptEditor: React.FC<ScriptEditorProps> = ({ script, onClose, onSave }) => {
  const [editedScript, setEditedScript] = useState<Script>(JSON.parse(JSON.stringify(script)));

  const addStep = () => {
    const newStep: ScriptStep = { id: `s-${Date.now()}`, sceneId: '1', duration: 5, label: 'New Step' };
    setEditedScript(prev => ({ ...prev, steps: [...prev.steps, newStep] }));
  };

  const updateStep = (id: string, updates: Partial<ScriptStep>) => {
    setEditedScript(prev => ({ ...prev, steps: prev.steps.map(s => s.id === id ? { ...s, ...updates } : s) }));
  };

  const removeStep = (id: string) => {
    setEditedScript(prev => ({ ...prev, steps: prev.steps.filter(s => s.id !== id) }));
  };

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.95 }}
      className="fixed inset-0 z-50 flex items-center justify-center p-8 bg-black/80 backdrop-blur-sm"
    >
      <div className="w-full max-w-2xl bg-bg border border-border rounded-lg shadow-2xl flex flex-col max-h-[80vh]">
        <div className="p-4 border-b border-border flex items-center justify-between bg-white/5">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-accent-cyan/10 flex items-center justify-center">
              <Edit3 className="text-accent-cyan" size={20} />
            </div>
            <div>
              <h2 className="text-sm font-bold uppercase tracking-widest text-white">Script Editor</h2>
              <p className="text-[10px] text-gray-400">Automate your broadcast sequence</p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 text-gray-500 hover:text-white hover:bg-white/10 rounded-full transition-colors">
            <X size={20} />
          </button>
        </div>

        <div className="p-5 bg-black/20 border-b border-border">
          <div className="flex flex-col gap-1.5">
            <label className="text-[10px] uppercase font-bold text-gray-500 tracking-wider">Script Name</label>
            <input
              type="text"
              value={editedScript.name}
              onChange={(e) => setEditedScript(prev => ({ ...prev, name: e.target.value }))}
              className="bg-black border border-border rounded-lg px-3 py-2.5 text-xs text-white focus:outline-none focus:border-accent-cyan transition-colors"
              placeholder="e.g., Main Show Sequence"
            />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-3 custom-scrollbar">
          {editedScript.steps.map((step, idx) => (
            <div key={step.id} className="flex items-center gap-4 p-4 bg-black/40 rounded-xl border border-border group transition-all hover:border-white/10">
              <div className="w-8 h-8 rounded-full bg-gray-800 flex items-center justify-center text-xs font-bold text-gray-400 group-hover:bg-accent-cyan/20 group-hover:text-accent-cyan transition-colors">
                {idx + 1}
              </div>
              <div className="flex-1 grid grid-cols-3 gap-4">
                <div className="flex flex-col gap-1.5">
                  <label className="text-[9px] uppercase font-bold text-gray-500 tracking-wider">Label</label>
                  <input
                    type="text"
                    value={step.label}
                    onChange={(e) => updateStep(step.id, { label: e.target.value })}
                    className="bg-black border border-border rounded-md px-2.5 py-2 text-xs text-white focus:outline-none focus:border-accent-cyan transition-colors"
                    placeholder="Step description"
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <label className="text-[9px] uppercase font-bold text-gray-500 tracking-wider">Scene</label>
                  <select
                    value={step.sceneId}
                    onChange={(e) => updateStep(step.id, { sceneId: e.target.value })}
                    className="bg-black border border-border rounded-md px-2.5 py-2 text-xs text-white focus:outline-none focus:border-accent-cyan transition-colors appearance-none cursor-pointer"
                  >
                    {SCENES.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                </div>
                <div className="flex flex-col gap-1.5">
                  <label className="text-[9px] uppercase font-bold text-gray-500 tracking-wider">Duration (s)</label>
                  <input
                    type="number"
                    value={step.duration}
                    onChange={(e) => updateStep(step.id, { duration: parseInt(e.target.value) || 0 })}
                    className="bg-black border border-border rounded-md px-2.5 py-2 text-xs text-white focus:outline-none focus:border-accent-cyan transition-colors font-mono"
                    min="1"
                  />
                </div>
              </div>
              <button
                onClick={() => removeStep(step.id)}
                className="p-2 text-gray-500 hover:text-accent-red hover:bg-accent-red/10 rounded-md transition-colors opacity-0 group-hover:opacity-100"
              >
                <Trash2 size={16} />
              </button>
            </div>
          ))}
          <button
            onClick={addStep}
            className="w-full py-4 border border-dashed border-border rounded-xl text-gray-500 hover:text-white hover:border-gray-500 hover:bg-white/5 transition-all flex items-center justify-center gap-2 text-xs uppercase font-bold"
          >
            <Plus size={16} /> Add Step
          </button>
        </div>

        <div className="p-5 border-t border-border bg-black/20 flex justify-end gap-3">
          <button
            onClick={onClose}
            className="px-6 py-2.5 bg-transparent hover:bg-white/5 text-white font-bold rounded-lg transition-all uppercase tracking-widest text-[10px] border border-border"
          >
            Cancel
          </button>
          <button
            onClick={() => onSave(editedScript)}
            className="px-8 py-2.5 bg-accent-cyan hover:bg-cyan-400 text-bg font-bold rounded-lg transition-all uppercase tracking-widest text-[10px] shadow-[0_0_15px_rgba(0,243,255,0.3)] flex items-center gap-2"
          >
            <Save size={14} /> Save Script
          </button>
        </div>
      </div>
    </motion.div>
  );
};
