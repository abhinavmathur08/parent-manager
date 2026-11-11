import type { LocalStore } from '@/lib/sync/local-store';
import type { PageCursor, SyncRemote } from '@/lib/sync/remote';

/** What the sync layer is doing, for the UI. */
export type SyncState = 'starting' | 'syncing' | 'idle' | 'offline';

export type SyncStatus = {
  state: SyncState;
  /** Device time of the last pull that finished, or null. */
  lastSyncedAt: number | null;
};

export const PAGE_SIZE = 500;
/**
 * Pulls start this far before the newest `updated_at` seen, so a write that committed late
 * with an earlier timestamp isn't missed. Rows seen twice are skipped by their version.
 */
export const PULL_OVERLAP_MS = 60_000;
/** A device away longer than this lists the whole household again (NFR-OFF-6). */
export const STALE_AFTER_MS = 30 * 24 * 60 * 60 * 1000;

type Clock = () => number;

/**
 * Keeps the local copy in step with the server for one household (architecture section 5).
 * H-06.2 pulls; the outbox (H-06.3) and Realtime (H-06.4) build on it.
 */
export class SyncEngine {
  private status: SyncStatus = { state: 'starting', lastSyncedAt: null };
  private readonly listeners = new Set<(status: SyncStatus) => void>();
  private running: Promise<void> | null = null;
  private again = false;
  private stopped = false;

  constructor(
    readonly store: LocalStore,
    readonly remote: SyncRemote,
    readonly householdId: string,
    protected readonly now: Clock = Date.now,
  ) {}

  /** Opens the local copy, so cached rows can be read before anything is fetched. */
  async open(): Promise<void> {
    await this.store.open(this.householdId);
  }

  getStatus(): SyncStatus {
    return this.status;
  }

  onStatus(listener: (status: SyncStatus) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /**
   * Brings the local copy up to date. Calls made while a sync is running are folded into
   * one more run afterwards. Never throws: a failure leaves the status `offline`, and the
   * next call tries again.
   */
  sync(): Promise<void> {
    if (this.stopped) return Promise.resolve();
    if (this.running) {
      this.again = true;
      return this.running;
    }
    this.running = (async () => {
      do {
        this.again = false;
        await this.runOnce();
      } while (this.again && !this.stopped);
    })().finally(() => {
      this.running = null;
    });
    return this.running;
  }

  stop(): void {
    this.stopped = true;
    this.listeners.clear();
  }

  protected setStatus(patch: Partial<SyncStatus>): void {
    this.status = { ...this.status, ...patch };
    for (const listener of this.listeners) listener(this.status);
  }

  protected async runOnce(): Promise<void> {
    this.setStatus({ state: 'syncing' });
    try {
      await this.pullAll();
      this.setStatus({ state: 'idle', lastSyncedAt: this.now() });
    } catch {
      this.setStatus({ state: 'offline' });
    }
  }

  protected async pullAll(): Promise<void> {
    for (const table of this.store.tableNames()) {
      if (this.stopped) return;
      await this.pullTable(table);
    }
  }

  /**
   * Pulls one table. The first pull, or one after more than 30 days away, lists every
   * live row and drops local rows the server no longer has. Later pulls fetch changes
   * since the cursor, including tombstones.
   */
  async pullTable(table: string): Promise<void> {
    const cursor = await this.store.getMeta(`cursor:${table}`);
    const pulledAt = Number(await this.store.getMeta(`pulledAt:${table}`));
    const full = !cursor || !pulledAt || this.now() - pulledAt > STALE_AFTER_MS;
    const since = full ? null : new Date(Date.parse(cursor) - PULL_OVERLAP_MS).toISOString();

    let newest = full ? null : cursor;
    let after: PageCursor | null = null;
    const seen = new Set<string>();
    for (;;) {
      const rows = await this.remote.fetchPage(table, this.householdId, {
        since,
        after,
        includeDeleted: !full,
        limit: PAGE_SIZE,
      });
      if (this.stopped) return;
      await this.store.applyServerRows(table, rows);
      for (const row of rows) {
        seen.add(row.id);
        if (row.updated_at && (!newest || row.updated_at > newest)) newest = row.updated_at;
      }
      const last = rows.at(-1);
      if (rows.length < PAGE_SIZE || !last?.updated_at) break;
      after = { updatedAt: last.updated_at, id: last.id };
    }
    if (full) await this.store.removeRowsExcept(table, seen);
    if (newest) await this.store.setMeta(`cursor:${table}`, newest);
    await this.store.setMeta(`pulledAt:${table}`, String(this.now()));
  }
}
