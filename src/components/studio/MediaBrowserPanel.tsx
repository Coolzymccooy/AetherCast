import React, { useRef, useState } from 'react';
import { Film, Upload, Play, Pause, Square, SkipBack, SkipForward, Repeat, Trash2, Music, Image, Video } from 'lucide-react';
import { motion } from 'motion/react';

interface MediaItem {
  id: string;
  name: string;
  type: string;
  duration?: number;
  thumbnail?: string;
}

interface PlaybackState {
  currentItem: MediaItem | null;
  isPlaying: boolean;
  currentTime: number;
  duration: number;
  volume: number;
  loop: boolean;
  playlistIndex: number;
}

interface Props {
  playlist: MediaItem[];
  playbackState: PlaybackState;
  onAddMedia: (file: File) => void;
  onRemoveMedia: (id: string) => void;
  onPlay: () => void;
  onPause: () => void;
  onStop: () => void;
  onNext: () => void;
  onPrevious: () => void;
  onSeek: (time: number) => void;
  onSetVolume: (v: number) => void;
  onSetLoop: (l: boolean) => void;
}

const formatTime = (seconds: number): string => {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
};

const typeIcon = (type: string) => {
  if (type.startsWith('video')) return <Video size={14} className="text-accent-cyan" />;
  if (type.startsWith('audio')) return <Music size={14} className="text-accent-green" />;
  if (type.startsWith('image')) return <Image size={14} className="text-yellow-400" />;
  return <Film size={14} className="text-gray-400" />;
};

export const MediaBrowserPanel: React.FC<Props> = ({
  playlist,
  playbackState,
  onAddMedia,
  onRemoveMedia,
  onPlay,
  onPause,
  onStop,
  onNext,
  onPrevious,
  onSeek,
  onSetVolume,
  onSetLoop,
}) => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const files = Array.from(e.dataTransfer.files);
    files.forEach(f => onAddMedia(f));
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    files.forEach(f => onAddMedia(f));
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const seekPercent = playbackState.duration > 0
    ? (playbackState.currentTime / playbackState.duration) * 100
    : 0;

  return (
    <div className="flex flex-col h-full">
      <div className="p-3 border-b border-border flex items-center gap-2 bg-white/5">
        <Film size={14} className="text-accent-cyan" />
        <h3 className="text-[10px] font-bold uppercase tracking-widest text-gray-500">Media Browser</h3>
      </div>

      <div className="flex-1 overflow-y-auto custom-scrollbar p-3 space-y-3">
        {/* Drop Zone */}
        <div
          onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
          onDragLeave={() => setIsDragging(false)}
          onDrop={handleDrop}
          onClick={() => fileInputRef.current?.click()}
          className={`w-full py-6 border border-dashed rounded-xl flex flex-col items-center justify-center gap-2 cursor-pointer transition-all ${
            isDragging
              ? 'border-accent-cyan bg-accent-cyan/10 text-accent-cyan'
              : 'border-border text-gray-500 hover:text-white hover:border-gray-500 hover:bg-white/5'
          }`}
        >
          <Upload size={20} />
          <span className="text-[10px] font-bold uppercase tracking-wider">Drop files or click to import</span>
          <input
            ref={fileInputRef}
            type="file"
            accept="video/*,audio/*,image/*"
            multiple
            onChange={handleFileSelect}
            className="hidden"
          />
        </div>

        {/* Playlist */}
        <div className="space-y-1">
          {playlist.length === 0 && (
            <div className="text-[9px] text-gray-600 italic p-6 text-center border border-dashed border-white/5 rounded">
              No media items
            </div>
          )}
          {playlist.map((item, idx) => {
            const isActive = playbackState.playlistIndex === idx;
            return (
              <motion.div
                key={item.id}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                className={`flex items-center gap-2 p-2 rounded-sm border transition-all group ${
                  isActive
                    ? 'bg-accent-cyan/10 border-accent-cyan/30 text-white'
                    : 'border-transparent text-gray-400 hover:bg-white/5'
                }`}
              >
                {/* Thumbnail or Icon */}
                <div className="w-10 h-7 bg-black rounded-sm overflow-hidden flex items-center justify-center flex-shrink-0 border border-white/5">
                  {item.thumbnail ? (
                    <img src={item.thumbnail} alt={item.name} className="w-full h-full object-cover" />
                  ) : (
                    typeIcon(item.type)
                  )}
                </div>

                <div className="flex-1 min-w-0">
                  <div className="text-[10px] font-medium truncate">{item.name}</div>
                  {item.duration != null && (
                    <div className="text-[8px] font-mono text-gray-500">{formatTime(item.duration)}</div>
                  )}
                </div>

                <button
                  onClick={(e) => { e.stopPropagation(); onRemoveMedia(item.id); }}
                  className="p-1 opacity-0 group-hover:opacity-100 text-gray-600 hover:text-accent-red hover:bg-accent-red/10 rounded transition-all"
                >
                  <Trash2 size={12} />
                </button>
              </motion.div>
            );
          })}
        </div>
      </div>

      {/* Transport Controls */}
      <div className="border-t border-border bg-black/20 p-3 space-y-2">
        {/* Now Playing */}
        {playbackState.currentItem && (
          <div className="text-[9px] text-gray-500 truncate text-center uppercase font-bold tracking-wider">
            {playbackState.currentItem.name}
          </div>
        )}

        {/* Seek Bar */}
        <div className="space-y-1">
          <input
            type="range"
            min={0}
            max={playbackState.duration || 1}
            step={0.1}
            value={playbackState.currentTime}
            onChange={(e) => onSeek(parseFloat(e.target.value))}
            className="w-full accent-accent-cyan h-1 bg-gray-800 rounded-lg appearance-none cursor-pointer"
          />
          <div className="flex justify-between text-[8px] font-mono text-gray-500">
            <span>{formatTime(playbackState.currentTime)}</span>
            <span>{formatTime(playbackState.duration)}</span>
          </div>
        </div>

        {/* Buttons */}
        <div className="flex items-center justify-center gap-2">
          <button onClick={onPrevious} className="p-1.5 text-gray-500 hover:text-white hover:bg-white/5 rounded transition-colors">
            <SkipBack size={14} />
          </button>
          {playbackState.isPlaying ? (
            <button onClick={onPause} className="p-2 bg-accent-cyan text-bg rounded-full hover:bg-accent-cyan/80 transition-colors">
              <Pause size={14} fill="currentColor" />
            </button>
          ) : (
            <button onClick={onPlay} className="p-2 bg-accent-cyan text-bg rounded-full hover:bg-accent-cyan/80 transition-colors">
              <Play size={14} fill="currentColor" />
            </button>
          )}
          <button onClick={onStop} className="p-1.5 text-gray-500 hover:text-white hover:bg-white/5 rounded transition-colors">
            <Square size={12} fill="currentColor" />
          </button>
          <button onClick={onNext} className="p-1.5 text-gray-500 hover:text-white hover:bg-white/5 rounded transition-colors">
            <SkipForward size={14} />
          </button>
        </div>

        {/* Volume + Loop */}
        <div className="flex items-center gap-3">
          <div className="flex-1 flex items-center gap-2">
            <span className="text-[8px] text-gray-500 uppercase">Vol</span>
            <input
              type="range"
              min={0}
              max={1}
              step={0.01}
              value={playbackState.volume}
              onChange={(e) => onSetVolume(parseFloat(e.target.value))}
              className="flex-1 accent-accent-cyan h-1 bg-gray-800 rounded-lg appearance-none cursor-pointer"
            />
            <span className="text-[8px] font-mono text-gray-500 w-6 text-right">{Math.round(playbackState.volume * 100)}%</span>
          </div>
          <button
            onClick={() => onSetLoop(!playbackState.loop)}
            className={`p-1.5 rounded transition-colors ${playbackState.loop ? 'text-accent-cyan bg-accent-cyan/10' : 'text-gray-500 hover:text-white hover:bg-white/5'}`}
          >
            <Repeat size={12} />
          </button>
        </div>
      </div>
    </div>
  );
};
