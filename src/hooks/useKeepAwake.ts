import { useEffect, useRef } from 'react';

type WakeLockSentinelLike = {
  release: () => Promise<void>;
  released?: boolean;
};

type NavigatorWithWakeLock = Navigator & {
  wakeLock?: {
    request: (type: 'screen') => Promise<WakeLockSentinelLike>;
  };
};

export function useKeepAwake(enabled = true) {
  const sentinelRef = useRef<WakeLockSentinelLike | null>(null);

  useEffect(() => {
    if (!enabled) return;

    const requestWakeLock = async () => {
      const wakeNavigator = navigator as NavigatorWithWakeLock;
      if (!wakeNavigator.wakeLock || document.visibilityState !== 'visible') return;

      try {
        sentinelRef.current = await wakeNavigator.wakeLock.request('screen');
      } catch {
        // Ignore unsupported or denied wake-lock requests.
      }
    };

    const releaseWakeLock = async () => {
      if (!sentinelRef.current) return;
      try {
        await sentinelRef.current.release();
      } catch {
        // Ignore double-release failures.
      } finally {
        sentinelRef.current = null;
      }
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible' && !sentinelRef.current) {
        void requestWakeLock();
      }
    };

    void requestWakeLock();
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      void releaseWakeLock();
    };
  }, [enabled]);
}
