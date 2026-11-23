import Storage from 'expo-sqlite/kv-store';
import { useCallback, useSyncExternalStore } from 'react';

/**
 * "Show event details in notifications" (FR2-REM-3): off by default, per member and per
 * device, so it's kept on the device and never on the server. Off, a reminder names only the
 * kind, time and taking member; on, it adds the title and place.
 */
const key = (userId: string) => `notifications.eventDetails.${userId}`;

const listeners = new Set<() => void>();

export function showEventDetails(userId: string): boolean {
  try {
    return Storage.getItemSync(key(userId)) === 'on';
  } catch {
    return false;
  }
}

export function setShowEventDetails(userId: string, on: boolean): void {
  try {
    Storage.setItemSync(key(userId), on ? 'on' : 'off');
  } catch {
    // Stays off: the safe side.
  }
  listeners.forEach((listener) => listener());
}

/** Runs `listener` whenever the setting changes, so the reminders are rewritten. */
export function onEventDetailsChanged(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** The setting for screens: its value and a setter. */
export function useShowEventDetails(userId: string): [boolean, (on: boolean) => void] {
  const value = useSyncExternalStore(onEventDetailsChanged, () => showEventDetails(userId));
  const set = useCallback((on: boolean) => setShowEventDetails(userId, on), [userId]);
  return [value, set];
}
