import Storage from 'expo-sqlite/kv-store';
import { AppState } from 'react-native';

import { onSignOut } from '@/features/auth/sign-out';

import {
  DEFAULT_VAULT_SETTINGS,
  parseVaultSettings,
  shouldLockVault,
  type VaultLockSettings,
  type VaultSession,
} from './vault-lock-policy';

// Per device, never synced: the lock protects this phone (FR2-DOC-3).
const SETTINGS_KEY = 'vault.lock';

const session: VaultSession = { unlockedAt: null, backgroundedAt: null };
let listening = false;

/** Records when the app goes away, wherever the member is, so the timeout counts from then. */
function listen() {
  if (listening) return;
  listening = true;
  AppState.addEventListener('change', (state) => {
    if (state === 'background') session.backgroundedAt = Date.now();
  });
}

export function readVaultSettings(): VaultLockSettings {
  try {
    return parseVaultSettings(Storage.getItemSync(SETTINGS_KEY));
  } catch {
    return DEFAULT_VAULT_SETTINGS;
  }
}

export function writeVaultSettings(settings: VaultLockSettings): void {
  try {
    Storage.setItemSync(SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    // Not saved: the setting stays as it was at the next launch.
  }
}

export function vaultNeedsUnlock(now = Date.now()): boolean {
  listen();
  return shouldLockVault(readVaultSettings(), session, now);
}

export function markVaultUnlocked(now = Date.now()): void {
  listen();
  session.unlockedAt = now;
  session.backgroundedAt = null;
}

export function lockVault(): void {
  session.unlockedAt = null;
  session.backgroundedAt = null;
}

// The next person to sign in starts locked, with the default setting.
onSignOut(() => {
  lockVault();
  Storage.removeItemSync(SETTINGS_KEY);
});
