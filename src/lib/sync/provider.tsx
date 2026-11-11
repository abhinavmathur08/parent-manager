import type { SQLiteDatabase } from 'expo-sqlite';
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import { AppState } from 'react-native';

import { onSignOut } from '@/features/auth/sign-out';
import { useOnline } from '@/hooks/use-online';
import { getSupabase } from '@/lib/supabase';
import { deleteSyncDatabase, openSyncDatabase } from '@/lib/sync/database';
import { SyncEngine, type SyncStatus } from '@/lib/sync/engine';
import { LocalStore } from '@/lib/sync/local-store';
import { registeredTables } from '@/lib/sync/registry';
import { createSupabaseRemote } from '@/lib/sync/remote';
import type { SqlDatabase, SyncRow, SyncValue } from '@/lib/sync/types';

let database: Promise<SQLiteDatabase> | null = null;
let current: SyncEngine | null = null;

/** Opens the household's local copy and starts syncing it. One engine runs at a time. */
async function startSync(householdId: string): Promise<SyncEngine> {
  database ??= openSyncDatabase().catch((error: unknown) => {
    database = null;
    throw error;
  });
  const db = await database;
  current?.stop();
  const store = new LocalStore(db as unknown as SqlDatabase, registeredTables());
  const engine = new SyncEngine(store, createSupabaseRemote(getSupabase()), householdId);
  current = engine;
  await engine.open();
  return engine;
}

/** Stops syncing and deletes the encrypted local copy and its key (FR-AUTH-7). */
export async function resetSync(): Promise<void> {
  current?.stop();
  current = null;
  const db = database ? await database.catch(() => null) : null;
  database = null;
  await deleteSyncDatabase(db);
}

onSignOut(resetSync);

const SyncContext = createContext<SyncEngine | null>(null);

/**
 * Runs the sync layer for the member's household. Cached rows are readable as soon as the
 * local copy opens, online or not (NFR-OFF-1); a sync runs on start, on reconnecting and
 * when the app returns to the foreground.
 */
export function SyncProvider({
  householdId,
  children,
}: {
  householdId: string;
  children: ReactNode;
}) {
  const [engine, setEngine] = useState<SyncEngine | null>(null);
  const online = useOnline();

  useEffect(() => {
    let active = true;
    startSync(householdId).then(
      (started) => {
        if (active) setEngine(started);
        else started.stop();
      },
      () => undefined, // No local copy on this build; screens read nothing and say so.
    );
    return () => {
      active = false;
    };
  }, [householdId]);

  useEffect(() => {
    if (engine && online) void engine.sync();
  }, [engine, online]);

  useEffect(() => {
    if (!engine) return;
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') void engine.sync();
    });
    return () => subscription.remove();
  }, [engine]);

  return <SyncContext.Provider value={engine}>{children}</SyncContext.Provider>;
}

/** The running engine, or null while the local copy opens. */
export function useSyncEngine(): SyncEngine | null {
  return useContext(SyncContext);
}

const STARTING: SyncStatus = { state: 'starting', lastSyncedAt: null, pending: 0, rejected: 0 };

/** What the sync layer is doing, for status UI. */
export function useSyncStatus(): SyncStatus {
  const engine = useSyncEngine();
  return useSyncExternalStore(
    (notify) => engine?.onStatus(notify) ?? (() => undefined),
    () => engine?.getStatus() ?? STARTING,
  );
}

/**
 * Local writes for features: shown at once, queued in order, and sent when online
 * (H-06.3). Throws while the local copy is still opening.
 */
export function useSyncWriter() {
  const engine = useSyncEngine();
  return useMemo(() => {
    const ready = () => {
      if (!engine) throw new Error('The local copy is not open yet');
      return engine;
    };
    return {
      insert: (table: string, id: string, values: Record<string, SyncValue>) =>
        ready().insert(table, id, values),
      update: (table: string, id: string, values: Record<string, SyncValue>) =>
        ready().update(table, id, values),
      remove: (table: string, id: string) => ready().remove(table, id),
    };
  }, [engine]);
}

/**
 * The household's live rows of a registered table, from the local copy, so they show
 * offline and update when sync or a local write changes the table.
 */
export function useSyncedRows<T extends SyncRow = SyncRow>(
  table: string,
): { rows: T[]; loading: boolean } {
  const engine = useSyncEngine();
  const [state, setState] = useState<{ engine: SyncEngine | null; rows: T[] } | null>(null);

  useEffect(() => {
    if (!engine) return;
    let active = true;
    const load = () =>
      engine.store.rows(table).then(
        (rows) => active && setState({ engine, rows: rows as T[] }),
        () => undefined,
      );
    const unsubscribe = engine.store.subscribe((change) => {
      if (change.tables.has(table)) void load();
    });
    void load();
    return () => {
      active = false;
      unsubscribe();
    };
  }, [engine, table]);

  const fresh = state && state.engine === engine;
  return { rows: fresh ? state.rows : [], loading: !fresh };
}
