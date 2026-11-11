import Storage from 'expo-sqlite/kv-store';

type Cleanup = () => Promise<void> | void;

const cleanups = new Set<Cleanup>();

/**
 * Registers work to do when this device loses access to its household: the member was
 * removed, their access was paused, or they left (FR-HH-10, FR-PAY-9). Modules that keep
 * household data on the device add their own, as with `onSignOut`: the sync layer clears
 * its local copy. Returns a function that unregisters it.
 */
export function onHouseholdAccessLost(cleanup: Cleanup): () => void {
  cleanups.add(cleanup);
  return () => {
    cleanups.delete(cleanup);
  };
}

/** Runs every registered cleanup. One failing doesn't skip the others. */
export async function clearHouseholdData(): Promise<void> {
  await Promise.allSettled([...cleanups].map(async (cleanup) => cleanup()));
}

// A removed member sees S-35 once per household; after that they're onboarded as new.
const SEEN_KEY = 'household.removalSeen';

export function removalSeen(userId: string, householdId: string): boolean {
  try {
    return Storage.getItemSync(SEEN_KEY) === `${userId}:${householdId}`;
  } catch {
    return false;
  }
}

export function markRemovalSeen(userId: string, householdId: string) {
  try {
    Storage.setItemSync(SEEN_KEY, `${userId}:${householdId}`);
  } catch {
    // Seeing S-35 again is harmless.
  }
}
