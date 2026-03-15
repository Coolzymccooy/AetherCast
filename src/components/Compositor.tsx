import React, { useEffect, useRef } from 'react';
import { Scene, Source, AudienceMessage } from '../types';

interface CompositorProps {
  activeScene: Scene;
  sources: Source[];
  isStreaming: boolean;
  webcamStream: MediaStream | null;
  remoteStreams?: Map<string, MediaStream>;
  screenStream?: MediaStream | null;
  transitionType?: string;
  layout?: string;
  lowerThirds?: {
    show: boolean;
    name: string;
    title: string;
    accentColor: string;
  };
  graphics?: {
    showBug: boolean;
    showSocials: boolean;
  };
  backgroundImage?: string | null;
  theme?: string;
  background?: string;
  frameStyle?: string;
  motionStyle?: string;
  brandColor?: string;
  camoSettings?: any; // Using any for now, or import CamoSettings
  sourceSwap?: boolean;
  audienceMessages?: AudienceMessage[];
  activeMessageId?: string | null;
}

export const Compositor: React.FC<CompositorProps> = ({ 
  activeScene, 
  sources, 
  isStreaming, 
  webcamStream,
  remoteStreams = new Map(),
  screenStream = null,
  transitionType = 'Cut',
  layout = 'Solo',
  lowerThirds = { show: false, name: '', title: '', accentColor: '#00E5FF' },
  graphics = { showBug: false, showSocials: false },
  backgroundImage = null,
  theme = 'Broadcast Studio',
  background = 'Gradient Motion',
  frameStyle = 'Glass',
  motionStyle = 'Snappy',
  brandColor = '#5d28d9',
  camoSettings,
  sourceSwap = false,
  audienceMessages = [],
  activeMessageId = null
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const screenVideoRef = useRef<HTMLVideoElement | null>(null);
  const remoteVideoRefs = useRef<Map<string, HTMLVideoElement>>(new Map());
  const requestRef = useRef<number>(0);
  
  // Transition state
  const prevSceneRef = useRef<Scene | null>(null);
  const transitionProgressRef = useRef<number>(1); // 1 = transition finished
  const lastSceneIdRef = useRef<string>(activeScene.id);

  useEffect(() => {
    if (activeScene.id !== lastSceneIdRef.current) {
      if (transitionType === 'Cut') {
        transitionProgressRef.current = 1;
      } else {
        // We'll just trigger a fade/wipe on the new scene
        transitionProgressRef.current = 0;
      }
      lastSceneIdRef.current = activeScene.id;
    }
  }, [activeScene, transitionType]);

  useEffect(() => {
    if (webcamStream) {
      const video = document.createElement('video');
      video.srcObject = webcamStream;
      video.muted = true;
      video.playsInline = true;
      video.play().catch(err => console.error('Compositor: Video play error:', err));
      videoRef.current = video;
      
      return () => {
        video.pause();
        video.srcObject = null;
      };
    } else {
      videoRef.current = null;
    }
  }, [webcamStream]);

  useEffect(() => {
    if (screenStream) {
      const video = document.createElement('video');
      video.srcObject = screenStream;
      video.muted = true;
      video.playsInline = true;
      video.play().catch(err => console.error('Compositor: Screen video play error:', err));
      screenVideoRef.current = video;
      
      return () => {
        video.pause();
        video.srcObject = null;
      };
    } else {
      screenVideoRef.current = null;
    }
  }, [screenStream]);

  useEffect(() => {
    // Sync remote video elements
    remoteStreams.forEach((stream, id) => {
      if (!remoteVideoRefs.current.has(id)) {
        const video = document.createElement('video');
        video.srcObject = stream;
        video.muted = true;
        video.playsInline = true;
        video.play().catch(err => console.error('Compositor: Remote video play error:', err));
        remoteVideoRefs.current.set(id, video);
      }
    });

    // Cleanup old ones
    Array.from(remoteVideoRefs.current.keys()).forEach(id => {
      if (!remoteStreams.has(id)) {
        const v = remoteVideoRefs.current.get(id);
        if (v) {
          v.pause();
          v.srcObject = null;
        }
        remoteVideoRefs.current.delete(id);
      }
    });
  }, [remoteStreams]);

  const drawFramedVideo = (
    ctx: CanvasRenderingContext2D, 
    media: HTMLVideoElement | HTMLImageElement | null, 
    label: string, 
    baseX: number, 
    baseY: number, 
    w: number, 
    h: number, 
    frameCount: number,
    color: string = '#00E5FF',
    settings?: any
  ) => {
    ctx.save();
    
    const shape = settings?.shape || 'Rect';
    const radius = settings?.cornerRadius !== undefined ? settings.cornerRadius : (frameStyle === 'Floating' ? 16 : frameStyle === 'Glass' ? 12 : 0);
    const scale = settings?.scale || 1.0;
    const x = baseX + (settings?.x || 0);
    const y = baseY + (settings?.y || 0);
    
    // Draw shadow first (before clipping)
    if (frameStyle === 'Floating') {
      ctx.save();
      ctx.shadowColor = 'rgba(0,0,0,0.5)';
      ctx.shadowBlur = 30;
      ctx.shadowOffsetY = 10;
      ctx.fillStyle = '#000'; // Need a fill to cast shadow
      ctx.beginPath();
      if (shape === 'Circle') {
        ctx.arc(x + w/2, y + h/2, Math.min(w, h)/2, 0, Math.PI * 2);
      } else {
        ctx.roundRect(x, y, w, h, radius);
      }
      ctx.fill();
      ctx.restore();
    } else if (frameStyle === 'Glass') {
      ctx.save();
      ctx.shadowColor = 'rgba(0,0,0,0.3)';
      ctx.shadowBlur = 20;
      ctx.fillStyle = '#000';
      ctx.beginPath();
      if (shape === 'Circle') {
        ctx.arc(x + w/2, y + h/2, Math.min(w, h)/2, 0, Math.PI * 2);
      } else {
        ctx.roundRect(x, y, w, h, radius);
      }
      ctx.fill();
      ctx.restore();
    }

    // Clip path
    ctx.beginPath();
    if (shape === 'Circle') {
      ctx.arc(x + w/2, y + h/2, Math.min(w, h)/2, 0, Math.PI * 2);
    } else {
      if (radius > 0) {
        ctx.roundRect(x, y, w, h, radius);
      } else {
        ctx.rect(x, y, w, h);
      }
    }
    ctx.clip();

    // Apply filters
    if (settings?.filter && settings.filter !== 'None') {
      switch (settings.filter) {
        case 'B&W': ctx.filter = 'grayscale(100%)'; break;
        case 'Sepia': ctx.filter = 'sepia(100%)'; break;
        case 'Vivid': ctx.filter = 'saturate(200%) contrast(120%)'; break;
        case 'Cool': ctx.filter = 'hue-rotate(180deg) saturate(150%)'; break;
        case 'Dim': ctx.filter = 'brightness(50%)'; break;
      }
    }

    // Apply scale and crop
    let drawX = x;
    let drawY = y;
    let drawW = w;
    let drawH = h;

    if (settings?.crop) {
      const cropL = settings.crop.left / 100;
      const cropR = settings.crop.right / 100;
      const cropT = settings.crop.top / 100;
      const cropB = settings.crop.bottom / 100;
      
      const visibleW = 1 - cropL - cropR;
      const visibleH = 1 - cropT - cropB;
      
      if (visibleW > 0 && visibleH > 0) {
        drawW = w / visibleW;
        drawH = h / visibleH;
        drawX = x - (cropL * drawW);
        drawY = y - (cropT * drawH);
      }
    }

    if (scale !== 1.0) {
      const cx = x + w/2;
      const cy = y + h/2;
      ctx.translate(cx, cy);
      ctx.scale(scale, scale);
      ctx.translate(-cx, -cy);
    }

    if (media) {
      if (media instanceof HTMLVideoElement && media.readyState >= 2) {
        ctx.drawImage(media, drawX, drawY, drawW, drawH);
      } else if (media instanceof HTMLImageElement && media.complete) {
        ctx.drawImage(media, drawX, drawY, drawW, drawH);
      } else {
        drawSimulatedFeed(ctx, label, drawX, drawY, drawW, drawH, frameCount, color);
      }
    } else {
      drawSimulatedFeed(ctx, label, drawX, drawY, drawW, drawH, frameCount, color);
    }
    
    ctx.restore(); // Restores from clip, scale, and filter

    // Draw borders
    if (frameStyle === 'Glass') {
      ctx.save();
      ctx.strokeStyle = 'rgba(255,255,255,0.2)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      if (shape === 'Circle') {
        ctx.arc(x + w/2, y + h/2, Math.min(w, h)/2, 0, Math.PI * 2);
      } else {
        ctx.roundRect(x, y, w, h, radius);
      }
      ctx.stroke();
      ctx.restore();
    } else if (frameStyle === 'Flat') {
      ctx.save();
      ctx.strokeStyle = brandColor;
      ctx.lineWidth = 4;
      ctx.beginPath();
      if (shape === 'Circle') {
        ctx.arc(x + w/2, y + h/2, Math.min(w, h)/2, 0, Math.PI * 2);
      } else {
        if (radius > 0) {
          ctx.roundRect(x, y, w, h, radius);
        } else {
          ctx.rect(x, y, w, h);
        }
      }
      ctx.stroke();
      ctx.restore();
    }
  };

  const drawScene = (ctx: CanvasRenderingContext2D, scene: Scene, frameCount: number) => {
    const { width, height } = ctx.canvas;
    
    // Get all remote videos, prioritizing actual WebRTC streams over simulated local ones
    const remoteVideos = Array.from(remoteVideoRefs.current.entries())
      .filter(([id]) => !id.startsWith('local-cam-'))
      .map(([, video]) => video);
      
    const localCam2 = remoteVideoRefs.current.get('local-cam-2');
    const screenVideo = screenVideoRef.current;

    let primaryVideo = videoRef.current;
    let secondaryVideo = screenVideo || remoteVideos[0] || localCam2;

    if (sourceSwap) {
      const temp = primaryVideo;
      primaryVideo = secondaryVideo as any;
      secondaryVideo = temp as any;
    }

    if (scene.type === 'CAM') {
      const video = primaryVideo;
      
      if (layout === 'Framed Solo') {
        const padding = 80;
        const w = width - (padding * 2);
        const h = w * (9/16);
        const y = (height - h) / 2;
        const x = padding;
        
        if (scene.name === 'Cam 2') {
          const remoteVideo = secondaryVideo;
          drawFramedVideo(ctx, remoteVideo || null, 'REMOTE CAM 2', x, y, w, h, frameCount, '#00E5FF', camoSettings);
        } else {
          drawFramedVideo(ctx, video, 'LOCAL CAM 1', x, y, w, h, frameCount, '#FF4C4C', camoSettings);
        }
      } else if (layout === 'Freeform') {
        const w = width / 2;
        const h = w * (9/16);
        const x = (width - w) / 2;
        const y = (height - h) / 2;
        
        if (scene.name === 'Cam 2') {
          const remoteVideo = remoteVideos[0] || localCam2;
          drawFramedVideo(ctx, remoteVideo || null, 'REMOTE CAM 2', x, y, w, h, frameCount, '#00E5FF', camoSettings);
        } else {
          drawFramedVideo(ctx, video, 'LOCAL CAM 1', x, y, w, h, frameCount, '#FF4C4C', camoSettings);
        }
      } else {
        if (scene.name === 'Cam 2') {
          const remoteVideo = remoteVideos[0] || localCam2;
          if (remoteVideo && remoteVideo.readyState >= 2) {
            ctx.drawImage(remoteVideo, 0, 0, width, height);
          } else {
            drawSimulatedFeed(ctx, 'REMOTE CAM 2', 0, 0, width, height, frameCount);
          }
        } else {
          if (video && video.readyState >= 2) {
            ctx.drawImage(video, 0, 0, width, height);
          } else {
            drawSimulatedFeed(ctx, 'LOCAL CAM 1', 0, 0, width, height, frameCount);
          }
        }
      }
    } else if (scene.type === 'DUAL') {
      const video = primaryVideo;
      const remoteVideo = secondaryVideo;
      
      if (layout === 'Side-by-Side' || layout === 'Solo') {
        const padding = 40;
        const w = (width / 2) - (padding * 1.5);
        const h = w * (9/16);
        const y = (height - h) / 2;

        drawFramedVideo(ctx, video, 'LOCAL CAM 1', padding, y, w, h, frameCount, '#FF4C4C');
        drawFramedVideo(ctx, remoteVideo, 'REMOTE CAM 2', width / 2 + padding / 2, y, w, h, frameCount + 100, '#00E5FF');
      } else if (layout === 'Picture-in-Pic') {
        // Remote as background, local as PiP
        if (remoteVideo && remoteVideo.readyState >= 2) {
          ctx.drawImage(remoteVideo, 0, 0, width, height);
        } else {
          drawSimulatedFeed(ctx, 'REMOTE CAM 2', 0, 0, width, height, frameCount);
        }

        const pipW = width / 4;
        const pipH = height / 4;
        const pipX = width - pipW - 40;
        const pipY = height - pipH - 40;

        drawFramedVideo(ctx, video, 'LOCAL CAM 1', pipX, pipY, pipW, pipH, frameCount + 200, '#FF4C4C', camoSettings);
      }
    } else if (scene.type === 'SCREEN') {
      const video = primaryVideo;
      const screenVideo = secondaryVideo;
      
      if (layout === 'Projector + Spk') {
        // Screen share takes up most of the space, slightly offset to the left
        const padding = 60;
        const screenW = width * 0.75;
        const screenH = screenW * (9/16);
        const screenX = padding;
        const screenY = (height - screenH) / 2;

        // Camera overlaps the bottom right of the screen share
        const camW = width * 0.25;
        const camH = camW * (9/16);
        const camX = width - camW - padding;
        const camY = height - camH - padding;

        // Draw Screen
        drawFramedVideo(ctx, screenVideo, 'Screen Share', screenX, screenY, screenW, screenH, frameCount, '#00E5FF');

        // Draw Camera
        drawFramedVideo(ctx, video, 'LOCAL CAM 1', camX, camY, camW, camH, frameCount, '#FF4C4C', camoSettings);

      } else if (layout === 'Split Left') {
        const padding = 40;
        const w = (width / 2) - (padding * 1.5);
        const h = w * (9/16);
        const y = (height - h) / 2;
        
        drawFramedVideo(ctx, screenVideo, 'Screen Share', padding, y, w, h, frameCount, '#00E5FF');
        drawFramedVideo(ctx, video, 'LOCAL CAM 1', width / 2 + padding / 2, y, w, h, frameCount, '#FF4C4C');

      } else if (layout === 'Split Right') {
        const padding = 40;
        const w = (width / 2) - (padding * 1.5);
        const h = w * (9/16);
        const y = (height - h) / 2;

        drawFramedVideo(ctx, video, 'LOCAL CAM 1', padding, y, w, h, frameCount, '#FF4C4C');
        drawFramedVideo(ctx, screenVideo, 'Screen Share', width / 2 + padding / 2, y, w, h, frameCount, '#00E5FF');

      } else if (layout === 'Freeform') {
        const screenW = width * 0.8;
        const screenH = screenW * (9/16);
        const screenX = (width - screenW) / 2;
        const screenY = (height - screenH) / 2;
        
        const camW = width * 0.2;
        const camH = camW * (9/16);
        const camX = width - camW - 40;
        const camY = height - camH - 40;

        drawFramedVideo(ctx, screenVideo, 'Screen Share', screenX, screenY, screenW, screenH, frameCount, '#00E5FF');
        drawFramedVideo(ctx, video, 'LOCAL CAM 1', camX, camY, camW, camH, frameCount, '#FF4C4C', camoSettings);
      } else if (layout === 'PiP') {
        if (screenVideo && screenVideo.readyState >= 2) {
          ctx.drawImage(screenVideo, 0, 0, width, height);
        } else {
          drawSimulatedFeed(ctx, 'Screen Share', 0, 0, width, height, frameCount, '#00E5FF');
        }

        const pipW = width / 4;
        const pipH = height / 4;
        const pipX = width - pipW - 40;
        const pipY = height - pipH - 40;

        drawFramedVideo(ctx, video, 'LOCAL CAM 1', pipX, pipY, pipW, pipH, frameCount + 200, '#FF4C4C', camoSettings);

      } else {
        // Default full screen
        if (screenVideo && screenVideo.readyState >= 2) {
          ctx.drawImage(screenVideo, 0, 0, width, height);
        } else {
          drawSimulatedFeed(ctx, 'Screen Share', 0, 0, width, height, frameCount, '#00E5FF');
        }
      }
    } else if (scene.type === 'GRID') {
      const cols = 2;
      const rows = 2;
      const padding = 20;
      const w = (width / cols) - (padding * 1.5);
      const h = w * (9/16);
      const startY = (height - (h * 2 + padding)) / 2;
      
      const video = primaryVideo;
      for (let i = 0; i < 4; i++) {
        const col = i % cols;
        const row = Math.floor(i / cols);
        const x = padding + col * (w + padding);
        const y = startY + row * (h + padding);
        
        if (i === 0) {
           drawFramedVideo(ctx, video, 'LOCAL CAM 1', x, y, w, h, frameCount, '#FF4C4C');
        } else {
           const remoteVideo = remoteVideos[i-1];
           drawFramedVideo(ctx, remoteVideo || null, `REMOTE CAM ${i + 1}`, x, y, w, h, frameCount + i * 50, '#00E5FF');
        }
      }
    } else if (scene.type === 'PODCAST') {
      const video = primaryVideo;
      const remoteVideo = secondaryVideo;

      if (remoteVideo && remoteVideo.readyState >= 2) {
        ctx.drawImage(remoteVideo, 0, 0, width, height);
      } else {
        drawSimulatedFeed(ctx, 'GUEST (REMOTE)', 0, 0, width, height, frameCount);
      }

      const pipW = width / 4;
      const pipH = height / 4;
      const pipX = width - pipW - 40;
      const pipY = height - pipH - 40;

      drawFramedVideo(ctx, video, 'HOST', pipX, pipY, pipW, pipH, frameCount + 200, '#FF4C4C', camoSettings);
    }
  };

  const bgImageRef = useRef<HTMLImageElement | null>(null);

  useEffect(() => {
    if (backgroundImage) {
      const img = new Image();
      img.src = backgroundImage;
      img.onload = () => {
        bgImageRef.current = img;
      };
    } else {
      bgImageRef.current = null;
    }
  }, [backgroundImage]);

  const draw = (ctx: CanvasRenderingContext2D, frameCount: number) => {
    const { width, height } = ctx.canvas;

    // 1. Draw Background
    if (bgImageRef.current) {
      if (camoSettings) {
        drawFramedVideo(ctx, bgImageRef.current, '', 0, 0, width, height, frameCount, brandColor, camoSettings);
      } else {
        ctx.drawImage(bgImageRef.current, 0, 0, width, height);
      }
    } else if (background === 'Gradient Motion') {
      const gradient = ctx.createLinearGradient(0, 0, width, height);
      gradient.addColorStop(0, brandColor);
      gradient.addColorStop(0.5, '#0f172a');
      gradient.addColorStop(1, '#000000');
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, width, height);
      
      // Add subtle motion effect
      const offset = (frameCount * 0.5) % 100;
      ctx.fillStyle = `rgba(255, 255, 255, 0.02)`;
      ctx.beginPath();
      ctx.arc(width * 0.8 + offset, height * 0.2 + offset, 400, 0, Math.PI * 2);
      ctx.fill();
    } else if (background === 'Brand Theme') {
      ctx.fillStyle = brandColor;
      ctx.fillRect(0, 0, width, height);
    } else if (background === 'Light Studio') {
      const gradient = ctx.createRadialGradient(width/2, height/2, 0, width/2, height/2, width);
      gradient.addColorStop(0, '#ffffff');
      gradient.addColorStop(1, '#e2e8f0');
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, width, height);
    } else if (background === 'Blur Camera') {
      const video = videoRef.current;
      if (video && video.readyState >= 2) {
        ctx.save();
        ctx.filter = 'blur(40px) brightness(0.5)';
        ctx.drawImage(video, 0, 0, width, height);
        ctx.restore();
      } else {
        ctx.fillStyle = '#111';
        ctx.fillRect(0, 0, width, height);
      }
    } else if (background === 'Neon Pulse') {
      ctx.fillStyle = '#050505';
      ctx.fillRect(0, 0, width, height);
      const pulse = Math.sin(frameCount * 0.05) * 0.5 + 0.5;
      ctx.fillStyle = `rgba(255, 0, 255, ${pulse * 0.1})`;
      ctx.fillRect(0, 0, width, height);
      ctx.strokeStyle = `rgba(0, 255, 255, ${0.1 + pulse * 0.1})`;
      ctx.lineWidth = 2;
      for (let i = 0; i < width; i += 100) {
        ctx.beginPath();
        ctx.moveTo(i, 0);
        ctx.lineTo(i, height);
        ctx.stroke();
      }
    } else if (background === 'Cyberpunk') {
      ctx.fillStyle = '#0a0a1a';
      ctx.fillRect(0, 0, width, height);
      ctx.strokeStyle = 'rgba(255, 0, 128, 0.2)';
      ctx.lineWidth = 1;
      for (let i = 0; i < width; i += 40) {
        ctx.beginPath();
        ctx.moveTo(i, 0);
        ctx.lineTo(i, height);
        ctx.stroke();
      }
      for (let i = 0; i < height; i += 40) {
        ctx.beginPath();
        ctx.moveTo(0, i);
        ctx.lineTo(width, i);
        ctx.stroke();
      }
    } else if (background === 'Minimalist') {
      ctx.fillStyle = '#fafafa';
      ctx.fillRect(0, 0, width, height);
      ctx.fillStyle = '#f0f0f0';
      ctx.beginPath();
      ctx.arc(width, 0, width * 0.4, 0, Math.PI * 2);
      ctx.fill();
    } else if (background === 'Cosmic') {
      ctx.fillStyle = '#0B0B1A';
      ctx.fillRect(0, 0, width, height);
      
      // Stars
      ctx.fillStyle = '#FFF';
      for (let i = 0; i < 100; i++) {
        const x = (Math.sin(i * 123.45) * 0.5 + 0.5) * width;
        const y = (Math.cos(i * 67.89) * 0.5 + 0.5) * height;
        const size = (Math.sin(i * 10 + frameCount * 0.05) * 0.5 + 0.5) * 2;
        ctx.beginPath();
        ctx.arc(x, y, size, 0, Math.PI * 2);
        ctx.fill();
      }
    } else if (background === 'Retro Wave') {
      // Sunset gradient
      const gradient = ctx.createLinearGradient(0, 0, 0, height);
      gradient.addColorStop(0, '#1A0B2E');
      gradient.addColorStop(0.5, '#D9138A');
      gradient.addColorStop(0.5, '#E2D810');
      gradient.addColorStop(1, '#120458');
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, width, height);
      
      // Sun
      ctx.fillStyle = '#F3E600';
      ctx.beginPath();
      ctx.arc(width / 2, height / 2, 150, 0, Math.PI * 2);
      ctx.fill();

      // Grid
      ctx.strokeStyle = '#00F0FF';
      ctx.lineWidth = 2;
      const gridY = height / 2;
      for (let y = gridY; y < height; y += 20 + (y - gridY) * 0.1) {
        ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(width, y); ctx.stroke();
      }
    } else if (background === 'Abstract') {
      ctx.fillStyle = '#FFFFFF';
      ctx.fillRect(0, 0, width, height);
      
      // Floating shapes
      for (let i = 0; i < 5; i++) {
        const x = (Math.sin(frameCount * 0.01 + i) * 0.4 + 0.5) * width;
        const y = (Math.cos(frameCount * 0.015 + i) * 0.4 + 0.5) * height;
        const radius = 100 + i * 50;
        
        ctx.beginPath();
        ctx.arc(x, y, radius, 0, Math.PI * 2);
        ctx.fillStyle = `hsla(${i * 60}, 70%, 60%, 0.1)`;
        ctx.fill();
      }
    } else {
      if (theme === 'Cyberpunk' || theme === 'Neon Night') {
        ctx.fillStyle = '#050505';
        ctx.fillRect(0, 0, width, height);
        ctx.strokeStyle = 'rgba(0, 229, 255, 0.1)';
        ctx.lineWidth = 1;
        for (let i = 0; i < width; i += 50) {
          ctx.beginPath();
          ctx.moveTo(i, 0);
          ctx.lineTo(i, height);
          ctx.stroke();
        }
        for (let i = 0; i < height; i += 50) {
          ctx.beginPath();
          ctx.moveTo(0, i);
          ctx.lineTo(width, i);
          ctx.stroke();
        }
      } else if (theme === 'Minimal' || theme === 'Clean Studio') {
        ctx.fillStyle = '#F3F4F6';
        ctx.fillRect(0, 0, width, height);
      } else if (theme === 'Midnight') {
        ctx.fillStyle = '#0F172A';
        ctx.fillRect(0, 0, width, height);
      } else {
        ctx.fillStyle = '#0B0F14';
        ctx.fillRect(0, 0, width, height);
      }
    }

    // 2. Handle Transitions
    if (transitionProgressRef.current < 1) {
      let speed = 0.05;
      if (motionStyle === 'Smooth') speed = 0.02;
      else if (motionStyle === 'Gentle') speed = 0.04;
      else if (motionStyle === 'Snappy') speed = 0.08;

      transitionProgressRef.current += speed;
      if (transitionProgressRef.current > 1) transitionProgressRef.current = 1;

      const progress = transitionProgressRef.current;

      if (transitionType === 'Fade') {
        // Draw current scene with globalAlpha
        drawScene(ctx, activeScene, frameCount);
        ctx.fillStyle = `rgba(11, 15, 20, ${1 - progress})`;
        ctx.fillRect(0, 0, width, height);
      } else if (transitionType === 'Wipe') {
        drawScene(ctx, activeScene, frameCount);
        ctx.save();
        ctx.beginPath();
        ctx.rect(width * progress, 0, width * (1 - progress), height);
        ctx.clip();
        ctx.fillStyle = '#0B0F14';
        ctx.fillRect(0, 0, width, height);
        ctx.restore();
      } else {
        drawScene(ctx, activeScene, frameCount);
      }
    } else {
      drawScene(ctx, activeScene, frameCount);
    }

    // 3. Draw Overlays (Mock Graphics)
    drawOverlays(ctx, width, height, frameCount);

    // 4. Draw "Streaming" Indicator
    if (isStreaming) {
      ctx.fillStyle = '#FF4C4C';
      ctx.beginPath();
      ctx.arc(width - 30, 30, 6, 0, Math.PI * 2);
      ctx.fill();
      
      ctx.fillStyle = '#FFFFFF';
      ctx.font = 'bold 12px Inter';
      ctx.textAlign = 'right';
      ctx.fillText('LIVE', width - 45, 34);
    }
  };

  const drawSimulatedFeed = (
    ctx: CanvasRenderingContext2D, 
    label: string, 
    x: number, 
    y: number, 
    w: number, 
    h: number, 
    frameCount: number,
    color: string = '#111821'
  ) => {
    // Background
    ctx.fillStyle = color;
    ctx.fillRect(x, y, w, h);

    // Dynamic pattern to simulate motion
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.05)';
    ctx.lineWidth = 1;
    for (let i = 0; i < 10; i++) {
      const offset = (frameCount + i * 20) % w;
      ctx.beginPath();
      ctx.moveTo(x + offset, y);
      ctx.lineTo(x + offset, y + h);
      ctx.stroke();
    }

    // Label
    ctx.fillStyle = 'rgba(255, 255, 255, 0.3)';
    ctx.font = 'bold 14px IBM Plex Mono';
    ctx.textAlign = 'center';
    ctx.fillText(label.toUpperCase(), x + w / 2, y + h / 2);
    
    // Scanlines
    ctx.fillStyle = 'rgba(0, 0, 0, 0.1)';
    for (let i = 0; i < h; i += 4) {
      ctx.fillRect(x, y + i, w, 1);
    }
  };

  const drawOverlays = (ctx: CanvasRenderingContext2D, width: number, height: number, frameCount: number) => {
    // 1. Logo Bug
    if (graphics.showBug) {
      const bugSize = 60;
      const bugX = width - bugSize - 40;
      const bugY = 40;
      
      ctx.fillStyle = 'rgba(0, 229, 255, 0.2)';
      ctx.beginPath();
      ctx.arc(bugX + bugSize/2, bugY + bugSize/2, bugSize/2, 0, Math.PI * 2);
      ctx.fill();
      
      ctx.strokeStyle = '#00E5FF';
      ctx.lineWidth = 2;
      ctx.stroke();
      
      ctx.fillStyle = '#FFFFFF';
      ctx.font = 'bold 12px Inter';
      ctx.textAlign = 'center';
      ctx.fillText('SELTON', bugX + bugSize/2, bugY + bugSize/2 + 5);
    }

    // 2. Lower Third
    if (lowerThirds.show) {
      const l3Width = 400;
      const l3Height = 80;
      const l3X = 60;
      const l3Y = height - 140;

      // Animation: slide in from left
      // We can use frameCount or just a simple static draw for now
      
      // Backdrop
      ctx.fillStyle = 'rgba(11, 15, 20, 0.9)';
      ctx.beginPath();
      ctx.roundRect(l3X, l3Y, l3Width, l3Height, [0, 12, 12, 0]);
      ctx.fill();
      
      // Accent bar
      ctx.fillStyle = lowerThirds.accentColor;
      ctx.fillRect(l3X, l3Y, 6, l3Height);

      // Name
      ctx.fillStyle = '#FFFFFF';
      ctx.font = 'bold 28px Inter';
      ctx.textAlign = 'left';
      ctx.fillText(lowerThirds.name.toUpperCase(), l3X + 30, l3Y + 40);
      
      // Title
      ctx.fillStyle = 'rgba(255, 255, 255, 0.7)';
      ctx.font = '500 16px Inter';
      ctx.fillText(lowerThirds.title, l3X + 30, l3Y + 65);
    }

    // 3. Socials Overlay
    if (graphics.showSocials) {
      const socX = 60;
      const socY = 60;
      ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
      ctx.beginPath();
      ctx.roundRect(socX, socY, 200, 30, 15);
      ctx.fill();
      
      ctx.fillStyle = '#FFFFFF';
      ctx.font = '600 12px Inter';
      ctx.textAlign = 'left';
      ctx.fillText('@seltonstudio', socX + 40, socY + 20);
      
      ctx.fillStyle = '#00E5FF';
      ctx.beginPath();
      ctx.arc(socX + 20, socY + 15, 8, 0, Math.PI * 2);
      ctx.fill();
    }

    // 4. Audience Message Overlay
    if (activeMessageId && audienceMessages.length > 0) {
      const msg = audienceMessages.find(m => m.id === activeMessageId);
      if (msg) {
        const msgWidth = 600;
        const msgHeight = 120;
        const msgX = (width - msgWidth) / 2;
        const msgY = height - 200; // Above lower thirds

        // Backdrop
        ctx.fillStyle = 'rgba(15, 20, 25, 0.85)';
        ctx.beginPath();
        ctx.roundRect(msgX, msgY, msgWidth, msgHeight, 16);
        ctx.fill();

        // Border
        ctx.strokeStyle = brandColor || '#5d28d9';
        ctx.lineWidth = 2;
        ctx.stroke();

        // Type Badge
        ctx.fillStyle = brandColor || '#5d28d9';
        ctx.beginPath();
        ctx.roundRect(msgX + 20, msgY - 12, 100, 24, 12);
        ctx.fill();
        
        ctx.fillStyle = '#FFFFFF';
        ctx.font = 'bold 12px Inter';
        ctx.textAlign = 'center';
        ctx.fillText(msg.type.toUpperCase(), msgX + 70, msgY + 4);

        // Author
        ctx.fillStyle = 'rgba(255, 255, 255, 0.6)';
        ctx.font = '600 16px Inter';
        ctx.textAlign = 'left';
        ctx.fillText(msg.author, msgX + 30, msgY + 40);

        // Text
        ctx.fillStyle = '#FFFFFF';
        ctx.font = '500 24px Inter';
        
        // Simple word wrap
        const words = msg.text.split(' ');
        let line = '';
        let lineY = msgY + 75;
        
        for (let i = 0; i < words.length; i++) {
          const testLine = line + words[i] + ' ';
          const metrics = ctx.measureText(testLine);
          if (metrics.width > msgWidth - 60 && i > 0) {
            ctx.fillText(line, msgX + 30, lineY);
            line = words[i] + ' ';
            lineY += 30;
          } else {
            line = testLine;
          }
        }
        ctx.fillText(line, msgX + 30, lineY);
      }
    }
  };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext('2d', { alpha: false }); // Optimization: disable alpha
    if (!context) return;

    let frameCount = 0;
    let lastTime = 0;
    const fps = 30;
    const interval = 1000 / fps;

    const render = (time: number) => {
      const deltaTime = time - lastTime;
      
      if (deltaTime >= interval) {
        frameCount++;
        draw(context, frameCount);
        lastTime = time - (deltaTime % interval);
      }
      
      requestRef.current = requestAnimationFrame(render);
    };
    
    requestRef.current = requestAnimationFrame(render);

    return () => cancelAnimationFrame(requestRef.current);
  }, [activeScene, isStreaming, sources, webcamStream, remoteStreams, screenStream, transitionType, layout, lowerThirds, graphics, backgroundImage, theme, audienceMessages, activeMessageId]);

  return (
    <canvas 
      ref={canvasRef} 
      width={1920} 
      height={1080} 
      className="w-full h-full object-contain bg-black"
    />
  );
};
