import { useState, useEffect, useRef, useCallback } from 'react';
import { MediaPlayer } from '../lib/mediaPlayer';
import type { MediaItem, PlaybackState } from '../types';

export function useMediaPlayer() {
  const playerRef = useRef<MediaPlayer | null>(null);
  const [playlist, setPlaylist] = useState<MediaItem[]>([]);
  const [playbackState, setPlaybackState] = useState<PlaybackState>({
    currentItem: null, isPlaying: false, currentTime: 0,
    duration: 0, volume: 1, loop: false, playlistIndex: -1,
  });

  useEffect(() => {
    const player = new MediaPlayer();
    playerRef.current = player;

    player.on('timeupdate', () => setPlaybackState(player.getState()));
    player.on('play', () => setPlaybackState(player.getState()));
    player.on('pause', () => setPlaybackState(player.getState()));
    player.on('ended', () => setPlaybackState(player.getState()));
    player.on('loaded', () => setPlaybackState(player.getState()));

    return () => { player.destroy(); playerRef.current = null; };
  }, []);

  const addMedia = useCallback(async (file: File) => {
    const item = await MediaPlayer.fromFile(file);
    playerRef.current?.addItem(item);
    setPlaylist(playerRef.current?.getPlaylist() || []);
    return item;
  }, []);

  const removeMedia = useCallback((id: string) => {
    playerRef.current?.removeItem(id);
    setPlaylist(playerRef.current?.getPlaylist() || []);
  }, []);

  const play = useCallback(() => playerRef.current?.play(), []);
  const pause = useCallback(() => playerRef.current?.pause(), []);
  const stop = useCallback(() => playerRef.current?.stop(), []);
  const next = useCallback(() => playerRef.current?.next(), []);
  const previous = useCallback(() => playerRef.current?.previous(), []);
  const seek = useCallback((t: number) => playerRef.current?.seek(t), []);
  const setVolume = useCallback((v: number) => playerRef.current?.setVolume(v), []);
  const setLoop = useCallback((l: boolean) => playerRef.current?.setLoop(l), []);

  const getVideoElement = useCallback(() => playerRef.current?.getVideoElement() || null, []);

  return {
    playlist, playbackState, addMedia, removeMedia,
    play, pause, stop, next, previous, seek,
    setVolume, setLoop, getVideoElement,
  };
}
