// An in-memory server for sync unit tests. It follows the rules of
// supabase/migrations/20261110100000_sync_rules.sql: the server sets `version`, timestamps
// and who checked an item; tombstones never change; a stale uncheck can't undo a check;
// removed members can't read or write. The real rules are proved by pgTAP and the
// two-device harness; this keeps unit tests fast.
import {
  RemoteError,
  type ChangeListener,
  type PageRequest,
  type SyncRemote,
} from '@/lib/sync/remote';
import type { SyncRow, SyncValue } from '@/lib/sync/types';

type Values = Record<string, unknown>;

const IMMUTABLE = ['id', 'household_id', 'created_at', 'updated_at', 'version'];

export class FakeServer {
  readonly tables = new Map<string, Map<string, SyncRow>>();
  /** Boolean columns with the check-off rule, by table. */
  readonly checkColumns = new Map<string, string[]>();
  /** Users who are no longer members; RLS hides everything from them. */
  readonly removed = new Set<string>();
  /** Per-row visibility, like an unshared event hidden from a caregiver (C-01.3). */
  canSee: (user: string, table: string, row: SyncRow) => boolean = () => true;
  /** Tables `visibleIds` answers for, like the server's scoped registry. */
  readonly scoped = new Set<string>();
  private tick = 0;
  private readonly subscribers = new Set<{
    user: string;
    householdId: string;
    tables: readonly string[];
    listener: ChangeListener;
  }>();
  /** Set to make every request fail as if the device were offline. */
  offline = false;
  requests = 0;

  /** A server timestamp, strictly increasing, in the format Postgres returns. */
  timestamp(): string {
    this.tick += 1;
    return new Date(Date.UTC(2026, 10, 10) + this.tick).toISOString().replace('Z', '+00:00');
  }

  table(name: string): Map<string, SyncRow> {
    let rows = this.tables.get(name);
    if (!rows) {
      rows = new Map();
      this.tables.set(name, rows);
    }
    return rows;
  }

  /** Writes a row as another client would, with server-set columns. */
  put(name: string, values: { id: string; household_id: string; [column: string]: SyncValue }) {
    const old = this.table(name).get(values.id);
    return old
      ? this.applyUpdate(name, old, values, 'server')
      : this.applyInsert(name, values, 'server');
  }

  private applyInsert(name: string, values: Values, user: string): SyncRow {
    const now = this.timestamp();
    const row = { ...values, version: 1, created_at: now, updated_at: now } as SyncRow;
    row.deleted_at = values.deleted_at ? now : null;
    for (const col of this.checkColumns.get(name) ?? []) {
      row[col] = !!values[col];
      row[`${col}_at`] = row[col] ? now : null;
      row[`${col}_by`] = row[col] ? user : null;
    }
    this.table(name).set(row.id, row);
    this.notify(name, row);
    return { ...row };
  }

  /** Realtime: each subscriber who can still see the row gets it, after the write. */
  private notify(name: string, row: SyncRow) {
    for (const s of this.subscribers) {
      if (
        s.tables.includes(name) &&
        s.householdId === row.household_id &&
        !this.removed.has(s.user) &&
        this.canSee(s.user, name, row)
      ) {
        const copy = { ...row };
        queueMicrotask(() => s.listener.onRow(name, copy));
      }
    }
  }

  private applyUpdate(name: string, old: SyncRow, values: Values, user: string): SyncRow {
    if (old.deleted_at) return { ...old };
    const now = this.timestamp();
    const stale = values.version !== undefined && values.version !== old.version;
    const row: SyncRow = { ...old };
    for (const [key, value] of Object.entries(values)) {
      if (!IMMUTABLE.includes(key)) row[key] = value as SyncValue;
    }
    for (const col of this.checkColumns.get(name) ?? []) {
      const was = !!old[col];
      let is = !!row[col];
      if (was && !is && stale) is = true;
      row[col] = is;
      row[`${col}_at`] = is ? (was ? old[`${col}_at`] : now) : null;
      row[`${col}_by`] = is ? (was ? old[`${col}_by`] : user) : null;
    }
    row.deleted_at = row.deleted_at ? now : null;
    row.version = old.version + 1;
    row.updated_at = now;
    this.table(name).set(row.id, row);
    this.notify(name, row);
    return { ...row };
  }

  /** A device's view of the server, signed in as `user`. */
  remote(user = 'user-a', device: { offline: boolean } = this): SyncRemote {
    const request = () => {
      this.requests += 1;
      if (device.offline || this.offline) throw new RemoteError('Network request failed', 0, '');
    };
    const sees = (name: string, row: SyncRow) =>
      !this.removed.has(user) && this.canSee(user, name, row);
    const visible = (name: string, row: SyncRow | undefined) =>
      row && sees(name, row) ? { ...row } : null;
    return {
      fetchPage: async (name: string, householdId: string, page: PageRequest) => {
        request();
        if (this.removed.has(user)) return [];
        return [...this.table(name).values()]
          .filter((r) => r.household_id === householdId && sees(name, r))
          .filter((r) => page.includeDeleted || !r.deleted_at)
          .filter((r) => !page.since || r.updated_at! >= page.since.replace('Z', '+00:00'))
          .filter(
            (r) =>
              !page.after ||
              r.updated_at! > page.after.updatedAt ||
              (r.updated_at === page.after.updatedAt && r.id > page.after.id),
          )
          .sort((a, b) => a.updated_at!.localeCompare(b.updated_at!) || a.id.localeCompare(b.id))
          .slice(0, page.limit)
          .map((r) => ({ ...r }));
      },
      fetchRow: async (name, id) => {
        request();
        return visible(name, this.table(name).get(id));
      },
      fetchRows: async (name, ids) => {
        request();
        return ids.flatMap((id) => visible(name, this.table(name).get(id)) ?? []);
      },
      visibleIds: async (name, householdId) => {
        request();
        if (!this.scoped.has(name)) throw new RemoteError('not a scoped sync table', 400, '22023');
        return [...this.table(name).values()]
          .filter((r) => r.household_id === householdId && !r.deleted_at && sees(name, r))
          .map((r) => r.id);
      },
      insert: async (name, rows) => {
        request();
        if (this.removed.has(user)) throw new RemoteError('RLS', 403, '42501');
        if (rows.some((r) => this.table(name).has(r.id as string))) {
          throw new RemoteError('duplicate key', 409, '23505');
        }
        return rows.map((r) => this.applyInsert(name, r, user));
      },
      update: async (name, id, values) => {
        request();
        const old = this.table(name).get(id);
        if (!old || !sees(name, old)) return null;
        return this.applyUpdate(name, old, values, user);
      },
      subscribe: (householdId, tables, listener) => {
        const subscriber = { user, householdId, tables, listener };
        this.subscribers.add(subscriber);
        listener.onState('connecting');
        queueMicrotask(() => {
          if (this.subscribers.has(subscriber)) listener.onState('connected');
        });
        return () => {
          this.subscribers.delete(subscriber);
          listener.onState('off');
        };
      },
    };
  }
}
