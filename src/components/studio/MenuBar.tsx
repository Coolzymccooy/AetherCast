import React, { useState } from 'react';
import { Settings, Edit3, History, ZoomIn, ZoomOut, RotateCcw } from 'lucide-react';
import { AnimatePresence } from 'motion/react';
import { motion } from 'motion/react';

interface MenuBarProps {
  onOpenGallery: () => void;
  onOpenEditor: () => void;
  onAction: (action: string) => void;
  zoomLevel?: number;
  onZoomIn?: () => void;
  onZoomOut?: () => void;
  onZoomReset?: () => void;
}

const menuConfig: Record<string, string[]> = {
  'File': ['New Project', 'Open...', 'Save', 'Save As...', 'Export Recording', 'Exit'],
  'Edit': ['Undo', 'Redo', 'Cut', 'Copy', 'Paste', 'Preferences'],
  'View': ['Zoom In', 'Zoom Out', 'Reset Zoom', 'Actual Size', 'Toggle Source Rack', 'Toggle Director Rack', 'Toggle Telemetry', 'Fullscreen'],
  'Sources': ['Add Camera', 'Add Screen Share', 'Add Media File', 'Add Browser Source'],
  'Scenes': ['New Scene', 'Duplicate Scene', 'Delete Scene', 'Scene Transitions'],
  'Stream': ['Start Streaming', 'Stop Streaming', 'Stream Settings', 'Output Quality'],
  'Tools': ['AI Director Settings', 'Script Editor', 'Recording Gallery', 'Diagnostics'],
  'Window': ['Audio Mixer', 'Source Rack', 'Director Rack', 'Reset Layout'],
  'Help': ['Documentation', 'Keyboard Shortcuts', 'Download Desktop App', 'Check for Updates', 'About Aether Studio'],
};

const DIVIDER_ITEMS = new Set(['Exit', 'Preferences', 'Output Quality', 'Diagnostics', 'About Aether Studio', 'Actual Size', 'Toggle Source Rack', 'Fullscreen', 'Download Desktop App']);

const SHORTCUT_MAP: Record<string, string> = {
  'Zoom In': 'Ctrl+=',
  'Zoom Out': 'Ctrl+-',
  'Reset Zoom': 'Ctrl+0',
  'Fullscreen': 'F11',
  'Undo': 'Ctrl+Z',
  'Redo': 'Ctrl+Y',
};

export const MenuBar: React.FC<MenuBarProps> = ({
  onOpenGallery, onOpenEditor, onAction,
  zoomLevel = 100, onZoomIn, onZoomOut, onZoomReset,
}) => {
  const [activeMenu, setActiveMenu] = useState<string | null>(null);

  const handleMenuAction = (menu: string, item: string) => {
    if (item === 'Recording Gallery') onOpenGallery();
    else if (item === 'Script Editor') onOpenEditor();
    else if (item === 'Save' || item === 'Save As...') onAction('File:Save Project');
    else if (item === 'Open...') onAction('File:Open Project');
    else if (item === 'Zoom In') onZoomIn?.();
    else if (item === 'Zoom Out') onZoomOut?.();
    else if (item === 'Reset Zoom' || item === 'Actual Size') onZoomReset?.();
    else if (item === 'Fullscreen') {
      if (document.fullscreenElement) document.exitFullscreen();
      else document.documentElement.requestFullscreen();
    }
    else onAction(`${menu}:${item}`);
    setActiveMenu(null);
  };

  return (
    <div className="h-8 bg-bg border-b border-border flex items-center px-2 gap-1 text-xs font-medium relative z-[100]">
      {Object.keys(menuConfig).map(menu => (
        <div key={menu} className="relative">
          <button
            onMouseEnter={() => activeMenu && setActiveMenu(menu)}
            onClick={() => setActiveMenu(activeMenu === menu ? null : menu)}
            className={`hover:bg-white/10 px-3 py-1 rounded-sm transition-colors cursor-default ${activeMenu === menu ? 'bg-white/10 text-white' : 'text-gray-400'}`}
          >
            {menu}
          </button>

          <AnimatePresence>
            {activeMenu === menu && (
              <>
                <div className="fixed inset-0 z-[-1]" onClick={() => setActiveMenu(null)} />
                <motion.div
                  initial={{ opacity: 0, y: -5 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -5 }}
                  className="absolute top-full left-0 w-56 bg-panel border border-border rounded-sm shadow-2xl py-1 mt-0.5 overflow-hidden"
                >
                  {menuConfig[menu].map(item => (
                    <React.Fragment key={item}>
                      {DIVIDER_ITEMS.has(item) && <div className="h-px bg-border my-1 mx-2" />}
                      <button
                        onClick={() => handleMenuAction(menu, item)}
                        className="w-full text-left px-4 py-1.5 hover:bg-accent-cyan hover:text-bg transition-colors flex items-center justify-between group"
                      >
                        <span>{item}</span>
                        {SHORTCUT_MAP[item] && (
                          <span className="text-[9px] text-gray-500 group-hover:text-bg/60 font-mono">{SHORTCUT_MAP[item]}</span>
                        )}
                      </button>
                    </React.Fragment>
                  ))}
                </motion.div>
              </>
            )}
          </AnimatePresence>
        </div>
      ))}

      <div className="flex-1" />

      {/* Zoom controls — always visible in the menu bar */}
      <div className="flex items-center gap-1 mr-3 border-r border-border pr-3">
        <button
          onClick={onZoomOut}
          className="p-1 text-gray-500 hover:text-white hover:bg-white/10 rounded transition-colors"
          title="Zoom Out (Ctrl+-)"
        >
          <ZoomOut size={13} />
        </button>
        <button
          onClick={onZoomReset}
          className="px-1.5 py-0.5 text-[10px] font-mono text-gray-400 hover:text-white hover:bg-white/10 rounded transition-colors min-w-[40px] text-center"
          title="Reset Zoom (Ctrl+0)"
        >
          {zoomLevel}%
        </button>
        <button
          onClick={onZoomIn}
          className="p-1 text-gray-500 hover:text-white hover:bg-white/10 rounded transition-colors"
          title="Zoom In (Ctrl+=)"
        >
          <ZoomIn size={13} />
        </button>
      </div>

      <div className="flex items-center gap-2 mr-4">
        <button
          onClick={onOpenEditor}
          className="flex items-center gap-1.5 px-2 py-1 rounded-sm hover:bg-white/5 text-gray-400 hover:text-accent-cyan transition-colors"
        >
          <Edit3 size={12} />
          <span>Scripts</span>
        </button>
        <button
          onClick={onOpenGallery}
          className="flex items-center gap-1.5 px-2 py-1 rounded-sm hover:bg-white/5 text-gray-400 hover:text-accent-cyan transition-colors"
        >
          <History size={12} />
          <span>Gallery</span>
        </button>
      </div>
      <button className="text-gray-500 hover:text-white p-1 active:scale-90 transition-transform">
        <Settings size={14} />
      </button>
    </div>
  );
};
