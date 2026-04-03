import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.selton.studio',
  appName: 'AetherCast Camera',
  webDir: 'dist',
  server: {
    // APK always loads from the live production server.
    // No need to rebuild/redistribute the APK when web code changes.
    url: 'https://aethercast.tiwaton.co.uk/?mode=app',
    cleartext: false,
  },
  android: {
    buildOptions: {
      releaseType: 'APK',
    },
    // Allow the WebView to load the production URL
    allowMixedContent: false,
  },
  plugins: {
    ScreenCapture: {},
  },
};

export default config;
