import Storage from 'expo-sqlite/kv-store';

// Under the drafts prefix, so sign-out and account deletion clear it with clearAllDrafts().
const KEY = 'draft:auth.pendingSignIn';

/** The email a code was sent to, and when, so the code screen survives the app being killed. */
export type PendingSignIn = { email: string; sentAt: number };

export function readPendingSignIn(): PendingSignIn | null {
  try {
    const stored = Storage.getItemSync(KEY);
    if (!stored) return null;
    const value = JSON.parse(stored) as Partial<PendingSignIn>;
    return typeof value.email === 'string' && typeof value.sentAt === 'number'
      ? { email: value.email, sentAt: value.sentAt }
      : null;
  } catch {
    return null;
  }
}

export function savePendingSignIn(value: PendingSignIn): void {
  try {
    Storage.setItemSync(KEY, JSON.stringify(value));
  } catch {
    // The code screen also gets the email from memory; losing it only matters after a restart.
  }
}

export function clearPendingSignIn(): void {
  try {
    Storage.removeItemSync(KEY);
  } catch {
    // Nothing to remove.
  }
}
