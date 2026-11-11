// An in-memory server for sync unit tests. It follows the rules of
// supabase/migrations/20261110100000_sync_rules.sql: the server sets `version`, timestamps
// and who checked an item; tombstones never change; a stale uncheck can't undo a check;
// removed members can't read or write. The real rules are proved by pgTAP and the
// two-device harness; this keeps unit tests fast.
import { RemoteError, type PageRequest, type SyncRemote } from '@/lib/sync/remote';
import type { SyncRow, SyncValue } from '@/lib/sync/types';

type Values = Record<string, unknown>;

const IMMUTABLE = ['id', 'household_id', 'created_at', 'updated_at', 'version'];

export class FakeServer {
  readonly tables = new Map<string, Map<string, SyncRow>>();
  /** Boolean columns with the check-off rule, by table. */
  readonly checkColumns = new Map<string, string[]>();
  /** Users who are no longer members; RLS hides everything from them. */
  readonly removed = new Set<string>();
  private tick = 0;
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
    return { ...row };
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
    return { ...row };
  }

  /** A device's view of the server, signed in as `user`. */
  remote(user = 'user-a', device: { offline: boolean } = this): SyncRemote {
    const request = () => {
      this.requests += 1;
      if (device.offline || this.offline) throw new RemoteError('Network request failed', 0, '');
    };
    const visible = (row: SyncRow | undefined) =>
      row && !this.removed.has(user) ? { ...row } : null;
    return {
      fetchPage: async (name: string, householdId: string, page: PageRequest) => {
        request();
        if (this.removed.has(user)) return [];
        return [...this.table(name).values()]
          .filter((r) => r.household_id === householdId)
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
        return visible(this.table(name).get(id));
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
        if (!old || this.removed.has(user)) return null;
        return this.applyUpdate(name, old, values, user);
      },
    };
  }
}
