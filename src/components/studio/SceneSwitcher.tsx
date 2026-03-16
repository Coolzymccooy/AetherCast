import React from 'react';
import { Camera, Monitor, Layers, Activity, Mic } from 'lucide-react';
import { Scene } from '../../types';

interface SceneSwitcherProps {
  scenes: Scene[];
  activeScene: Scene;
  onSceneChange: (s: Scene) => void;
}

export const SceneSwitcher: React.FC<SceneSwitcherProps> = ({ scenes, activeScene, onSceneChange }) => (
  <div className="w-56 shrink-0 border-r border-border flex flex-col p-3 overflow-y-auto">
    <h3 className="text-[10px] font-bold uppercase tracking-widest text-gray-500 mb-2">Scenes</h3>
    <div className="grid grid-cols-2 gap-2">
      {scenes.map(scene => (
        <button
          key={scene.id}
          onClick={() => onSceneChange(scene)}
          className={`h-14 rack-module flex flex-col items-center justify-center gap-1 transition-all active:scale-95 ${
            activeScene.id === scene.id
              ? 'border-accent-cyan ring-1 ring-accent-cyan/50 bg-accent-cyan/5'
              : 'hover:border-gray-600'
          }`}
        >
          {scene.type === 'CAM' && <Camera size={16} className={activeScene.id === scene.id ? 'text-accent-cyan' : 'text-gray-500'} />}
          {scene.type === 'SCREEN' && <Monitor size={16} className={activeScene.id === scene.id ? 'text-accent-cyan' : 'text-gray-500'} />}
          {scene.type === 'DUAL' && <Layers size={16} className={activeScene.id === scene.id ? 'text-accent-cyan' : 'text-gray-500'} />}
          {scene.type === 'GRID' && <Activity size={16} className={activeScene.id === scene.id ? 'text-accent-cyan' : 'text-gray-500'} />}
          {scene.type === 'PODCAST' && <Mic size={16} className={activeScene.id === scene.id ? 'text-accent-cyan' : 'text-gray-500'} />}
          <span className={`text-[8px] font-bold uppercase tracking-wider ${activeScene.id === scene.id ? 'text-white' : 'text-gray-500'}`}>
            {scene.name}
          </span>
        </button>
      ))}
    </div>
  </div>
);
