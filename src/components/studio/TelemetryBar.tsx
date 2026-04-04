import React, { useState, useEffect, useRef } from 'react';
import { Radio, Activity, Cpu, AlertCircle, Network, Clock } from 'lucide-react';
import { Telemetry } from '../../types';

interface TelemetryBarProps {
  telemetry: Telemetry;
  isStreaming: boolean;
  isRecording: boolean;
  luminaConnected?: boolean;
  onOpenLuminaPair?: () => void;
}

function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}

export const TelemetryBar: React.FC<TelemetryBarProps> = ({ telemetry, isStreaming, isRecording, luminaConnected = false, onOpenLuminaPair }) => {
  // Stream duration timer
  const [streamDuration, setStreamDuration] = useState(0);
  const [recordDuration, setRecordDuration] = useState(0);
  const streamStartRef = useRef<number | null>(null);
  const recordStartRef = useRef<number | null>(null);

  useEffect(() => {
    if (isStreaming) {
      if (!streamStartRef.current) streamStartRef.current = Date.now();
      const interval = setInterval(() => {
        setStreamDuration(Math.floor((Date.now() - streamStartRef.current!) / 1000));
      }, 1000);
      return () => clearInterval(interval);
    } else {
      streamStartRef.current = null;
      setStreamDuration(0);
    }
  }, [isStreaming]);

  useEffect(() => {
    if (isRecording) {
      if (!recordStartRef.current) recordStartRef.current = Date.now();
      const interval = setInterval(() => {
        setRecordDuration(Math.floor((Date.now() - recordStartRef.current!) / 1000));
      }, 1000);
      return () => clearInterval(interval);
    } else {
      recordStartRef.current = null;
      setRecordDuration(0);
    }
  }, [isRecording]);

  return (
    <div className="h-10 bg-panel border-b border-border flex items-center px-4 gap-6 text-[11px] font-mono uppercase tracking-wider">
      <div className="flex items-center gap-4 border-r border-border pr-6">
        <div className="flex items-center gap-2">
          <div className="led-indicator bg-accent-green" />
          <span className="text-accent-green font-bold">READY</span>
        </div>
        <div className="flex items-center gap-2">
          <div className={`led-indicator ${isStreaming ? 'bg-accent-red animate-pulse' : 'bg-gray-700'}`} />
          <span className={isStreaming ? 'text-accent-red font-bold' : 'text-gray-500'}>LIVE</span>
          {isStreaming && (
            <span className="text-accent-red font-bold tabular-nums">{formatDuration(streamDuration)}</span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <div className={`led-indicator ${isRecording ? 'bg-accent-red animate-pulse' : 'bg-gray-700'}`} />
          <span className={isRecording ? 'text-accent-red font-bold' : 'text-gray-500'}>RECORDING</span>
          {isRecording && (
            <span className="text-accent-red font-bold tabular-nums">{formatDuration(recordDuration)}</span>
          )}
        </div>
      </div>

      {/* Lumina pairing indicator */}
      <button
        onClick={onOpenLuminaPair}
        title={luminaConnected ? 'Lumina connected — click to manage pairing' : 'Click to pair with Lumina Presenter'}
        className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md border transition-colors cursor-pointer ${
          luminaConnected
            ? 'border-emerald-700/60 bg-emerald-950/30 hover:bg-emerald-950/50'
            : 'border-zinc-700/50 bg-zinc-900/40 hover:border-zinc-600 hover:bg-zinc-800/50'
        }`}
      >
        <div className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${luminaConnected ? 'bg-emerald-400 animate-pulse' : 'bg-zinc-600'}`} />
        <span className={`text-[9px] font-bold uppercase tracking-widest ${luminaConnected ? 'text-emerald-400' : 'text-zinc-500'}`}>
          LUMINA
        </span>
      </button>

      <div className="flex items-center gap-6 text-gray-400">
        <div className="flex items-center gap-2">
          <Radio size={12} className={isStreaming ? 'text-accent-cyan' : 'text-gray-600'} />
          <span>Bitrate: <span className="text-white">{isStreaming ? telemetry.bitrate : '0.0 Mbps'}</span></span>
        </div>
        <div className="flex items-center gap-2">
          <Activity size={12} className="text-accent-cyan" />
          <span>FPS: <span className="text-white">{telemetry.fps}</span></span>
        </div>
        <div className="flex items-center gap-2">
          <Cpu size={12} className="text-accent-cyan" />
          <span>CPU: <span className="text-white">{telemetry.cpu}%</span></span>
        </div>
        <div className="flex items-center gap-2">
          <AlertCircle size={12} className="text-accent-red" />
          <span>Dropped: <span className="text-white">{telemetry.droppedFrames}</span></span>
        </div>
        <div className="flex items-center gap-2">
          <Network size={12} className={telemetry.network === 'excellent' ? 'text-accent-green' : 'text-accent-red'} />
          <span className="capitalize">{telemetry.network}</span>
        </div>
      </div>
    </div>
  );
};
