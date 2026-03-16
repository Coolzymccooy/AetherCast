import { useState, useRef, useCallback } from 'react';
import { ReplayBuffer } from '../lib/replayBuffer';
import type { ReplayClip } from '../types';

export function useReplay(bufferDurationSec = 300) {
  const bufferRef = useRef<ReplayBuffer | null>(null);
  const [isBuffering, setIsBuffering] = useState(false);
  const [clips, setClips] = useState<ReplayClip[]>([]);
  const [bufferStats, setBufferStats] = useState({ bufferSizeMB: 0, frameCount: 0, oldestFrameAge: 0 });

  const startBuffer = useCallback((canvas: HTMLCanvasElement, audioStream?: MediaStream) => {
    if (bufferRef.current) bufferRef.current.destroy();
    const buffer = new ReplayBuffer({ bufferDurationSec, fps: 30, quality: 0.7 });
    buffer.start(canvas, audioStream);
    bufferRef.current = buffer;
    setIsBuffering(true);

    // Poll stats
    const interval = setInterval(() => {
      if (bufferRef.current) setBufferStats(bufferRef.current.getStats());
    }, 2000);

    return () => clearInterval(interval);
  }, [bufferDurationSec]);

  const stopBuffer = useCallback(() => {
    bufferRef.current?.stop();
    setIsBuffering(false);
  }, []);

  const captureReplay = useCallback((durationSec: number, playbackRate = 1) => {
    if (!bufferRef.current) return null;
    const clip = bufferRef.current.createClip(durationSec, playbackRate);
    const replayClip: ReplayClip = {
      id: clip.id,
      startTime: clip.startTime,
      endTime: clip.endTime,
      duration: clip.duration,
    };
    setClips(prev => [replayClip, ...prev]);
    return replayClip;
  }, []);

  const playReplay = useCallback(async (clip: ReplayClip) => {
    if (!bufferRef.current) return null;
    const internalClip = bufferRef.current.createClip(clip.duration / 1000);
    return bufferRef.current.playClip(internalClip);
  }, []);

  const deleteClip = useCallback((id: string) => {
    setClips(prev => prev.filter(c => c.id !== id));
  }, []);

  return {
    isBuffering, clips, bufferStats,
    startBuffer, stopBuffer,
    captureReplay, playReplay, deleteClip,
  };
}
