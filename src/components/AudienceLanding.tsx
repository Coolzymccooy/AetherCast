import React, { useState, useEffect, useRef } from 'react';
import { motion } from 'motion/react';
import { io, Socket } from 'socket.io-client';
import { MessageSquare, Heart, Send, Sparkles, User, CheckCircle2 } from 'lucide-react';
import { AudienceMessage } from '../types';

export const AudienceLanding = () => {
  const [roomId, setRoomId] = useState<string>('');
  const [message, setMessage] = useState('');
  const [name, setName] = useState('');
  const [type, setType] = useState<'Q&A' | 'Prayer' | 'Testimony' | 'Welcome' | 'Poll'>('Q&A');
  const [status, setStatus] = useState<'idle' | 'sending' | 'success' | 'error'>('idle');
  const socketRef = useRef<Socket | null>(null);

  useEffect(() => {
    // Extract room ID from URL
    const params = new URLSearchParams(window.location.search);
    const room = params.get('room');
    if (room) {
      setRoomId(room);
    }

    const newSocket = io(window.location.origin);
    socketRef.current = newSocket;

    if (room) {
      newSocket.emit('join-room', room);
    }

    return () => {
      newSocket.disconnect();
    };
  }, []);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!message.trim() || !socketRef.current || !roomId) return;

    setStatus('sending');

    const newMsg: AudienceMessage = {
      id: `msg-${Date.now()}`,
      author: name.trim() || 'Anonymous',
      text: message.trim(),
      type,
      timestamp: Date.now(),
      visible: false
    };

    socketRef.current.emit('audience-message', { roomId, message: newMsg }, (ack: { ok: boolean }) => {
      if (ack?.ok) {
        setStatus('success');
        setMessage('');
        setTimeout(() => setStatus('idle'), 3000);
      } else {
        setStatus('error');
        setTimeout(() => setStatus('idle'), 3000);
      }
    });

    // Fallback: if server doesn't support ack, resolve success after timeout
    setTimeout(() => {
      setStatus(prev => prev === 'sending' ? 'success' : prev);
      if (status === 'sending') {
        setMessage('');
        setTimeout(() => setStatus('idle'), 3000);
      }
    }, 2000);
  };

  const typeOptions = [
    { value: 'Q&A', label: 'Ask a Question', icon: <MessageSquare size={16} /> },
    { value: 'Prayer', label: 'Prayer Request', icon: <Heart size={16} /> },
    { value: 'Testimony', label: 'Testimony', icon: <Sparkles size={16} /> },
    { value: 'Welcome', label: 'Welcome Note', icon: <User size={16} /> },
    { value: 'Poll', label: 'Reaction / Poll', icon: <CheckCircle2 size={16} /> },
  ];

  if (!roomId) {
    return (
      <div className="min-h-screen bg-bg text-white flex items-center justify-center p-4">
        <div className="max-w-md w-full bg-panel border border-border rounded-xl p-8 text-center">
          <h1 className="text-2xl font-bold mb-4">Invalid Link</h1>
          <p className="text-gray-400">Please scan the QR code from the studio to connect.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-bg text-white p-4 md:p-8 flex flex-col items-center">
      <div className="max-w-md w-full space-y-6">
        <div className="text-center mb-8">
          <div className="w-16 h-16 bg-accent-cyan/10 rounded-full flex items-center justify-center mx-auto mb-4 border border-accent-cyan/30">
            <MessageSquare size={32} className="text-accent-cyan" />
          </div>
          <h1 className="text-2xl font-bold">Audience Portal</h1>
          <p className="text-gray-400 text-sm mt-2">Send a message directly to the studio.</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-6">
          <div className="space-y-3">
            <label className="text-xs font-bold uppercase tracking-wider text-gray-500">Message Type</label>
            <div className="grid grid-cols-1 gap-2">
              {typeOptions.map(opt => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setType(opt.value as any)}
                  className={`flex items-center gap-3 p-4 rounded-xl border transition-all ${
                    type === opt.value 
                      ? 'bg-orange-500 border-orange-500 text-white' 
                      : 'bg-panel border-border text-gray-400 hover:border-gray-600'
                  }`}
                >
                  <div className={type === opt.value ? 'text-white' : 'text-gray-500'}>
                    {opt.icon}
                  </div>
                  <span className="font-medium">{opt.label}</span>
                  {type === opt.value && (
                    <CheckCircle2 size={16} className="ml-auto text-white" />
                  )}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-3">
            <label className="text-xs font-bold uppercase tracking-wider text-gray-500">Your Message</label>
            <textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="Type your message here..."
              className="w-full h-32 bg-panel border border-border rounded-xl p-4 text-white placeholder-gray-600 focus:outline-none focus:border-accent-cyan resize-none"
              required
            />
          </div>

          <div className="space-y-3">
            <label className="text-xs font-bold uppercase tracking-wider text-gray-500">Your Name (Optional)</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. John Doe"
              className="w-full bg-panel border border-border rounded-xl p-4 text-white placeholder-gray-600 focus:outline-none focus:border-accent-cyan"
            />
          </div>

          {status === 'error' && (
            <div className="p-4 bg-accent-red/10 border border-accent-red/30 rounded-xl text-accent-red text-sm text-center">
              Failed to send message. Please try again.
            </div>
          )}

          <button
            type="submit"
            disabled={status === 'sending' || !message.trim()}
            className={`w-full py-4 rounded-xl font-bold text-lg transition-all flex items-center justify-center gap-2 ${
              status === 'success'
                ? 'bg-green-500 text-white'
                : 'bg-blue-600 hover:bg-blue-700 text-white disabled:opacity-50 disabled:cursor-not-allowed'
            }`}
          >
            {status === 'sending' ? (
              <span className="animate-pulse">Sending...</span>
            ) : status === 'success' ? (
              <>
                <CheckCircle2 size={20} />
                Sent Successfully!
              </>
            ) : (
              <>
                <Send size={20} />
                Submit Message
              </>
            )}
          </button>
        </form>
      </div>
    </div>
  );
};
