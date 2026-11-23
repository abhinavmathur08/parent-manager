import Storage from 'expo-sqlite/kv-store';
import { useCallback, useSyncExternalStore } from 'react';

import { onSignOut } from '@/features/auth/sign-out';

/**
 * The member's device calendar settings (S-39, FR2-DEV-1 to FR2-DEV-5), kept on this device
 * only: device calendar IDs mean nothing on another phone. Both features are off until the
 * member turns them on. Signing out clears them, which also stops busy-time sharing
 * (FR2-PRIV-4).
 */
export type DeviceCalendarSettings = {
  /** "Copy to my calendar" (FR2-DEV-2). */
  copy: boolean;
  /** The writable device calendar the copies go to, or null for our own "Parent Manager" one. */
  copyTarget: string | null;
  /** Copy planned dinners too (FR2-DEV-3); off by default. */
  includeMeals: boolean;
  /** "Share my busy times" (FR2-DEV-4). */
  busy: boolean;
  /** The device calendars busy times are read from. */
  busyCalendars: string[];
};

export const DEFAULT_DEVICE_SETTINGS: DeviceCalendarSettings = {
  copy: false,
  copyTarget: null,
  includeMeals: false,
  busy: false,
  busyCalendars: [],
};

const KEY = 'calendar.device';

type Stored = { householdId: string; settings: DeviceCalendarSettings };

/** Reads stored settings, falling back to the defaults for anything missing or malformed. */
export function parseDeviceSettings(value: unknown): DeviceCalendarSettings {
  const raw = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>;
  const bool = (key: keyof DeviceCalendarSettings) =>
    typeof raw[key] === 'boolean' ? (raw[key] as boolean) : false;
  return {
    copy: bool('copy'),
    copyTarget: typeof raw.copyTarget === 'string' ? raw.copyTarget : null,
    includeMeals: bool('includeMeals'),
    busy: bool('busy'),
    busyCalendars: Array.isArray(raw.busyCalendars)
      ? raw.busyCalendars.filter((id): id is string => typeof id === 'string')
      : [],
  };
}

const listeners = new Set<() => void>();
let cache: { raw: string | null; householdId: string; settings: DeviceCalendarSettings } | null =
  null;

function readRaw(): string | null {
  try {
    return Storage.getItemSync(KEY);
  } catch {
    return null;
  }
}

/** This household's settings on this device. Another household's are the defaults. */
export function readDeviceSettings(householdId: string): DeviceCalendarSettings {
  const raw = readRaw();
  if (cache && cache.raw === raw && cache.householdId === householdId) return cache.settings;
  let settings = DEFAULT_DEVICE_SETTINGS;
  if (raw) {
    try {
      const stored = JSON.parse(raw) as Partial<Stored>;
      if (stored.householdId === householdId) settings = parseDeviceSettings(stored.settings);
    } catch {
      // Unreadable: the features stay off.
    }
  }
  cache = { raw, householdId, settings };
  return settings;
}

export function writeDeviceSettings(householdId: string, settings: DeviceCalendarSettings): void {
  const stored: Stored = { householdId, settings };
  try {
    Storage.setItemSync(KEY, JSON.stringify(stored));
  } finally {
    listeners.forEach((listener) => listener());
  }
}

export function clearDeviceSettings(): void {
  try {
    Storage.removeItemSync(KEY);
  } catch {
    // Nothing stored.
  } finally {
    listeners.forEach((listener) => listener());
  }
}

onSignOut(clearDeviceSettings);

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** The settings, live, with a function that changes some of them. */
export function useDeviceSettings(householdId: string) {
  const settings = useSyncExternalStore(subscribe, () => readDeviceSettings(householdId));
  const change = useCallback(
    (patch: Partial<DeviceCalendarSettings>) =>
      writeDeviceSettings(householdId, { ...readDeviceSettings(householdId), ...patch }),
    [householdId],
  );
  return [settings, change] as const;
}
