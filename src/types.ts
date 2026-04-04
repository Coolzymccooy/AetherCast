export type Scene = {
  id: string;
  name: string;
  type: 'CAM' | 'SCREEN' | 'DUAL' | 'GRID' | 'PODCAST';
};

export type Source = {
  id: string;
  name: string;
  status: 'active' | 'standby' | 'offline';
  resolution: string;
  fps: number;
  audioLevel: number; // 0 to 1
};

export type Telemetry = {
  bitrate: string;
  fps: number;
  cpu: number;
  droppedFrames: number;
  network: 'excellent' | 'good' | 'fair' | 'poor';
};

export type ScriptStep = {
  id: string;
  sceneId: string;
  duration: number; // in seconds
  label: string;
  action?: string;
};

export type Script = {
  id: string;
  name: string;
  steps: ScriptStep[];
};

export type Recording = {
  id: string;
  timestamp: string;
  duration: string;
  size: string;
  thumbnail: string;
  fileName: string;
  url?: string;
};

export type StreamProtocol = 'rtmp' | 'rtmps' | 'srt' | 'rist';

export type StreamDestination = {
  id: string;
  name: string;
  rtmpUrl: string;           // Legacy field — also accepts srt:// and rist:// URLs
  url?: string;              // Preferred: protocol-agnostic URL field
  streamKey: string;
  enabled: boolean;
  protocol?: StreamProtocol; // Auto-detected from URL if not set
};

export type EncodingProfile = '1080p60' | '1080p30' | '720p30' | '480p30';

export type CamoSettings = {
  layout: 'Fill' | 'Center' | 'Reset';
  contentFit: 'Fit' | 'Fill';
  scale: number;
  x: number;
  y: number;
  shape: 'Rect' | 'Circle';
  cornerRadius: number;
  crop: { left: number; right: number; top: number; bottom: number };
  filter: 'None' | 'B&W' | 'Sepia' | 'Vivid' | 'Cool' | 'Dim';
  removeBackground: boolean;
};

export type AudienceMessage = {
  id: string;
  author: string;
  text: string;
  type: 'Q&A' | 'Prayer' | 'Testimony' | 'Welcome' | 'Poll';
  timestamp: number;
  visible: boolean;
};

// --- New types to replace `any` ---

export type AiMode = 'AUTO' | 'MANUAL' | 'TIMER';

export type DirectorTab = 'CAMO' | 'PROP' | 'IN' | 'AI' | 'OPS' | 'AUD' | 'FX' | 'MED' | 'RPL' | 'MIDI';

export type LowerThirds = {
  name: string;
  title: string;
  visible: boolean;
  duration: number;
  accentColor: string;
};

export type AudioChannel = {
  name: string;
  level: number;
  volume: number;
  peak: number;
  muted: boolean;
  delayMs?: number;
  monitorEnabled?: boolean;
};

export type ScenePreset = {
  id: string;
  name: string;
  layout: string;
  activeSceneId: string;
  background: string;
  frameStyle: string;
  activeTheme: string;
  camoSettings?: CamoSettings;
};

export type ServerLog = {
  id: number;
  message: string;
  type: 'info' | 'success' | 'error' | 'warning' | 'ffmpeg';
};

export type AiSuggestion = {
  scene: string;
  reason: string;
};

export type QrMode = 'camera' | 'screen' | 'audience';

export type Graphics = {
  showBug: boolean;
  showSocials: boolean;
};

// ── Phase 1: WebGL Compositor ────────────────────────────────────────────────

export type ChromaKeyConfig = {
  enabled: boolean;
  keyColor: [number, number, number]; // RGB 0-1
  similarity: number;                  // 0-1
  smoothness: number;                  // 0-1
};

export type VideoFilter = 'None' | 'B&W' | 'Sepia' | 'Vivid' | 'Cool' | 'Dim';

export type RenderRect = {
  x: number; y: number; width: number; height: number;
  cornerRadius?: number;
  opacity?: number;
};

// ── Phase 2: Pro Audio ──────────────────────────────────────────────────────

export type NoiseGateConfig = {
  threshold: number;   // dB
  attack: number;      // seconds
  release: number;     // seconds
  enabled: boolean;
};

export type CompressorConfig = {
  threshold: number;   // dB
  ratio: number;
  attack: number;      // seconds
  release: number;     // seconds
  knee: number;        // dB
  makeupGain: number;  // dB
  enabled: boolean;
};

export type EQConfig = {
  lowGain: number;     // dB (-12 to +12)
  lowFreq: number;     // Hz
  midGain: number;     // dB
  midFreq: number;     // Hz
  highGain: number;    // dB
  highFreq: number;    // Hz
  enabled: boolean;
};

export type LimiterConfig = {
  threshold: number;   // dB
  release: number;     // seconds
  enabled: boolean;
};

export type LoudnessReading = {
  momentary: number;   // LUFS
  shortTerm: number;   // LUFS
  integrated: number;  // LUFS
  range: number;       // LU
  truePeak: number;    // dBTP
};

// ── Phase 3: Transitions & Media ────────────────────────────────────────────

export type TransitionType = 'Cut' | 'Fade' | 'Wipe' | 'WipeUp' | 'WipeDown' | 'Stinger';

export type StingerConfig = {
  videoUrl: string;
  duration: number;     // ms
  cutPoint: number;     // ms
  useAlpha: boolean;
};

export type MediaItem = {
  id: string;
  name: string;
  url: string;
  type: 'video' | 'audio' | 'image';
  duration?: number;
  thumbnail?: string;
};

export type PlaybackState = {
  currentItem: MediaItem | null;
  isPlaying: boolean;
  currentTime: number;
  duration: number;
  volume: number;
  loop: boolean;
  playlistIndex: number;
};

// ── Phase 4: Project Persistence ────────────────────────────────────────────

export type ProjectFile = {
  version: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  scenes: Scene[];
  activeSceneId: string;
  layout: string;
  background: string;
  frameStyle: string;
  motionStyle: string;
  brandColor: string;
  activeTheme: string;
  camoSettings: CamoSettings;
  lowerThirds: LowerThirds;
  presets: ScenePreset[];
  audioChannels: Array<{ name: string; volume: number; muted: boolean }>;
  destinations: Array<{ id: string; name: string; rtmpUrl: string; enabled: boolean }>;
  scripts: Script[];
};

// ── Phase 5: Replay & Control ───────────────────────────────────────────────

export type ReplayClip = {
  id: string;
  startTime: number;
  endTime: number;
  duration: number;
  url?: string;
};

export type MIDIMapping = {
  id: string;
  channel: number;
  note?: number;
  cc?: number;
  action: string;
  type: 'button' | 'fader';
};

export type TallyState = {
  program: string[];   // Source IDs on program (red)
  preview: string[];   // Source IDs on preview (green)
};
