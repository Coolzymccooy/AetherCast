import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useNotifications } from './useNotifications';

describe('useNotifications', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should start with no notifications', () => {
    const { result } = renderHook(() => useNotifications());
    expect(result.current.notifications).toEqual([]);
  });

  it('should add a notification', () => {
    const { result } = renderHook(() => useNotifications());

    act(() => {
      result.current.notify('Hello', 'info');
    });

    expect(result.current.notifications).toHaveLength(1);
    expect(result.current.notifications[0].message).toBe('Hello');
    expect(result.current.notifications[0].type).toBe('info');
  });

  it('should support different notification types', () => {
    const { result } = renderHook(() => useNotifications());

    act(() => {
      result.current.notify('Error!', 'error');
    });

    expect(result.current.notifications[0].type).toBe('error');
  });

  it('should auto-expire after duration', () => {
    const { result } = renderHook(() => useNotifications(3000));

    act(() => {
      result.current.notify('Temp', 'info');
    });

    expect(result.current.notifications).toHaveLength(1);

    act(() => {
      vi.advanceTimersByTime(3000);
    });

    expect(result.current.notifications).toHaveLength(0);
  });

  it('should dismiss a notification manually', () => {
    const { result } = renderHook(() => useNotifications());

    act(() => {
      result.current.notify('Dismiss me', 'warning');
    });

    const id = result.current.notifications[0].id;

    act(() => {
      result.current.dismiss(id);
    });

    expect(result.current.notifications).toHaveLength(0);
  });

  it('should keep at most 5 notifications', () => {
    const { result } = renderHook(() => useNotifications(60000));

    act(() => {
      for (let i = 0; i < 7; i++) {
        result.current.notify(`Msg ${i}`, 'info');
      }
    });

    expect(result.current.notifications.length).toBeLessThanOrEqual(5);
  });
});
