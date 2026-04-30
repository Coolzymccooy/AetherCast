import React from 'react';
import { X, Settings2, Monitor, Zap, Gauge } from 'lucide-react';
import { motion } from 'motion/react';
import type { EncodingProfile, StreamDestination } from '../../types';
import { resolveNativeCaptureProfile } from '../../lib/nativeStreaming';

interface OutputQualityModalProps {
  encodingProfile: EncodingProfile;
  setEncodingProfile: (p: EncodingProfile) => void;
  onClose: () => void;
  isNativeDesktop?: boolean;
  isGPU?: boolean;
  destinations?: Array<Pick<StreamDestination, 'enabled' | 'protocol' | 'rtmpUrl' | 'url'>>;
}

const PROFILES: Array<{
  id: EncodingProfile;
  name: string;
  resolution: string;
  fps: string;
  bitrate: string;
  description: string;
  recommended?: boolean;
}> = [
  {
    id: '1080p60',
    name: 'Ultra Quality',
    resolution: '1920x1080',
    fps: '60 FPS',
    bitrate: '6,000 kbps',
    description: 'Best quality. Requires fast CPU and stable 8+ Mbps upload.',
  },
  {
    id: '1080p30',
    name: 'High Quality',
    resolution: '1920x1080',
    fps: '30 FPS',
    bitrate: '4,500 kbps',
    description: 'Great quality with lower CPU usage. Recommended for most streams.',
    recommended: true,
  },
  {
    id: '720p30',
    name: 'Standard',
    resolution: '1280x720',
    fps: '30 FPS',
    bitrate: '2,500 kbps',
    description: 'Good quality on slower connections. Works with 3+ Mbps upload.',
  },
  {
    id: '480p30',
    name: 'Low Bandwidth',
    resolution: '854x480',
    fps: '30 FPS',
    bitrate: '1,000 kbps',
    description: 'For limited bandwidth. Works with 1.5+ Mbps upload.',
  },
];

export const OutputQualityModal: React.FC<OutputQualityModalProps> = ({
  encodingProfile, setEncodingProfile, onClose, isNativeDesktop = false, isGPU = true, destinations = [],
}) => {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
      <motion.div
        initial={{ scale: 0.95, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.95, opacity: 0 }}
        className="bg-panel border border-border w-full max-w-lg rounded-2xl shadow-2xl overflow-hidden flex flex-col"
      >
        <div className="p-5 border-b border-border flex items-center justify-between bg-white/5">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-accent-cyan/10 flex items-center justify-center">
              <Settings2 size={20} className="text-accent-cyan" />
            </div>
            <div>
              <h2 className="text-sm font-bold uppercase tracking-widest text-white">Output Quality</h2>
              <p className="text-[10px] text-gray-400">Select encoding profile for your stream</p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 text-gray-500 hover:text-white hover:bg-white/10 rounded-full transition-colors">
            <X size={20} />
          </button>
        </div>

        <div className="p-6 space-y-3">
          {PROFILES.map(profile => {
            const runtimeProfile = isNativeDesktop
              ? resolveNativeCaptureProfile(profile.id, isGPU, {
                mode: 'native-scene',
                destinations,
              })
              : null;
            const displayedResolution = runtimeProfile
              ? `${runtimeProfile.width}x${runtimeProfile.height}`
              : profile.resolution;
            const displayedFps = runtimeProfile
              ? `${runtimeProfile.fps} FPS`
              : profile.fps;
            const displayedBitrate = runtimeProfile
              ? `${runtimeProfile.bitrate.toLocaleString()} kbps`
              : profile.bitrate;

            return (
              <button
                key={profile.id}
                onClick={() => setEncodingProfile(profile.id)}
                className={`w-full text-left p-4 rounded-xl border transition-all ${
                  encodingProfile === profile.id
                    ? 'bg-accent-cyan/10 border-accent-cyan'
                    : 'bg-black/40 border-border hover:border-white/20'
                }`}
              >
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <span className={`text-sm font-bold ${encodingProfile === profile.id ? 'text-accent-cyan' : 'text-white'}`}>
                      {profile.name}
                    </span>
                    {profile.recommended && (
                      <span className="text-[8px] font-bold bg-accent-cyan/20 text-accent-cyan px-2 py-0.5 rounded-full">
                        RECOMMENDED
                      </span>
                    )}
                    {runtimeProfile?.reliabilityMode && (
                      <span className="text-[8px] font-bold bg-amber-500/15 text-amber-300 px-2 py-0.5 rounded-full">
                        LIVE DELIVERY
                      </span>
                    )}
                  </div>
                  <div className={`w-4 h-4 rounded-full border-2 flex items-center justify-center ${
                    encodingProfile === profile.id ? 'border-accent-cyan' : 'border-gray-600'
                  }`}>
                    {encodingProfile === profile.id && <div className="w-2 h-2 rounded-full bg-accent-cyan" />}
                  </div>
                </div>

                <div className="flex items-center gap-4 mb-2">
                  <div className="flex items-center gap-1 text-[10px] text-gray-400">
                    <Monitor size={10} /> {displayedResolution}
                  </div>
                  <div className="flex items-center gap-1 text-[10px] text-gray-400">
                    <Zap size={10} /> {displayedFps}
                  </div>
                  <div className="flex items-center gap-1 text-[10px] text-gray-400">
                    <Gauge size={10} /> {displayedBitrate}
                  </div>
                </div>

                <p className="text-[10px] text-gray-500">
                  {runtimeProfile?.reliabilityMode
                    ? `${profile.description} Desktop native live path is currently capped here to keep Twitch stable.`
                    : profile.description}
                </p>
              </button>
            );
          })}
        </div>

        <div className="p-5 border-t border-border bg-black/20 flex justify-end">
          <button
            onClick={onClose}
            className="px-8 py-2.5 bg-accent-cyan hover:bg-cyan-400 text-black font-bold rounded-lg transition-all uppercase tracking-widest text-[10px]"
          >
            Done
          </button>
        </div>
      </motion.div>
    </div>
  );
};
