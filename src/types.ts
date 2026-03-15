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

export type StreamDestination = {
  id: string;
  name: string;
  rtmpUrl: string;
  streamKey: string;
  enabled: boolean;
};

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
