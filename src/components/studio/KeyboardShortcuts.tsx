import React, { useEffect } from 'react';
import { motion } from 'motion/react';
import { X, Layers, Zap, Radio, HelpCircle } from 'lucide-react';

interface Props {
  onClose: () => void;
}

interface Shortcut {
  keys: string[];
  description: string;
}

interface ShortcutGroup {
  title: string;
  icon: React.ReactNode;
  shortcuts: Shortcut[];
  comingSoon?: boolean;
}

const Kbd: React.FC<{ children: string }> = ({ children }) => (
  <kbd className="inline-flex items-center justify-center min-w-[28px] h-7 px-2 rounded border border-gray-600 bg-black/60 text-[11px] font-mono font-bold text-gray-200 shadow-[0_2px_0_0_rgba(255,255,255,0.06)] leading-none">
    {children}
  </kbd>
);

const SHORTCUT_GROUPS: ShortcutGroup[] = [
  {
    title: 'Scene Switching',
    icon: <Layers size={16} className="text-accent-cyan" />,
    shortcuts: [
      { keys: ['1'], description: 'Switch to Scene 1' },
      { keys: ['2'], description: 'Switch to Scene 2' },
      { keys: ['3'], description: 'Switch to Scene 3' },
      { keys: ['4'], description: 'Switch to Scene 4' },
      { keys: ['5'], description: 'Switch to Scene 5' },
      { keys: ['6'], description: 'Switch to Scene 6' },
    ],
  },
  {
    title: 'Transitions',
    icon: <Zap size={16} className="text-yellow-400" />,
    shortcuts: [
      { keys: ['Space'], description: 'Cut (instant switch)' },
      { keys: ['F'], description: 'Fade transition' },
    ],
  },
  {
    title: 'Streaming',
    icon: <Radio size={16} className="text-red-400" />,
    shortcuts: [],
    comingSoon: true,
  },
  {
    title: 'General',
    icon: <HelpCircle size={16} className="text-green-400" />,
    shortcuts: [
      { keys: ['?'], description: 'Show this help' },
      { keys: ['Esc'], description: 'Close modal' },
    ],
  },
];

export const KeyboardShortcuts: React.FC<Props> = ({ onClose }) => {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

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
        className="bg-gray-900 border border-border rounded-xl p-8 max-w-2xl w-full shadow-2xl relative"
        onClick={e => e.stopPropagation()}
      >
        <button
          onClick={onClose}
          className="absolute top-4 right-4 text-gray-400 hover:text-white transition-colors"
        >
          <X size={20} />
        </button>

        <div className="flex flex-col items-center mb-6">
          <div className="w-12 h-12 bg-accent-cyan/10 rounded-full flex items-center justify-center mb-3 border border-accent-cyan/30">
            <HelpCircle size={24} className="text-accent-cyan" />
          </div>
          <h2 className="text-xl font-bold text-white">Keyboard Shortcuts</h2>
          <p className="text-sm text-gray-400 mt-1">Quick reference for studio controls</p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {SHORTCUT_GROUPS.map(group => (
            <div key={group.title} className="bg-black/30 border border-border rounded-lg p-4">
              <div className="flex items-center gap-2 mb-3">
                {group.icon}
                <h3 className="text-xs font-bold uppercase tracking-wider text-gray-300">
                  {group.title}
                </h3>
              </div>

              {group.comingSoon ? (
                <p className="text-xs text-gray-500 italic">Coming soon</p>
              ) : (
                <div className="space-y-2">
                  {group.shortcuts.map(shortcut => (
                    <div
                      key={shortcut.description}
                      className="flex items-center justify-between gap-3"
                    >
                      <span className="text-xs text-gray-400">{shortcut.description}</span>
                      <div className="flex items-center gap-1 shrink-0">
                        {shortcut.keys.map(key => (
                          <Kbd key={key}>{key}</Kbd>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>

        <div className="mt-6 text-center">
          <p className="text-[10px] text-gray-600 uppercase tracking-widest">
            Press <Kbd>Esc</Kbd> to close
          </p>
        </div>
      </motion.div>
    </motion.div>
  );
};
