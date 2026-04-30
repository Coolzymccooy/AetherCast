import React, { useEffect, useState } from 'react';
import { X, Camera, Mic, Check, Monitor, RefreshCw, AlertTriangle, Volume2 } from 'lucide-react';
import { motion } from 'motion/react';

interface HardwareSetupModalProps {
  devices: MediaDeviceInfo[];
  selectedVideoDevice: string;
  setSelectedVideoDevice: (id: string) => void;
  selectedVideoDevice2: string;
  setSelectedVideoDevice2: (id: string) => void;
  selectedAudioDevice: string;
  setSelectedAudioDevice: (id: string) => void;
  onClose: () => void;
  onStart: () => Promise<boolean | void> | boolean | void;
  onRefreshDevices?: () => Promise<MediaDeviceInfo[] | void>;
}

export const HardwareSetupModal: React.FC<HardwareSetupModalProps> = ({
  devices, selectedVideoDevice, setSelectedVideoDevice,
  selectedVideoDevice2, setSelectedVideoDevice2,
  selectedAudioDevice, setSelectedAudioDevice,
  onClose, onStart, onRefreshDevices,
}) => {
  const videoDevices = devices.filter(d => d.kind === 'videoinput');
  const audioInputDevices = devices.filter(d => d.kind === 'audioinput');
  const audioOutputDevices = devices.filter(d => d.kind === 'audiooutput');
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isInitializing, setIsInitializing] = useState(false);
  const [selectedAudioOutput, setSelectedAudioOutput] = useState('');
  const [previewStream, setPreviewStream] = useState<MediaStream | null>(null);
  const previewStreamRef = React.useRef<MediaStream | null>(null);
  const previewRef = React.useRef<HTMLVideoElement>(null);

  const stopPreview = React.useCallback(async () => {
    const activePreview = previewStreamRef.current;
    previewStreamRef.current = null;

    if (previewRef.current) {
      previewRef.current.srcObject = null;
    }

    if (activePreview) {
      activePreview.getTracks().forEach(track => track.stop());
    }

    setPreviewStream(null);

    if (activePreview) {
      // Some Windows camera drivers need a beat after stop() before reopening.
      await new Promise(resolve => window.setTimeout(resolve, 150));
    }
  }, []);

  const handleRefresh = React.useCallback(async () => {
    setIsRefreshing(true);
    try {
      await onRefreshDevices?.();
    } finally {
      setIsRefreshing(false);
    }
  }, [onRefreshDevices]);

  useEffect(() => {
    if (devices.length === 0 && onRefreshDevices) {
      void handleRefresh();
    }
  }, [devices.length, handleRefresh, onRefreshDevices]);

  useEffect(() => {
    if (!selectedVideoDevice) {
      void stopPreview();
      return;
    }

    let cancelled = false;
    let localPreview: MediaStream | null = null;

    const startPreview = async () => {
      await stopPreview();

      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: {
            deviceId: { exact: selectedVideoDevice },
            width: { ideal: 640 },
            height: { ideal: 360 },
          },
          audio: false,
        });

        if (cancelled) {
          stream.getTracks().forEach(track => track.stop());
          return;
        }

        localPreview = stream;
        previewStreamRef.current = stream;
        setPreviewStream(stream);

        if (previewRef.current) {
          previewRef.current.srcObject = stream;
          previewRef.current.play().catch(() => {});
        }
      } catch {
        // Preview is best-effort. Real initialization surfaces actionable errors.
      }
    };

    void startPreview();

    return () => {
      cancelled = true;
      if (localPreview) {
        localPreview.getTracks().forEach(track => track.stop());
        if (previewStreamRef.current === localPreview) {
          previewStreamRef.current = null;
        }
      }
    };
  }, [selectedVideoDevice, stopPreview]);

  useEffect(() => {
    return () => {
      void stopPreview();
    };
  }, [stopPreview]);

  const handleStart = async () => {
    setIsInitializing(true);
    try {
      await stopPreview();
      await onStart();
    } finally {
      setIsInitializing(false);
    }
  };

  const getDeviceLabel = (device: MediaDeviceInfo, fallback: string): string => {
    if (device.label) return device.label;
    return `${fallback} (${device.deviceId.slice(0, 8)}...)`;
  };

  const noDevices = videoDevices.length === 0 && audioInputDevices.length === 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
      <motion.div
        initial={{ scale: 0.95, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.95, opacity: 0 }}
        className="bg-panel border border-border w-full max-w-2xl rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]"
      >
        <div className="p-5 border-b border-border flex items-center justify-between bg-white/5">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-accent-cyan/10 flex items-center justify-center">
              <Camera size={20} className="text-accent-cyan" />
            </div>
            <div>
              <h2 className="text-sm font-bold uppercase tracking-widest text-white">Hardware Setup</h2>
              <p className="text-[10px] text-gray-400">Configure local video and audio inputs</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => { void handleRefresh(); }}
              disabled={isRefreshing || isInitializing}
              className="p-2 text-gray-500 hover:text-accent-cyan hover:bg-white/10 rounded-full transition-colors disabled:opacity-50"
              title="Refresh device list"
            >
              <RefreshCw size={16} className={isRefreshing ? 'animate-spin' : ''} />
            </button>
            <button
              onClick={onClose}
              className="p-2 text-gray-500 hover:text-white hover:bg-white/10 rounded-full transition-colors"
            >
              <X size={20} />
            </button>
          </div>
        </div>

        <div className="p-6 space-y-5 flex-1 overflow-y-auto">
          {noDevices && (
            <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-xl p-4 flex items-start gap-3">
              <AlertTriangle size={18} className="text-yellow-500 shrink-0 mt-0.5" />
              <div>
                <p className="text-xs font-bold text-yellow-400">No devices detected</p>
                <p className="text-[10px] text-yellow-500/80 mt-1">
                  Your browser needs permission to access cameras and microphones.
                  Click the refresh button above to request permission, or check that your devices are connected.
                </p>
              </div>
            </div>
          )}

          <div className="bg-black/40 border border-border rounded-xl p-4 space-y-4">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <Camera size={14} className="text-accent-cyan" />
                <h3 className="text-xs font-bold uppercase tracking-widest text-gray-300">Video Inputs</h3>
              </div>
              <span className="text-[9px] bg-accent-cyan/10 text-accent-cyan px-2 py-0.5 rounded font-bold">
                {videoDevices.length} FOUND
              </span>
            </div>

            {selectedVideoDevice && (
              <div className="aspect-video bg-black rounded-lg overflow-hidden border border-white/10 relative">
                <video
                  ref={previewRef}
                  muted
                  playsInline
                  className="w-full h-full object-cover"
                />
                {!previewStream && (
                  <div className="absolute inset-0 flex items-center justify-center text-gray-600">
                    <Camera size={32} />
                  </div>
                )}
                <div className="absolute top-2 left-2 px-2 py-0.5 bg-black/70 rounded text-[9px] font-bold text-accent-cyan">
                  PREVIEW
                </div>
              </div>
            )}

            <div className="space-y-1.5">
              <label className="text-[10px] font-bold text-gray-500 uppercase tracking-wider">Primary Camera</label>
              <select
                value={selectedVideoDevice}
                onChange={(e) => setSelectedVideoDevice(e.target.value)}
                className="w-full bg-black border border-border rounded-lg px-3 py-2.5 text-xs text-white focus:outline-none focus:border-accent-cyan transition-colors appearance-none cursor-pointer"
              >
                <option value="">None</option>
                {videoDevices.map(d => (
                  <option key={d.deviceId} value={d.deviceId}>
                    {getDeviceLabel(d, 'Camera')}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-1.5">
              <label className="text-[10px] font-bold text-gray-500 uppercase tracking-wider">Secondary Camera (Optional)</label>
              <select
                value={selectedVideoDevice2}
                onChange={(e) => setSelectedVideoDevice2(e.target.value)}
                className="w-full bg-black border border-border rounded-lg px-3 py-2.5 text-xs text-white focus:outline-none focus:border-accent-cyan transition-colors appearance-none cursor-pointer"
              >
                <option value="">None</option>
                {videoDevices
                  .filter(d => d.deviceId !== selectedVideoDevice)
                  .map(d => (
                    <option key={d.deviceId} value={d.deviceId}>
                      {getDeviceLabel(d, 'Camera')}
                    </option>
                  ))}
              </select>
            </div>
          </div>

          <div className="bg-black/40 border border-border rounded-xl p-4 space-y-4">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <Mic size={14} className="text-accent-green" />
                <h3 className="text-xs font-bold uppercase tracking-widest text-gray-300">Audio Inputs</h3>
              </div>
              <span className="text-[9px] bg-accent-green/10 text-accent-green px-2 py-0.5 rounded font-bold">
                {audioInputDevices.length} FOUND
              </span>
            </div>

            <div className="space-y-1.5">
              <label className="text-[10px] font-bold text-gray-500 uppercase tracking-wider">Microphone Source</label>
              <select
                value={selectedAudioDevice}
                onChange={(e) => setSelectedAudioDevice(e.target.value)}
                className="w-full bg-black border border-border rounded-lg px-3 py-2.5 text-xs text-white focus:outline-none focus:border-accent-cyan transition-colors appearance-none cursor-pointer"
              >
                <option value="">None</option>
                {audioInputDevices.map(d => (
                  <option key={d.deviceId} value={d.deviceId}>
                    {getDeviceLabel(d, 'Microphone')}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {audioOutputDevices.length > 0 && (
            <div className="bg-black/40 border border-border rounded-xl p-4 space-y-4">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <Volume2 size={14} className="text-gray-400" />
                  <h3 className="text-xs font-bold uppercase tracking-widest text-gray-300">Audio Output</h3>
                </div>
                <span className="text-[9px] bg-white/5 text-gray-400 px-2 py-0.5 rounded font-bold">
                  {audioOutputDevices.length} FOUND
                </span>
              </div>

              <div className="space-y-1.5">
                <label className="text-[10px] font-bold text-gray-500 uppercase tracking-wider">Monitor Output</label>
                <select
                  value={selectedAudioOutput}
                  onChange={(e) => setSelectedAudioOutput(e.target.value)}
                  className="w-full bg-black border border-border rounded-lg px-3 py-2.5 text-xs text-white focus:outline-none focus:border-accent-cyan transition-colors appearance-none cursor-pointer"
                >
                  <option value="">System Default</option>
                  {audioOutputDevices.map(d => (
                    <option key={d.deviceId} value={d.deviceId}>
                      {getDeviceLabel(d, 'Speaker')}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          )}

          <div className="grid grid-cols-3 gap-3">
            <div className="bg-black/40 border border-border rounded-lg p-3 text-center">
              <Camera size={16} className="text-accent-cyan mx-auto mb-1" />
              <div className="text-lg font-bold text-white">{videoDevices.length}</div>
              <div className="text-[9px] text-gray-500 uppercase">Cameras</div>
            </div>
            <div className="bg-black/40 border border-border rounded-lg p-3 text-center">
              <Mic size={16} className="text-accent-green mx-auto mb-1" />
              <div className="text-lg font-bold text-white">{audioInputDevices.length}</div>
              <div className="text-[9px] text-gray-500 uppercase">Microphones</div>
            </div>
            <div className="bg-black/40 border border-border rounded-lg p-3 text-center">
              <Monitor size={16} className="text-gray-400 mx-auto mb-1" />
              <div className="text-lg font-bold text-white">{audioOutputDevices.length}</div>
              <div className="text-[9px] text-gray-500 uppercase">Outputs</div>
            </div>
          </div>
        </div>

        <div className="p-5 border-t border-border bg-black/20 flex gap-3 justify-end">
          <button
            onClick={onClose}
            className="px-6 py-2.5 bg-transparent hover:bg-white/5 text-white font-bold rounded-lg transition-all uppercase tracking-widest text-[10px] border border-border"
          >
            Cancel
          </button>
          <button
            onClick={() => { void handleStart(); }}
            disabled={(!selectedVideoDevice && !selectedAudioDevice) || isInitializing}
            className="px-8 py-2.5 bg-accent-cyan hover:bg-cyan-400 text-black font-bold rounded-lg transition-all uppercase tracking-widest text-[10px] shadow-[0_0_15px_rgba(0,229,255,0.3)] flex items-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <Check size={14} /> {isInitializing ? 'Initializing...' : 'Initialize Hardware'}
          </button>
        </div>
      </motion.div>
    </div>
  );
};
