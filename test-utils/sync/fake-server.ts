// An in-memory server for sync unit tests. It keeps the server's system columns the way
// the database does: it sets `version` and `updated_at`, and keeps tombstones.
import type { PageRequest, SyncRemote } from '@/lib/sync/remote';
import type { SyncRow, SyncValue } from '@/lib/sync/types';

export class FakeServer {
  readonly tables = new Map<string, Map<string, SyncRow>>();
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
    const now = this.timestamp();
    const row: SyncRow = {
      ...old,
      ...values,
      version: (old?.version ?? 0) + 1,
      created_at: old?.created_at ?? now,
      updated_at: now,
      deleted_at: old?.deleted_at ?? (values.deleted_at ? now : null),
    };
    this.table(name).set(row.id, row);
    return row;
  }

  remote(): SyncRemote {
    return {
      fetchPage: async (name: string, householdId: string, request: PageRequest) => {
        this.requests += 1;
        if (this.offline) throw new TypeError('Network request failed');
        return [...this.table(name).values()]
          .filter((r) => r.household_id === householdId)
          .filter((r) => request.includeDeleted || !r.deleted_at)
          .filter((r) => !request.since || r.updated_at! >= request.since.replace('Z', '+00:00'))
          .filter(
            (r) =>
              !request.after ||
              r.updated_at! > request.after.updatedAt ||
              (r.updated_at === request.after.updatedAt && r.id > request.after.id),
          )
          .sort((a, b) => a.updated_at!.localeCompare(b.updated_at!) || a.id.localeCompare(b.id))
          .slice(0, request.limit)
          .map((r) => ({ ...r }));
      },
    };
  }
}
