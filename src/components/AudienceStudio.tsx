import React, { useState, useEffect } from 'react';
import { MessageSquare, ThumbsUp, Heart, Send, Eye, EyeOff, Trash2, RefreshCw, Smartphone } from 'lucide-react';
import { AudienceMessage } from '../types';

interface AudienceStudioProps {
  messages: AudienceMessage[];
  setMessages: React.Dispatch<React.SetStateAction<AudienceMessage[]>>;
  activeMessageId: string | null;
  setActiveMessageId: (id: string | null) => void;
  brandColor: string;
  onOpenQrModal: () => void;
}

export const AudienceStudio: React.FC<AudienceStudioProps> = ({
  messages,
  setMessages,
  activeMessageId,
  setActiveMessageId,
  brandColor,
  onOpenQrModal
}) => {
  const [filter, setFilter] = useState<'All' | 'Q&A' | 'Prayer' | 'Testimony' | 'Welcome' | 'Poll'>('All');
  const [autoRotate, setAutoRotate] = useState(false);
  const [rotateInterval, setRotateInterval] = useState(10); // seconds

  // Auto-rotate logic
  useEffect(() => {
    if (!autoRotate || messages.length === 0) return;
    
    const interval = setInterval(() => {
      const visibleMsgs = filter === 'All' ? messages : messages.filter(m => m.type === filter);
      if (visibleMsgs.length === 0) return;
      
      const currentIndex = visibleMsgs.findIndex(m => m.id === activeMessageId);
      const nextIndex = (currentIndex + 1) % visibleMsgs.length;
      setActiveMessageId(visibleMsgs[nextIndex].id);
      
    }, rotateInterval * 1000);
    
    return () => clearInterval(interval);
  }, [autoRotate, rotateInterval, messages, activeMessageId, filter, setActiveMessageId]);

  const toggleMessage = (id: string) => {
    if (activeMessageId === id) {
      setActiveMessageId(null);
    } else {
      setActiveMessageId(id);
    }
  };

  const deleteMessage = (id: string) => {
    if (activeMessageId === id) setActiveMessageId(null);
    setMessages(prev => prev.filter(m => m.id !== id));
  };

  const clearAll = () => {
    setActiveMessageId(null);
    setMessages([]);
  };

  const filteredMessages = filter === 'All' ? messages : messages.filter(m => m.type === filter);

  return (
    <div className="h-full flex flex-col space-y-4">
      {/* Controls */}
      <div className="rack-module">
        <div className="bg-gray-800/50 p-2 border-b border-border flex items-center justify-between">
          <div className="flex items-center gap-2">
            <MessageSquare size={14} className="text-gray-400" />
            <span className="text-[11px] font-bold uppercase tracking-wider">Audience Studio</span>
          </div>
          <div className="flex items-center gap-2">
            <button 
              onClick={onOpenQrModal}
              className="text-[9px] px-2 py-1 rounded font-bold uppercase flex items-center gap-1 transition-colors bg-orange-500/20 text-orange-500 hover:bg-orange-500/30 border border-orange-500/50"
              title="Open Audience Portal QR"
            >
              <Smartphone size={10} />
              Portal Link
            </button>
            <button 
              onClick={() => setAutoRotate(!autoRotate)}
              className={`text-[9px] px-2 py-1 rounded font-bold uppercase flex items-center gap-1 transition-colors ${autoRotate ? 'bg-accent-cyan text-bg' : 'bg-gray-700 text-gray-300 hover:bg-gray-600'}`}
            >
              <RefreshCw size={10} className={autoRotate ? 'animate-spin-slow' : ''} />
              Auto-Rotate
            </button>
            <button 
              onClick={clearAll}
              className="p-1 text-gray-500 hover:text-accent-red transition-colors"
              title="Clear All Messages"
            >
              <Trash2 size={12} />
            </button>
          </div>
        </div>
        
        {autoRotate && (
          <div className="p-2 border-b border-white/5 bg-black/20 flex items-center justify-between">
            <span className="text-[9px] text-gray-400 uppercase">Rotation Speed</span>
            <div className="flex items-center gap-2">
              <input 
                type="range" 
                min="3" 
                max="30" 
                value={rotateInterval}
                onChange={(e) => setRotateInterval(parseInt(e.target.value))}
                className="w-24 accent-accent-cyan h-1 bg-gray-800 rounded-lg appearance-none cursor-pointer"
              />
              <span className="text-[9px] font-mono text-accent-cyan w-6 text-right">{rotateInterval}s</span>
            </div>
          </div>
        )}

        <div className="p-2 flex gap-1 overflow-x-auto custom-scrollbar">
          {['All', 'Q&A', 'Prayer', 'Testimony', 'Welcome', 'Poll'].map(t => (
            <button
              key={t}
              onClick={() => setFilter(t as any)}
              className={`px-2 py-1 rounded text-[9px] font-bold uppercase whitespace-nowrap transition-colors ${filter === t ? 'bg-white/10 text-white' : 'text-gray-500 hover:bg-white/5 hover:text-gray-300'}`}
            >
              {t}
            </button>
          ))}
        </div>
      </div>

      {/* Message List */}
      <div className="flex-1 overflow-y-auto custom-scrollbar space-y-2 pr-1">
        {filteredMessages.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-gray-600 space-y-2">
            <MessageSquare size={24} className="opacity-20" />
            <p className="text-[10px] uppercase tracking-wider">No messages yet</p>
          </div>
        ) : (
          filteredMessages.map(msg => {
            const isActive = activeMessageId === msg.id;
            
            let typeColor = 'text-gray-400';
            if (msg.type === 'Q&A') typeColor = 'text-accent-cyan';
            if (msg.type === 'Prayer') typeColor = 'text-purple-400';
            if (msg.type === 'Testimony') typeColor = 'text-yellow-400';
            if (msg.type === 'Welcome') typeColor = 'text-green-400';
            
            return (
              <div 
                key={msg.id} 
                className={`p-3 rounded-lg border transition-all ${isActive ? 'bg-white/10 border-white/20 shadow-lg' : 'bg-gray-800/30 border-white/5 hover:border-white/10'}`}
              >
                <div className="flex items-start justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <span className={`text-[9px] font-bold uppercase px-1.5 py-0.5 rounded bg-black/40 ${typeColor}`}>
                      {msg.type}
                    </span>
                    <span className="text-[10px] font-bold text-gray-300">{msg.author}</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <button 
                      onClick={() => toggleMessage(msg.id)}
                      className={`p-1.5 rounded transition-colors ${isActive ? 'bg-accent-cyan text-bg' : 'bg-black/40 text-gray-400 hover:text-white hover:bg-white/10'}`}
                      title={isActive ? "Hide from stream" : "Show on stream"}
                    >
                      {isActive ? <Eye size={12} /> : <EyeOff size={12} />}
                    </button>
                    <button 
                      onClick={() => deleteMessage(msg.id)}
                      className="p-1.5 rounded bg-black/40 text-gray-500 hover:text-accent-red hover:bg-accent-red/10 transition-colors"
                    >
                      <Trash2 size={12} />
                    </button>
                  </div>
                </div>
                <p className="text-[11px] text-gray-200 leading-relaxed">{msg.text}</p>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};
