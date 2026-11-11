import { getRandomBytesAsync } from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';
import * as SQLite from 'expo-sqlite';

const DATABASE_NAME = 'household-sync.db';
const KEY_NAME = 'sync.database-key';
const KEY_OPTIONS: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK,
};

const toHex = (bytes: Uint8Array) =>
  Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');

async function keyed(key: string): Promise<SQLite.SQLiteDatabase> {
  const db = await SQLite.openDatabaseAsync(DATABASE_NAME, { useNewConnection: true });
  // A raw 256-bit key, so SQLCipher skips its key derivation.
  await db.execAsync(`PRAGMA key = "x'${key}'";`);
  return db;
}

/**
 * Opens the local copy of household data, encrypted with SQLCipher (FR-AUTH-7, NFR-SEC-1).
 * The random key lives in SecureStore, like the session's (F-08). Without the key the old
 * file is unreadable, so it's replaced; the server still has everything but unsent writes.
 * Refuses to run on a build without SQLCipher rather than store household data in the clear.
 */
export async function openSyncDatabase(): Promise<SQLite.SQLiteDatabase> {
  let key = await SecureStore.getItemAsync(KEY_NAME, KEY_OPTIONS);
  if (!key) {
    key = toHex(await getRandomBytesAsync(32));
    await SQLite.deleteDatabaseAsync(DATABASE_NAME).catch(() => undefined);
    await SecureStore.setItemAsync(KEY_NAME, key, KEY_OPTIONS);
  }
  let db = await keyed(key);
  if (!(await db.getFirstAsync('PRAGMA cipher_version;'))) {
    await db.closeAsync();
    throw new Error('This build has no SQLCipher, so household data is not stored on the device.');
  }
  try {
    await db.getFirstAsync('SELECT count(*) FROM sqlite_master;');
  } catch {
    await db.closeAsync();
    await SQLite.deleteDatabaseAsync(DATABASE_NAME);
    db = await keyed(key);
  }
  await db.execAsync('PRAGMA journal_mode = WAL;');
  return db;
}

/** Deletes the local copy and its key (sign-out, FR-AUTH-7). */
export async function deleteSyncDatabase(db: SQLite.SQLiteDatabase | null): Promise<void> {
  await db?.closeAsync().catch(() => undefined);
  await SQLite.deleteDatabaseAsync(DATABASE_NAME).catch(() => undefined);
  await SecureStore.deleteItemAsync(KEY_NAME, KEY_OPTIONS);
}
