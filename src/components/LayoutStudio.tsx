import React, { useState } from 'react';
import { 
  Layers, 
  Layout, 
  Columns2, 
  Square, 
  Grid, 
  User, 
  BookOpen, 
  PanelLeft, 
  PanelRight, 
  Presentation,
  Sparkles,
  ChevronDown,
  ChevronUp,
  Check,
  Zap
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

interface LayoutStudioProps {
  layout: string;
  setLayout: (l: string) => void;
  composerMode: boolean;
  setComposerMode: (m: boolean) => void;
  onApplyLayout: () => void;
  onPreviewLayout: () => void;
  onSwapLayout: () => void;
  onSavePreset: () => void;
  activeTheme: string;
  setActiveTheme: (t: string) => void;
  background: string;
  setBackground: (bg: string) => void;
  frameStyle: string;
  setFrameStyle: (fs: string) => void;
  motionStyle: string;
  setMotionStyle: (ms: string) => void;
  brandColor: string;
  setBrandColor: (bc: string) => void;
}

export const LayoutStudio: React.FC<LayoutStudioProps> = ({
  layout,
  setLayout,
  composerMode,
  setComposerMode,
  onApplyLayout,
  onPreviewLayout,
  onSwapLayout,
  onSavePreset,
  activeTheme,
  setActiveTheme,
  background,
  setBackground,
  frameStyle,
  setFrameStyle,
  motionStyle,
  setMotionStyle,
  brandColor,
  setBrandColor
}) => {
  const [applyText, setApplyText] = useState('Apply Layout');
  const [swapText, setSwapText] = useState('Swap Layout');
  const [saveText, setSaveText] = useState('Save Preset');

  const handleApply = () => {
    onApplyLayout();
    setApplyText('Applied!');
    setTimeout(() => setApplyText('Apply Layout'), 2000);
  };

  const handleSwap = () => {
    onSwapLayout();
    setSwapText('Swapped!');
    setTimeout(() => setSwapText('Swap Layout'), 2000);
  };

  const handleSave = () => {
    onSavePreset();
    setSaveText('Saving...');
    setTimeout(() => setSaveText('Save Preset'), 2000);
  };

  const backgrounds = ['Blur Camera', 'Gradient Motion', 'Brand Theme', 'Light Studio', 'Neon Pulse', 'Cyberpunk', 'Minimalist', 'Cosmic', 'Retro Wave', 'Abstract'];
  const frameStyles = ['Floating', 'Flat', 'Glass'];
  const motionStyles = ['Smooth', 'Gentle', 'Snappy'];
  const brandColors = ['#5d28d9', '#541b3f', '#22c55e'];

  return (
    <div className="flex flex-col h-full bg-bg text-white font-sans overflow-hidden">
      {/* Header */}
      <div className="p-4 flex items-center justify-between border-b border-white/5">
        <div className="flex items-center gap-2">
          <Layers size={18} className="text-accent-cyan" />
          <h2 className="text-sm font-bold tracking-tight">Layout Studio</h2>
        </div>
        <button className="text-[10px] uppercase font-bold text-gray-500 hover:text-white transition-colors">
          Toggle
        </button>
      </div>

      <div className="flex-1 overflow-y-auto custom-scrollbar p-4 space-y-6">
        {/* Composer Mode Section */}
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-xs font-bold text-gray-200">Composer Mode - {activeTheme}</h3>
          </div>
          <button 
            onClick={() => setComposerMode(!composerMode)}
            className={`w-12 h-6 rounded-full p-1 transition-all duration-300 ${composerMode ? 'bg-accent-purple' : 'bg-gray-700'}`}
          >
            <motion.div 
              className="w-4 h-4 bg-white rounded-full shadow-lg"
              animate={{ x: composerMode ? 24 : 0 }}
              transition={{ type: "spring", stiffness: 500, damping: 30 }}
            />
          </button>
        </div>

        {/* Layout Selection */}
        <div className="space-y-2">
          <h3 className="text-[10px] font-black tracking-widest text-gray-500 uppercase">Layout</h3>
          <div className="grid grid-cols-2 gap-2">
            {[
              { id: 'Solo', icon: <User size={14} />, label: 'Solo' },
              { id: 'Framed Solo', icon: <User size={14} />, label: 'Framed Solo' },
              { id: 'Side-by-Side', icon: <Columns2 size={14} />, label: 'Side-by-Side' },
              { id: 'Picture-in-Pic', icon: <Square size={14} />, label: 'PiP (Cam)' },
              { id: 'Grid', icon: <Grid size={14} />, label: 'Grid' },
              { id: 'Projector + Spk', icon: <Presentation size={14} />, label: 'Projector' },
              { id: 'Split Left', icon: <PanelLeft size={14} />, label: 'Split L' },
              { id: 'Split Right', icon: <PanelRight size={14} />, label: 'Split R' },
              { id: 'PiP', icon: <Square size={14} />, label: 'PiP (Screen)' },
              { id: 'Freeform', icon: <Layout size={14} />, label: 'Freeform' },
            ].map(l => (
              <button
                key={l.id}
                onClick={() => setLayout(l.id)}
                className={`py-2 px-3 rounded-lg border flex flex-col items-center justify-center gap-2 transition-all ${
                  layout === l.id 
                    ? 'bg-accent-cyan/10 border-accent-cyan text-accent-cyan' 
                    : 'bg-panel/40 border-white/5 text-gray-400 hover:border-white/20 hover:text-gray-200'
                }`}
              >
                {l.icon}
                <span className="text-[10px] font-medium">{l.label}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Background */}
        <div className="space-y-2">
          <h3 className="text-[10px] font-black tracking-widest text-gray-500 uppercase">Background</h3>
          <div className="flex flex-col gap-2">
            {backgrounds.map(bg => (
              <button
                key={bg}
                onClick={() => setBackground(bg)}
                className={`py-2 px-4 rounded-lg border text-xs font-medium transition-all ${
                  background === bg 
                    ? 'bg-accent-cyan/10 border-accent-cyan text-accent-cyan' 
                    : 'bg-panel/40 border-white/5 text-gray-400 hover:border-white/20 hover:text-gray-200'
                }`}
              >
                {bg}
              </button>
            ))}
          </div>
        </div>

        {/* Frame Style */}
        <div className="space-y-2">
          <h3 className="text-[10px] font-black tracking-widest text-gray-500 uppercase">Frame Style</h3>
          <div className="flex flex-col gap-2">
            {frameStyles.map(style => (
              <button
                key={style}
                onClick={() => setFrameStyle(style)}
                className={`py-2 px-4 rounded-lg border text-xs font-medium transition-all ${
                  frameStyle === style 
                    ? 'bg-accent-cyan/10 border-accent-cyan text-accent-cyan' 
                    : 'bg-panel/40 border-white/5 text-gray-400 hover:border-white/20 hover:text-gray-200'
                }`}
              >
                {style}
              </button>
            ))}
          </div>
        </div>

        {/* Motion Style */}
        <div className="space-y-2">
          <h3 className="text-[10px] font-black tracking-widest text-gray-500 uppercase">Motion Style</h3>
          <div className="flex flex-col gap-2">
            {motionStyles.map(style => (
              <button
                key={style}
                onClick={() => setMotionStyle(style)}
                className={`py-2 px-4 rounded-lg border text-xs font-medium transition-all ${
                  motionStyle === style 
                    ? 'bg-accent-cyan/10 border-accent-cyan text-accent-cyan' 
                    : 'bg-panel/40 border-white/5 text-gray-400 hover:border-white/20 hover:text-gray-200'
                }`}
              >
                {style}
              </button>
            ))}
          </div>
        </div>

        {/* Brand Theme */}
        <div className="space-y-2">
          <h3 className="text-[10px] font-black tracking-widest text-gray-500 uppercase">Brand Theme</h3>
          <div className="flex flex-col gap-2">
            {brandColors.map(color => (
              <button
                key={color}
                onClick={() => setBrandColor(color)}
                className={`py-2 px-4 rounded-lg border flex items-center gap-3 transition-all ${
                  brandColor === color 
                    ? 'bg-white/10 border-white/20' 
                    : 'bg-panel/40 border-white/5 hover:border-white/20'
                }`}
              >
                <div className="w-4 h-4 rounded-sm" style={{ backgroundColor: color }} />
                <span className="text-xs font-medium text-gray-300">{color}</span>
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Action Buttons */}
      <div className="p-4 border-t border-white/5 bg-panel/20">
        <div className="grid grid-cols-2 gap-2">
          <button 
            onClick={onPreviewLayout}
            className="py-3 px-4 rounded-lg bg-white/5 border border-white/10 text-[10px] font-bold uppercase tracking-widest hover:bg-white/10 transition-colors"
          >
            Preview Layout
          </button>
          <button 
            onClick={handleApply}
            className={`py-3 px-4 rounded-lg text-[10px] font-bold uppercase tracking-widest transition-colors shadow-lg ${
              applyText === 'Applied!' ? 'bg-accent-green text-black shadow-accent-green/20' : 'bg-accent-purple text-white hover:bg-accent-purple/90 shadow-accent-purple/20'
            }`}
          >
            {applyText}
          </button>
          <button 
            onClick={handleSwap}
            className={`py-3 px-4 rounded-lg border text-[10px] font-bold uppercase tracking-widest transition-colors ${
              swapText === 'Swapped!' ? 'bg-accent-cyan/20 border-accent-cyan text-accent-cyan' : 'bg-white/5 border-white/10 hover:bg-white/10'
            }`}
          >
            {swapText}
          </button>
          <button 
            onClick={handleSave}
            className={`py-3 px-4 rounded-lg text-[10px] font-bold uppercase tracking-widest transition-colors shadow-lg ${
              saveText === 'Saving...' ? 'bg-accent-cyan text-black shadow-accent-cyan/20' : 'bg-accent-purple text-white hover:bg-accent-purple/90 shadow-accent-purple/20'
            }`}
          >
            {saveText}
          </button>
        </div>
      </div>
    </div>
  );
};
