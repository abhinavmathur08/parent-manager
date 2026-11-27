import * as SecureStore from 'expo-secure-store';

import {
  createEncryptedStorage,
  keyStoreName,
  type DataStore,
  type KeyStore,
} from '@/lib/encrypted-storage';

// expo-crypto and expo-secure-store come from __mocks__/ at the repo root. The crypto
// mock runs real AES-256-GCM through Node's WebCrypto.

const STORAGE_KEY = 'sb-abc-auth-token';
const SESSION = JSON.stringify({
  access_token: 'eyJhbGciOiJIUzI1NiJ9.access.signature',
  refresh_token: 'refresh-token-value',
  user: { id: 'user-1', email: 'parent@example.com', user_metadata: { name: 'Zoë 李' } },
});

function memoryData(): DataStore & { items: Map<string, string> } {
  const items = new Map<string, string>();
  return {
    items,
    getItem: (key) => items.get(key) ?? null,
    setItem: (key, value) => void items.set(key, value),
    removeItem: (key) => void items.delete(key),
  };
}

function memoryKeys(): KeyStore & { items: Map<string, string> } {
  const items = new Map<string, string>();
  return {
    items,
    getItemAsync: jest.fn(async (key: string) => items.get(key) ?? null),
    setItemAsync: jest.fn(async (key: string, value: string) => void items.set(key, value)),
    deleteItemAsync: jest.fn(async (key: string) => void items.delete(key)),
  };
}

describe('createEncryptedStorage (F-08)', () => {
  it('returns the value it stored, including non-ASCII text', async () => {
    const storage = createEncryptedStorage(memoryData(), memoryKeys());
    await storage.setItem(STORAGE_KEY, SESSION);
    await expect(storage.getItem(STORAGE_KEY)).resolves.toBe(SESSION);
  });

  it('stores only ciphertext, never the session as plain text', async () => {
    const data = memoryData();
    const keys = memoryKeys();
    await createEncryptedStorage(data, keys).setItem(STORAGE_KEY, SESSION);

    const stored = data.items.get(STORAGE_KEY)!;
    expect(stored).not.toContain('access_token');
    expect(stored).not.toContain('refresh-token-value');
    expect(stored).not.toContain('parent@example.com');
    expect(atob(stored)).not.toContain('refresh-token-value');
    // The AES key lives in SecureStore, not next to the data.
    expect(keys.items.get(keyStoreName(STORAGE_KEY))).toMatch(/^[0-9a-f]{64}$/);
    expect([...data.items.values()].join()).not.toContain(
      keys.items.get(keyStoreName(STORAGE_KEY)),
    );
  });

  it('keeps the session across an app restart', async () => {
    const data = memoryData();
    const keys = memoryKeys();
    await createEncryptedStorage(data, keys).setItem(STORAGE_KEY, SESSION);

    const afterRestart = createEncryptedStorage(data, keys);
    await expect(afterRestart.getItem(STORAGE_KEY)).resolves.toBe(SESSION);
  });

  it('reuses one key per item, and overlapping first writes share it', async () => {
    const keys = memoryKeys();
    const storage = createEncryptedStorage(memoryData(), keys);
    await Promise.all([storage.setItem(STORAGE_KEY, 'a'), storage.setItem(STORAGE_KEY, 'b')]);
    await storage.setItem(STORAGE_KEY, SESSION);
    expect(keys.setItemAsync).toHaveBeenCalledTimes(1);
    await expect(storage.getItem(STORAGE_KEY)).resolves.toBe(SESSION);
  });

  it('seals each write with a fresh nonce', async () => {
    const data = memoryData();
    const storage = createEncryptedStorage(data, memoryKeys());
    await storage.setItem(STORAGE_KEY, SESSION);
    const first = data.items.get(STORAGE_KEY);
    await storage.setItem(STORAGE_KEY, SESSION);
    expect(data.items.get(STORAGE_KEY)).not.toBe(first);
  });

  it('deletes both the session and its key on sign-out', async () => {
    const data = memoryData();
    const keys = memoryKeys();
    const storage = createEncryptedStorage(data, keys);
    await storage.setItem(STORAGE_KEY, SESSION);

    await storage.removeItem(STORAGE_KEY);

    expect(data.items.size).toBe(0);
    expect(keys.items.size).toBe(0);
    await expect(storage.getItem(STORAGE_KEY)).resolves.toBeNull();
  });

  it('uses a new key after sign-out, so an old copy of the data stays unreadable', async () => {
    const data = memoryData();
    const keys = memoryKeys();
    const storage = createEncryptedStorage(data, keys);
    await storage.setItem(STORAGE_KEY, SESSION);
    const oldKey = keys.items.get(keyStoreName(STORAGE_KEY));

    await storage.removeItem(STORAGE_KEY);
    await storage.setItem(STORAGE_KEY, 'next session');

    expect(keys.items.get(keyStoreName(STORAGE_KEY))).not.toBe(oldKey);
  });

  it('returns null when nothing is stored', async () => {
    const keys = memoryKeys();
    const storage = createEncryptedStorage(memoryData(), keys);
    await expect(storage.getItem(STORAGE_KEY)).resolves.toBeNull();
    expect(keys.getItemAsync).not.toHaveBeenCalled();
  });

  it('treats data without its key (for example, restored from a backup) as signed out', async () => {
    const data = memoryData();
    const keys = memoryKeys();
    await createEncryptedStorage(data, keys).setItem(STORAGE_KEY, SESSION);
    keys.items.clear();

    await expect(createEncryptedStorage(data, keys).getItem(STORAGE_KEY)).resolves.toBeNull();
    expect(data.items.has(STORAGE_KEY)).toBe(false);
  });

  it('treats tampered data as signed out and clears it', async () => {
    const data = memoryData();
    const keys = memoryKeys();
    await createEncryptedStorage(data, keys).setItem(STORAGE_KEY, SESSION);
    const bytes = atob(data.items.get(STORAGE_KEY)!);
    const flipped = String.fromCharCode(bytes.charCodeAt(bytes.length - 1) ^ 0xff);
    data.items.set(STORAGE_KEY, btoa(bytes.slice(0, -1) + flipped));

    await expect(createEncryptedStorage(data, keys).getItem(STORAGE_KEY)).resolves.toBeNull();
    expect(data.items.has(STORAGE_KEY)).toBe(false);
    expect(keys.items.size).toBe(0);
  });

  it('treats an old unencrypted session as signed out', async () => {
    const data = memoryData();
    data.items.set(STORAGE_KEY, SESSION);
    await expect(
      createEncryptedStorage(data, memoryKeys()).getItem(STORAGE_KEY),
    ).resolves.toBeNull();
    expect(data.items.has(STORAGE_KEY)).toBe(false);
  });

  it('keeps the session when SecureStore fails, rather than signing out', async () => {
    const data = memoryData();
    const keys = memoryKeys();
    await createEncryptedStorage(data, keys).setItem(STORAGE_KEY, SESSION);
    const storage = createEncryptedStorage(data, keys);
    jest.mocked(keys.getItemAsync).mockRejectedValueOnce(new Error('Keychain unavailable'));

    await expect(storage.getItem(STORAGE_KEY)).rejects.toThrow('Keychain unavailable');
    expect(data.items.has(STORAGE_KEY)).toBe(true);
    await expect(storage.getItem(STORAGE_KEY)).resolves.toBe(SESSION);
  });

  // #336: Supabase reads the session before every request, so the first sync's parallel
  // pulls read it all at once. A Keystore read that failed under that load deleted the
  // session, and every later request went out as anon.
  it('shares one SecureStore read between parallel reads at launch', async () => {
    const data = memoryData();
    const keys = memoryKeys();
    await createEncryptedStorage(data, keys).setItem(STORAGE_KEY, SESSION);
    // A key store that finds nothing when another read is already in flight.
    let inFlight = 0;
    const stored = keys.items.get(keyStoreName(STORAGE_KEY))!;
    jest.mocked(keys.getItemAsync).mockClear();
    jest.mocked(keys.getItemAsync).mockImplementation(async () => {
      inFlight += 1;
      await new Promise((resolve) => setTimeout(resolve, 5));
      inFlight -= 1;
      return inFlight > 0 ? null : stored;
    });

    const afterLaunch = createEncryptedStorage(data, keys);
    const reads = await Promise.all(
      Array.from({ length: 22 }, () => afterLaunch.getItem(STORAGE_KEY)),
    );

    expect(reads.every((read) => read === SESSION)).toBe(true);
    expect(data.items.has(STORAGE_KEY)).toBe(true);
    expect(keys.getItemAsync).toHaveBeenCalledTimes(1);
  });

  it('answers reads after a write from memory, without SecureStore', async () => {
    const keys = memoryKeys();
    const storage = createEncryptedStorage(memoryData(), keys);
    await storage.setItem(STORAGE_KEY, SESSION);
    jest.mocked(keys.getItemAsync).mockRejectedValue(new Error('Keychain busy'));

    await expect(storage.getItem(STORAGE_KEY)).resolves.toBe(SESSION);
    await storage.setItem(STORAGE_KEY, 'refreshed');
    await expect(storage.getItem(STORAGE_KEY)).resolves.toBe('refreshed');
  });

  it("doesn't bring back an older value read while a newer one was written", async () => {
    const data = memoryData();
    const keys = memoryKeys();
    await createEncryptedStorage(data, keys).setItem(STORAGE_KEY, 'old session');
    const storage = createEncryptedStorage(data, keys);

    const read = storage.getItem(STORAGE_KEY);
    await storage.setItem(STORAGE_KEY, SESSION);

    await expect(read).resolves.toBe('old session');
    await expect(storage.getItem(STORAGE_KEY)).resolves.toBe(SESSION);
  });

  it('names SecureStore keys with only the characters it allows', () => {
    expect(keyStoreName('sb-abc-auth-token')).toBe('sb-abc-auth-token.aes-key');
    expect(keyStoreName('a b/c:d')).toMatch(/^[A-Za-z0-9._-]+$/);
  });

  it('uses expo-secure-store by default', async () => {
    (SecureStore as typeof SecureStore & { __reset(): void }).__reset();
    const storage = createEncryptedStorage(memoryData());
    await storage.setItem(STORAGE_KEY, SESSION);
    await expect(SecureStore.getItemAsync(keyStoreName(STORAGE_KEY))).resolves.toMatch(
      /^[0-9a-f]{64}$/,
    );
  });
});
