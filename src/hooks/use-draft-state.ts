import Storage from 'expo-sqlite/kv-store';
import { useCallback, useEffect, useRef, useState } from 'react';

const PREFIX = 'draft:';

function read<T>(key: string, initial: T): T {
  try {
    const stored = Storage.getItemSync(PREFIX + key);
    return stored === null ? initial : (JSON.parse(stored) as T);
  } catch {
    return initial;
  }
}

/**
 * State for an in-progress form (a sheet, a recipe edit, an import review) that survives the
 * app being backgrounded and killed by the OS (NFR-A11Y-8). It's saved on the device only, in
 * the SQLite key-value store, and never synced. Call `clear()` when the form is saved or
 * discarded.
 */
export function useDraftState<T>(key: string, initial: T) {
  const [value, setValue] = useState<T>(() => read(key, initial));
  const cleared = useRef(false);
  // The caller's starting value, kept so a new object on each render doesn't reset the draft.
  const initialRef = useRef(initial);

  useEffect(() => {
    if (cleared.current) return;
    try {
      Storage.setItemSync(PREFIX + key, JSON.stringify(value));
    } catch {
      // Losing a draft is better than crashing the form.
    }
  }, [key, value]);

  const update = useCallback((next: T | ((previous: T) => T)) => {
    cleared.current = false;
    setValue(next);
  }, []);

  const clear = useCallback(() => {
    cleared.current = true;
    try {
      Storage.removeItemSync(PREFIX + key);
    } catch {
      // Nothing to remove.
    }
    setValue(initialRef.current);
  }, [key]);

  return [value, update, clear] as const;
}

/** Removes every saved draft, for sign-out and account deletion. */
export async function clearAllDrafts(): Promise<void> {
  const keys = await Storage.getAllKeys();
  await Promise.all(
    keys.filter((key) => key.startsWith(PREFIX)).map((key) => Storage.removeItem(key)),
  );
}
