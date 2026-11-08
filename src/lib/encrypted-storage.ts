import { AESEncryptionKey, AESSealedData, aesDecryptAsync, aesEncryptAsync } from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';

/** Where the ciphertext lives: synchronous key-value storage, such as expo-sqlite's localStorage. */
export type DataStore = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

/** Where the AES keys live: expo-secure-store (Keychain on iOS, Keystore on Android). */
export type KeyStore = Pick<
  typeof SecureStore,
  'getItemAsync' | 'setItemAsync' | 'deleteItemAsync'
>;

/** The async storage interface that Supabase Auth accepts. */
export type AsyncStorage = {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
};

// Readable after the first unlock since restart, so a session refresh that starts while
// the screen is locked still works. Keys stay out of iCloud Keychain sync either way.
const KEY_OPTIONS: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK,
};

/** SecureStore keys may only use letters, digits, `.`, `-` and `_`. */
export function keyStoreName(key: string): string {
  return `${key.replace(/[^A-Za-z0-9._-]/g, '_')}.aes-key`;
}

// The ciphertext must be base64 for expo-crypto. Encoding the text as URI components
// first keeps it ASCII, so btoa and atob handle any Unicode in the session (such as a
// user's name) without needing TextDecoder.
function toBase64(text: string): string {
  return btoa(encodeURIComponent(text));
}

function fromBase64(base64: string): string {
  return decodeURIComponent(atob(base64));
}

/**
 * Encrypted storage for the Supabase session (F-08, FR-AUTH-5, NFR-SEC-1).
 *
 * Each storage key gets its own random AES-256 key, kept in SecureStore. The value is
 * sealed with AES-GCM and only the ciphertext goes to `data`, so the stored session
 * isn't readable as plain text and is tamper-evident. This avoids SecureStore's size
 * limits, which a session with its JWTs can exceed. Removing an item (sign-out)
 * deletes both the ciphertext and its key.
 *
 * A value that can't be decrypted (missing key, tampering, data restored from a
 * backup on another device) reads as signed out and is cleared.
 */
export function createEncryptedStorage(
  data: DataStore,
  keys: KeyStore = SecureStore,
): AsyncStorage {
  // One in-flight lookup per storage key, so overlapping writes share one AES key
  // instead of racing to create two.
  const keyCache = new Map<string, Promise<AESEncryptionKey>>();

  function loadOrCreateKey(key: string): Promise<AESEncryptionKey> {
    let pending = keyCache.get(key);
    if (!pending) {
      pending = (async () => {
        const stored = await keys.getItemAsync(keyStoreName(key), KEY_OPTIONS);
        if (stored) {
          return AESEncryptionKey.import(stored, 'hex');
        }
        const created = await AESEncryptionKey.generate();
        await keys.setItemAsync(keyStoreName(key), await created.encoded('hex'), KEY_OPTIONS);
        return created;
      })();
      keyCache.set(key, pending);
      // Don't cache a failure (for example, the keychain was briefly unavailable).
      pending.catch(() => keyCache.delete(key));
    }
    return pending;
  }

  async function removeItem(key: string): Promise<void> {
    keyCache.delete(key);
    data.removeItem(key);
    await keys.deleteItemAsync(keyStoreName(key), KEY_OPTIONS);
  }

  return {
    async getItem(key) {
      const sealed = data.getItem(key);
      if (sealed === null) {
        return null;
      }
      // If SecureStore itself fails, this throws and leaves everything in place, so a
      // temporary keychain error doesn't sign the user out.
      const storedKey = await keys.getItemAsync(keyStoreName(key), KEY_OPTIONS);
      if (!storedKey) {
        await removeItem(key);
        return null;
      }
      try {
        const aesKey = await AESEncryptionKey.import(storedKey, 'hex');
        const plain = await aesDecryptAsync(AESSealedData.fromCombined(sealed), aesKey, {
          output: 'base64',
        });
        return fromBase64(plain);
      } catch {
        await removeItem(key);
        return null;
      }
    },

    async setItem(key, value) {
      const aesKey = await loadOrCreateKey(key);
      const sealed = await aesEncryptAsync(toBase64(value), aesKey);
      data.setItem(key, await sealed.combined('base64'));
    },

    removeItem,
  };
}
