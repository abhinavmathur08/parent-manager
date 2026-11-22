/** How long the vault stays unlocked while the app is away, in minutes (FR2-DOC-3). */
export const VAULT_TIMEOUTS = [0, 1, 5] as const;
export type VaultTimeout = (typeof VAULT_TIMEOUTS)[number];

export type VaultLockSettings = { enabled: boolean; timeoutMinutes: VaultTimeout };

/**
 * On by default on every device, locking again after 1 minute in the background (FR2-DOC-3,
 * PROPOSED). Separate from the app lock (FR-AUTH-6), which is off by default.
 */
export const DEFAULT_VAULT_SETTINGS: VaultLockSettings = { enabled: true, timeoutMinutes: 1 };

/** This launch's unlock: kept in memory only, so a killed app always locks the vault. */
export type VaultSession = { unlockedAt: number | null; backgroundedAt: number | null };

/** Whether opening the vault now needs a biometric or passcode check. */
export function shouldLockVault(
  settings: VaultLockSettings,
  session: VaultSession,
  now: number,
): boolean {
  if (!settings.enabled) return false;
  if (session.unlockedAt === null) return true;
  // Unlocked and never away since: stays open while the member moves around the app.
  if (session.backgroundedAt === null || session.backgroundedAt < session.unlockedAt) return false;
  // A clock moved backwards counts as past the timeout.
  if (now < session.backgroundedAt) return true;
  return now - session.backgroundedAt >= settings.timeoutMinutes * 60_000;
}

export function parseVaultSettings(stored: string | null): VaultLockSettings {
  if (!stored) return DEFAULT_VAULT_SETTINGS;
  try {
    const value = JSON.parse(stored) as Partial<VaultLockSettings>;
    const timeout = (VAULT_TIMEOUTS as readonly number[]).includes(value.timeoutMinutes ?? -1)
      ? (value.timeoutMinutes as VaultTimeout)
      : DEFAULT_VAULT_SETTINGS.timeoutMinutes;
    // Anything unreadable stays locked.
    return { enabled: value.enabled !== false, timeoutMinutes: timeout };
  } catch {
    return DEFAULT_VAULT_SETTINGS;
  }
}
