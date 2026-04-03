import React, { useState } from 'react';
import { motion } from 'motion/react';
import { Monitor, Download, Smartphone, AlertCircle, CheckCircle2, Apple, ChevronDown, ChevronUp } from 'lucide-react';

const STEPS = [
  {
    n: '1',
    title: 'Allow unknown apps',
    body: 'On your Android phone go to Settings → Apps → Special app access → Install unknown apps. Find your browser (Chrome/Samsung Internet) and enable "Allow from this source".',
  },
  {
    n: '2',
    title: 'Download the APK',
    body: 'Tap the Download button above. Your browser will download the file — tap "Open" when it finishes.',
  },
  {
    n: '3',
    title: 'Install it',
    body: 'Android will show an install prompt. Tap Install. The app won\'t appear in the Play Store — that\'s normal for direct downloads.',
  },
  {
    n: '4',
    title: 'Open AetherCast Camera',
    body: 'Scan the QR code from your Studio. Android will ask which app to open the link — choose AetherCast Camera. Grant the screen-capture permission when prompted.',
  },
];

export default function AppDownload() {
  const [stepsOpen, setStepsOpen] = useState(true);

  return (
    <div className="min-h-screen bg-bg text-white flex flex-col items-center justify-start p-6 pt-16 overflow-y-auto">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="max-w-sm w-full space-y-8"
      >
        {/* Header */}
        <div className="text-center space-y-3">
          <div className="w-20 h-20 bg-blue-500/10 border border-blue-500/30 rounded-2xl flex items-center justify-center mx-auto">
            <Monitor size={40} className="text-blue-400" />
          </div>
          <h1 className="text-3xl font-bold tracking-tight">AetherCast Camera</h1>
          <p className="text-gray-400 text-sm leading-relaxed">
            Share your Android screen directly to AetherCast Studio — no cables, no Chrome limitations.
          </p>
        </div>

        {/* Android download card */}
        <div className="bg-white/5 border border-white/10 rounded-2xl p-5 space-y-4">
          <div className="flex items-center gap-3">
            <Smartphone size={20} className="text-green-400" />
            <div>
              <div className="font-semibold text-sm">Android</div>
              <div className="text-xs text-gray-500">Android 9+ (API 28+)</div>
            </div>
            <span className="ml-auto text-[11px] bg-green-500/20 text-green-400 border border-green-500/30 px-2 py-0.5 rounded-full font-medium">
              Available
            </span>
          </div>

          <a
            href="/downloads/aethercast-camera.apk"
            download
            className="flex items-center justify-center gap-2 w-full py-3.5 rounded-xl bg-blue-600 hover:bg-blue-700 active:bg-blue-800 font-bold text-white transition-colors"
          >
            <Download size={18} />
            Download APK
          </a>

          {/* Install steps toggle */}
          <button
            onClick={() => setStepsOpen(v => !v)}
            className="w-full flex items-center justify-between text-xs text-gray-400 hover:text-gray-200 transition-colors py-1"
          >
            <span>How to install (sideload)</span>
            {stepsOpen ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          </button>

          {stepsOpen && (
            <motion.ol
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              className="space-y-3 overflow-hidden"
            >
              {STEPS.map(s => (
                <li key={s.n} className="flex gap-3 text-xs text-gray-300">
                  <span className="shrink-0 w-5 h-5 rounded-full bg-blue-600/30 border border-blue-500/40 flex items-center justify-center text-blue-300 font-bold text-[10px]">
                    {s.n}
                  </span>
                  <div>
                    <div className="font-semibold text-white mb-0.5">{s.title}</div>
                    <div className="text-gray-400 leading-relaxed">{s.body}</div>
                  </div>
                </li>
              ))}
            </motion.ol>
          )}
        </div>

        {/* iOS card */}
        <div className="bg-white/5 border border-white/10 rounded-2xl p-5 space-y-3 opacity-60">
          <div className="flex items-center gap-3">
            <Apple size={20} className="text-gray-400" />
            <div>
              <div className="font-semibold text-sm">iOS (iPhone / iPad)</div>
              <div className="text-xs text-gray-500">iOS 16+</div>
            </div>
            <span className="ml-auto text-[11px] bg-yellow-500/20 text-yellow-400 border border-yellow-500/30 px-2 py-0.5 rounded-full font-medium">
              Coming soon
            </span>
          </div>
          <p className="text-xs text-gray-500 leading-relaxed">
            iOS requires Apple's ReplayKit API distributed via the App Store. This is planned for a future release.
            In the meantime, iPhone and iPad users can use the phone <strong className="text-gray-400">camera</strong> mode — only screen sharing is unavailable on iOS.
          </p>
        </div>

        {/* What does the app do */}
        <div className="space-y-2">
          <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wider">What this app does</h2>
          <ul className="space-y-2">
            {[
              'Captures your Android screen using the native MediaProjection API',
              'Streams the screen directly to AetherCast Studio over your local network via WebRTC',
              'No data leaves your network — no cloud, no recording',
              'QR-code pairing: scan from Studio and the app connects automatically',
            ].map(item => (
              <li key={item} className="flex gap-2 text-xs text-gray-400">
                <CheckCircle2 size={14} className="text-green-500 shrink-0 mt-0.5" />
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </div>

        {/* Security note */}
        <div className="flex gap-3 p-4 bg-yellow-500/5 border border-yellow-500/20 rounded-xl">
          <AlertCircle size={16} className="text-yellow-400 shrink-0 mt-0.5" />
          <p className="text-xs text-yellow-300/80 leading-relaxed">
            This APK is distributed directly from aethercast.tiwaton.co.uk and is not on the Google Play Store.
            Android will warn you about installing from unknown sources — this is normal for direct downloads.
          </p>
        </div>

        <p className="text-center text-xs text-gray-600 pb-8">
          AetherCast Studio &mdash; Beta
        </p>
      </motion.div>
    </div>
  );
}
