import { WebPlugin } from '@capacitor/core';
import type { ScreenCapturePlugin } from './screenCapture';

/**
 * Web stub — used when the app runs in a regular browser (not the Android APK).
 * All methods are no-ops; PhoneScreenView falls back to getDisplayMedia on web.
 */
export class ScreenCaptureWeb extends WebPlugin implements ScreenCapturePlugin {
  async startCapture(_options: { width: number; height: number; fps: number }): Promise<void> {
    throw new Error('Native screen capture is only available in the Android app.');
  }

  async stopCapture(): Promise<void> {
    // no-op on web
  }
}
