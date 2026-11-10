/** Lock timeout choices, in minutes (FR-AUTH-6): immediately, 1, 5 or 15. */
export const LOCK_TIMEOUTS = [0, 1, 5, 15] as const;
export type LockTimeout = (typeof LOCK_TIMEOUTS)[number];

export type LockSettings = { enabled: boolean; timeoutMinutes: LockTimeout };

/** Off by default, with a 5-minute timeout when turned on (FR-AUTH-6, PROPOSED). */
export const DEFAULT_LOCK_SETTINGS: LockSettings = { enabled: false, timeoutMinutes: 5 };

/**
 * Whether opening the app now needs biometrics. `backgroundedAt` is when the app last went
 * to the background, or null if that isn't known (a first launch after turning the lock on
 * is treated as past the timeout, so a killed app always locks).
 */
export function shouldLock(
  settings: LockSettings,
  backgroundedAt: number | null,
  now: number,
): boolean {
  if (!settings.enabled) return false;
  if (backgroundedAt === null) return true;
  // A clock moved backwards counts as past the timeout.
  if (now < backgroundedAt) return true;
  return now - backgroundedAt >= settings.timeoutMinutes * 60_000;
}

export function parseLockSettings(stored: string | null): LockSettings {
  if (!stored) return DEFAULT_LOCK_SETTINGS;
  try {
    const value = JSON.parse(stored) as Partial<LockSettings>;
    const timeout = (LOCK_TIMEOUTS as readonly number[]).includes(value.timeoutMinutes ?? -1)
      ? (value.timeoutMinutes as LockTimeout)
      : DEFAULT_LOCK_SETTINGS.timeoutMinutes;
    return { enabled: value.enabled === true, timeoutMinutes: timeout };
  } catch {
    return DEFAULT_LOCK_SETTINGS;
  }
}
