import React from 'react';
import { History, X, Play, Download, Trash2, Video } from 'lucide-react';
import { motion } from 'motion/react';
import { Recording } from '../../types';

interface RecordingGalleryProps {
  recordings: Recording[];
  onClose: () => void;
  onDelete: (id: string) => void;
  onPlay: (rec: Recording) => void;
}

export const RecordingGallery: React.FC<RecordingGalleryProps> = ({ recordings, onClose, onDelete, onPlay }) => (
  <motion.div
    initial={{ opacity: 0, x: 20 }}
    animate={{ opacity: 1, x: 0 }}
    exit={{ opacity: 0, x: 20 }}
    className="fixed inset-0 z-50 flex items-center justify-center p-8 bg-black/80 backdrop-blur-sm"
  >
    <div className="w-full max-w-4xl bg-bg border border-border rounded-lg shadow-2xl flex flex-col max-h-[80vh]">
      <div className="p-4 border-b border-border flex items-center justify-between">
        <div className="flex items-center gap-3">
          <History className="text-accent-cyan" size={20} />
          <h2 className="text-lg font-bold uppercase tracking-tight">Recording Gallery</h2>
        </div>
        <button onClick={onClose} className="p-2 hover:bg-white/5 rounded-full transition-colors">
          <X size={20} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-6 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {recordings.length === 0 ? (
          <div className="col-span-full flex flex-col items-center justify-center py-20 text-gray-500 gap-4">
            <Video size={48} className="opacity-20" />
            <p className="text-sm uppercase font-bold tracking-widest">No recordings found</p>
          </div>
        ) : (
          recordings.map(rec => (
            <div key={rec.id} className="rack-module group overflow-hidden">
              <div className="aspect-video bg-black relative">
                <img src={rec.thumbnail} alt={rec.fileName} className="w-full h-full object-cover opacity-60 group-hover:opacity-100 transition-opacity" />
                <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                  <button
                    onClick={() => onPlay(rec)}
                    className="w-12 h-12 bg-accent-cyan rounded-full flex items-center justify-center text-bg shadow-xl active:scale-90 transition-transform"
                  >
                    <Play size={24} fill="currentColor" />
                  </button>
                </div>
                <div className="absolute bottom-2 right-2 px-1.5 py-0.5 bg-black/80 text-[10px] font-mono rounded-sm">{rec.duration}</div>
              </div>
              <div className="p-3 space-y-2">
                <div className="flex justify-between items-start">
                  <div className="flex flex-col">
                    <span className="text-[11px] font-bold truncate max-w-[150px]">{rec.fileName}</span>
                    <span className="text-[9px] text-gray-500">{rec.timestamp}</span>
                  </div>
                  <span className="text-[9px] font-mono text-gray-400">{rec.size}</span>
                </div>
                <div className="flex gap-2 pt-2 border-t border-border/50">
                  <button className="flex-1 btn-hardware text-[9px] py-1 flex items-center justify-center gap-1.5">
                    <Download size={10} /> Download
                  </button>
                  <button
                    onClick={() => onDelete(rec.id)}
                    className="p-1.5 btn-hardware text-accent-red border-accent-red/20 hover:bg-accent-red/10"
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  </motion.div>
);
