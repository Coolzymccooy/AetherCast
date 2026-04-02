import { registerPlugin } from '@capacitor/core';

export interface ScreenCapturePlugin {
  /** Request MediaProjection permission and start capture */
  startCapture(options: { width: number; height: number; fps: number }): Promise<void>;
  /** Stop screen capture and release MediaProjection */
  stopCapture(): Promise<void>;
  /** Add listener for JPEG frame events */
  addListener(
    event: 'frameReady',
    handler: (data: { jpeg: string }) => void,
  ): Promise<{ remove: () => void }>;
  /** Remove all listeners */
  removeAllListeners(): Promise<void>;
}

const ScreenCapture = registerPlugin<ScreenCapturePlugin>('ScreenCapture', {
  web: () => import('./screenCaptureWeb').then(m => new m.ScreenCaptureWeb()),
});

export default ScreenCapture;
