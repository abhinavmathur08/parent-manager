// Jest stand-in for expo-secure-store: an in-memory map per test run.
const items = new Map<string, string>();

export const AFTER_FIRST_UNLOCK = 0;
export const WHEN_UNLOCKED = 5;

export async function getItemAsync(key: string): Promise<string | null> {
  return items.get(key) ?? null;
}

export async function setItemAsync(key: string, value: string): Promise<void> {
  items.set(key, value);
}

export async function deleteItemAsync(key: string): Promise<void> {
  items.delete(key);
}

/** Test helper, not part of expo-secure-store. */
export function __reset(): void {
  items.clear();
}
