import Storage from 'expo-sqlite/kv-store';

import { onSignOut } from '@/features/auth/sign-out';
import { parseLockSettings, type LockSettings } from '@/features/biometric/lock-policy';

// Per device, never synced: the lock protects this phone, not the account.
const SETTINGS_KEY = 'biometric.lock';
const BACKGROUNDED_KEY = 'biometric.backgroundedAt';

export function readLockSettings(): LockSettings {
  try {
    return parseLockSettings(Storage.getItemSync(SETTINGS_KEY));
  } catch {
    return parseLockSettings(null);
  }
}

export function writeLockSettings(settings: LockSettings): void {
  try {
    Storage.setItemSync(SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    // Not saved: the lock stays as it was at the next launch.
  }
}

export function readBackgroundedAt(): number | null {
  try {
    const stored = Storage.getItemSync(BACKGROUNDED_KEY);
    const value = stored === null ? NaN : Number(stored);
    return Number.isFinite(value) ? value : null;
  } catch {
    return null;
  }
}

export function writeBackgroundedAt(time: number): void {
  try {
    Storage.setItemSync(BACKGROUNDED_KEY, String(time));
  } catch {
    // Unknown counts as past the timeout, which errs on the side of locking.
  }
}

// The next person to sign in on this device starts with the lock off (FR-AUTH-6 default).
onSignOut(() => {
  Storage.removeItemSync(SETTINGS_KEY);
  Storage.removeItemSync(BACKGROUNDED_KEY);
});
