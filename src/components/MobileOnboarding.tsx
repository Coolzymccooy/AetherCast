import React, { useState, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Camera, Monitor, MessageSquare, QrCode, Zap, ArrowRight, ChevronRight } from 'lucide-react';

interface Slide {
  icon: React.ReactNode;
  accent: string;
  iconBg: string;
  eyebrow: string;
  headline: string;
  body: string;
}

const SLIDES: Slide[] = [
  {
    icon: <Zap size={48} strokeWidth={1.5} />,
    accent: 'text-yellow-400',
    iconBg: 'bg-yellow-500/10 border-yellow-500/20',
    eyebrow: 'Welcome to',
    headline: 'AetherCast Camera',
    body: 'Your phone just became a professional broadcast tool. AetherCast Studio lives on your desktop — your phone is its wireless extension.',
  },
  {
    icon: <Camera size={48} strokeWidth={1.5} />,
    accent: 'text-blue-400',
    iconBg: 'bg-blue-500/10 border-blue-500/20',
    eyebrow: 'Mode 1',
    headline: 'Phone Camera',
    body: 'Turn your phone into a live wireless camera. Point it at anything — interviews, side angles, close-ups — and it feeds directly into the Studio as a real video source.',
  },
  {
    icon: <Monitor size={48} strokeWidth={1.5} />,
    accent: 'text-purple-400',
    iconBg: 'bg-purple-500/10 border-purple-500/20',
    eyebrow: 'Mode 2',
    headline: 'Screen Share',
    body: 'Broadcast your Android screen live. Native capture means real-time performance — share an app, a demo, or anything on your screen straight into the broadcast.',
  },
  {
    icon: <MessageSquare size={48} strokeWidth={1.5} />,
    accent: 'text-green-400',
    iconBg: 'bg-green-500/10 border-green-500/20',
    eyebrow: 'Mode 3',
    headline: 'Audience Portal',
    body: "You don't need to be behind the camera. Send questions, prayer requests, testimonies, or messages directly to the Studio operator — live, during the broadcast.",
  },
  {
    icon: <QrCode size={48} strokeWidth={1.5} />,
    accent: 'text-cyan-400',
    iconBg: 'bg-cyan-500/10 border-cyan-500/20',
    eyebrow: 'How it works',
    headline: 'Scan. Connect. Go live.',
    body: 'The Studio shows a QR code. Scan it with this app — your phone connects to the Studio instantly, over your local Wi-Fi. No accounts, no cables, no configuration.',
  },
];

interface Props {
  onComplete: () => void;
}

export default function MobileOnboarding({ onComplete }: Props) {
  const [index, setIndex] = useState(0);
  const [dir, setDir] = useState(1);
  const touchStart = useRef<number | null>(null);

  const go = (next: number) => {
    setDir(next > index ? 1 : -1);
    setIndex(next);
  };

  const advance = () => {
    if (index < SLIDES.length - 1) {
      go(index + 1);
    } else {
      localStorage.setItem('ac_onboarded', '1');
      onComplete();
    }
  };

  const skip = () => {
    localStorage.setItem('ac_onboarded', '1');
    onComplete();
  };

  const slide = SLIDES[index];
  const isLast = index === SLIDES.length - 1;

  return (
    <div
      className="h-screen bg-bg text-white flex flex-col overflow-hidden select-none"
      onTouchStart={e => { touchStart.current = e.touches[0].clientX; }}
      onTouchEnd={e => {
        if (touchStart.current === null) return;
        const delta = touchStart.current - e.changedTouches[0].clientX;
        if (Math.abs(delta) > 50) {
          if (delta > 0 && index < SLIDES.length - 1) go(index + 1);
          else if (delta < 0 && index > 0) go(index - 1);
        }
        touchStart.current = null;
      }}
    >
      {/* Skip */}
      <div className="flex justify-end px-6 pt-10 pb-2 shrink-0">
        {!isLast && (
          <button onClick={skip} className="text-gray-500 text-sm hover:text-gray-300 transition-colors">
            Skip
          </button>
        )}
      </div>

      {/* Slide content */}
      <div className="flex-1 flex flex-col items-center justify-center px-8 overflow-hidden">
        <AnimatePresence mode="wait" custom={dir}>
          <motion.div
            key={index}
            custom={dir}
            initial={{ opacity: 0, x: dir * 60 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: dir * -60 }}
            transition={{ duration: 0.28, ease: 'easeInOut' }}
            className="flex flex-col items-center text-center w-full"
          >
            {/* Icon */}
            <div className={`w-28 h-28 rounded-3xl border flex items-center justify-center mb-8 ${slide.iconBg} ${slide.accent}`}>
              {slide.icon}
            </div>

            {/* Eyebrow */}
            <p className={`text-xs font-semibold uppercase tracking-widest mb-2 ${slide.accent}`}>
              {slide.eyebrow}
            </p>

            {/* Headline */}
            <h1 className="text-3xl font-bold tracking-tight mb-4 leading-tight">
              {slide.headline}
            </h1>

            {/* Body */}
            <p className="text-gray-400 text-base leading-relaxed max-w-xs">
              {slide.body}
            </p>
          </motion.div>
        </AnimatePresence>
      </div>

      {/* Bottom — dots + button */}
      <div className="px-6 pb-12 shrink-0 space-y-6">
        {/* Dot indicators */}
        <div className="flex items-center justify-center gap-2">
          {SLIDES.map((_, i) => (
            <button
              key={i}
              onClick={() => go(i)}
              className={`transition-all rounded-full ${
                i === index
                  ? `w-6 h-2 ${slide.accent.replace('text-', 'bg-')}`
                  : 'w-2 h-2 bg-white/20'
              }`}
            />
          ))}
        </div>

        {/* CTA button */}
        <button
          onClick={advance}
          className={`w-full py-4 rounded-2xl font-bold text-lg flex items-center justify-center gap-2 transition-colors ${
            isLast
              ? 'bg-white text-black hover:bg-gray-100'
              : 'bg-white/10 text-white hover:bg-white/15 border border-white/10'
          }`}
        >
          {isLast ? (
            <>Get Started <ArrowRight size={20} /></>
          ) : (
            <>Next <ChevronRight size={20} /></>
          )}
        </button>
      </div>
    </div>
  );
}
