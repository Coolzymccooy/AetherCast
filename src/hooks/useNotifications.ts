import { useState, useCallback } from 'react';

export type NotificationType = 'info' | 'success' | 'error' | 'warning';

export interface Notification {
  id: number;
  message: string;
  type: NotificationType;
  expiresAt: number;
}

/**
 * Lightweight notification state for user-facing toast messages.
 * Notifications auto-expire after `durationMs` (default 5s).
 */
export function useNotifications(durationMs = 5000) {
  const [notifications, setNotifications] = useState<Notification[]>([]);

  const notify = useCallback((message: string, type: NotificationType = 'info') => {
    const id = Date.now() + Math.random();
    const expiresAt = Date.now() + durationMs;

    setNotifications(prev => [...prev, { id, message, type, expiresAt }].slice(-5));

    // Auto-remove after duration
    setTimeout(() => {
      setNotifications(prev => prev.filter(n => n.id !== id));
    }, durationMs);
  }, [durationMs]);

  const dismiss = useCallback((id: number) => {
    setNotifications(prev => prev.filter(n => n.id !== id));
  }, []);

  return { notifications, notify, dismiss };
}
