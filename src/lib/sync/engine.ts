import type { LocalStore, OutboxOp } from '@/lib/sync/local-store';
import {
  RemoteError,
  type PageCursor,
  type RealtimeState,
  type SyncRemote,
} from '@/lib/sync/remote';
import type { SyncRow, SyncValue } from '@/lib/sync/types';

/** What the sync layer is doing, for the UI. */
export type SyncState = 'starting' | 'syncing' | 'idle' | 'offline';

export type SyncStatus = {
  state: SyncState;
  /** Device time of the last sync that finished, or null. */
  lastSyncedAt: number | null;
  /** Local writes not yet on the server (NFR-OFF-3). */
  pending: number;
  /** Writes the server refused since the user was last told (NFR-OFF-6). */
  rejected: number;
  /** Whether other members' changes are arriving live (H-06.4). */
  realtime: RealtimeState;
  /**
   * True on a device that has never pulled this household, until its first sync finishes
   * (A-01.3, FR-AUTH-8). The app shows a loading state instead of empty screens meanwhile.
   */
  firstLoad: boolean;
};

export const PAGE_SIZE = 500;
/**
 * Pulls start this far before the newest `updated_at` seen, so a write that committed late
 * with an earlier timestamp isn't missed. Rows seen twice are skipped by their version.
 */
export const PULL_OVERLAP_MS = 60_000;
/** A device away longer than this lists the whole household again (NFR-OFF-6). */
export const STALE_AFTER_MS = 30 * 24 * 60 * 60 * 1000;
/** A write that keeps failing for a reason other than the network is dropped after this. */
export const MAX_ATTEMPTS = 8;
/** Up to this many queued creates on one table go in one request. */
export const INSERT_BATCH = 100;
/** Up to this many updates to different rows are sent at once (NFR-OFF-4). */
export const PARALLEL_UPDATES = 8;
const MAX_RETRY_MS = 30_000;

type Clock = () => number;

/**
 * How a failed request is handled:
 * - `wait`: offline, signed-in session refreshing, rate-limited or the server is down. The
 *   write waits, however long that takes, and nothing is counted.
 * - `refused`: the server will never accept it, such as RLS after a member was removed or a
 *   constraint. The write leaves the queue so it can't stall it (the spike's failure).
 * - `retry`: any other client error, tried again later and dropped after MAX_ATTEMPTS.
 */
export function classify(error: unknown): 'wait' | 'refused' | 'retry' {
  if (!(error instanceof RemoteError)) return 'wait';
  const { status, code } = error;
  if (status === 0 || status === 401 || status === 408 || status === 429 || status >= 500) {
    return 'wait';
  }
  if (code === '42501' || /^2[23]/.test(code)) return 'refused';
  return 'retry';
}

/** Thrown inside a sync run to stop pushing until the next run. */
class StopPush extends Error {}

/**
 * Keeps the local copy in step with the server for one household (architecture section 5).
 * A run pushes queued writes in order (H-06.3), then pulls changes (H-06.2). Realtime
 * (H-06.4) builds on it.
 */
export class SyncEngine {
  private status: SyncStatus = {
    state: 'starting',
    lastSyncedAt: null,
    pending: 0,
    rejected: 0,
    realtime: 'off',
    firstLoad: false,
  };
  private readonly listeners = new Set<(status: SyncStatus) => void>();
  private running: Promise<void> | null = null;
  private again = false;
  private stopped = false;
  private failures = 0;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private unsubscribeStore: (() => void) | null = null;
  private unsubscribeRealtime: (() => void) | null = null;

  constructor(
    readonly store: LocalStore,
    readonly remote: SyncRemote,
    readonly householdId: string,
    protected readonly now: Clock = Date.now,
  ) {}

  /** Opens the local copy, so cached rows can be read before anything is fetched. */
  async open(): Promise<void> {
    await this.store.open(this.householdId);
    this.unsubscribeStore = this.store.subscribe((change) => {
      if (change.outbox) void this.refreshCounts();
    });
    await this.refreshCounts();
    const pulled = await Promise.all(
      this.store.tableNames().map((table) => this.store.getMeta(`pulledAt:${table}`)),
    );
    // A new table in an app update isn't a first load: the rest of the household is here.
    if (pulled.length > 0 && pulled.every((value) => !value)) this.setStatus({ firstLoad: true });
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

  // ---------------------------------------------------------------------------
  // Local writes: shown at once, queued, and sent when the device is online
  // ---------------------------------------------------------------------------

  async insert(table: string, id: string, values: Record<string, SyncValue>): Promise<SyncRow> {
    const row = await this.store.insert(table, id, values);
    void this.sync();
    return row;
  }

  async update(table: string, id: string, values: Record<string, SyncValue>): Promise<SyncRow> {
    const row = await this.store.update(table, id, values);
    void this.sync();
    return row;
  }

  async remove(table: string, id: string): Promise<SyncRow> {
    const row = await this.store.remove(table, id);
    void this.sync();
    return row;
  }

  /**
   * Pushes queued writes, then brings the local copy up to date. Calls made while a sync
   * is running are folded into one more run afterwards. Never throws: a failure leaves the
   * status `offline` and, with writes waiting, tries again with backoff.
   */
  sync(): Promise<void> {
    if (this.stopped) return Promise.resolve();
    if (this.running) {
      this.again = true;
      return this.running;
    }
    this.clearRetry();
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

  /**
   * Applies other members' changes as they happen, so they show within 2 seconds
   * (FR-HH-13, NFR-PERF-3). Each (re)join pulls once, to catch up on anything missed while
   * disconnected. Safe to call again.
   */
  startRealtime(): void {
    if (this.stopped || this.unsubscribeRealtime) return;
    let active = true;
    const unsubscribe = this.remote.subscribe(this.householdId, this.store.tableNames(), {
      onRow: (table, row) => {
        if (active) void this.receive(table, row);
      },
      onState: (realtime) => {
        if (!active || this.stopped || realtime === this.status.realtime) return;
        this.setStatus({ realtime });
        if (realtime === 'connected') void this.sync();
      },
    });
    this.unsubscribeRealtime = () => {
      active = false;
      unsubscribe();
    };
  }

  /** Stops listening, for example while offline or in the background. */
  stopRealtime(): void {
    const unsubscribe = this.unsubscribeRealtime;
    this.unsubscribeRealtime = null;
    unsubscribe?.();
    if (!this.stopped) this.setStatus({ realtime: 'off' });
  }

  /** A row from Realtime. Like a pulled row, it only applies if its version is newer. */
  private async receive(table: string, row: SyncRow): Promise<void> {
    if (this.stopped || row.household_id !== this.householdId) return;
    try {
      // A large unchanged value can be left out of an event; fetch the whole row then.
      const columns = Object.keys(this.store.definition(table).columns);
      const whole = columns.every((c) => c in row)
        ? row
        : await this.remote.fetchRow(table, row.id);
      if (whole && !this.stopped) await this.store.applyServerRows(table, [whole]);
    } catch {
      // The next pull brings it.
    }
  }

  stop(): void {
    this.stopRealtime();
    this.stopped = true;
    this.clearRetry();
    this.unsubscribeStore?.();
    this.listeners.clear();
  }

  protected setStatus(patch: Partial<SyncStatus>): void {
    this.status = { ...this.status, ...patch };
    for (const listener of this.listeners) listener(this.status);
  }

  private async refreshCounts(): Promise<void> {
    const [pending, rejected] = await Promise.all([
      this.store.pendingCount(),
      this.store.rejectedCount(),
    ]);
    if (pending !== this.status.pending || rejected !== this.status.rejected) {
      this.setStatus({ pending, rejected });
    }
  }

  protected async runOnce(): Promise<void> {
    this.setStatus({ state: 'syncing' });
    try {
      await this.pushAll();
      await this.pullAll();
      // So the pending count is exact when the sync reports it is done.
      await this.refreshCounts();
      this.failures = 0;
      this.setStatus({ state: 'idle', lastSyncedAt: this.now(), firstLoad: false });
    } catch {
      this.failures += 1;
      this.setStatus({ state: 'offline' });
      this.scheduleRetry();
    }
  }

  private scheduleRetry(): void {
    if (this.stopped || this.status.pending === 0) return;
    const delay = Math.min(500 * 2 ** this.failures, MAX_RETRY_MS);
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      void this.sync();
    }, delay);
  }

  private clearRetry(): void {
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = null;
  }

  // ---------------------------------------------------------------------------
  // Push (H-06.3)
  // ---------------------------------------------------------------------------

  /** Sends queued writes in order until the outbox is empty or the network fails. */
  protected async pushAll(): Promise<void> {
    for (;;) {
      if (this.stopped) return;
      const ops = await this.store.pendingOps(INSERT_BATCH);
      if (!ops.length) return;
      if (ops[0].kind === 'insert') await this.pushInserts(takeInserts(ops));
      else await this.pushUpdates(takeUpdates(ops));
    }
  }

  private async pushInserts(ops: OutboxOp[]): Promise<void> {
    const rows = ops.map((op) => ({ ...op.patch, id: op.row_id, household_id: op.household_id }));
    try {
      const stored = await this.remote.insert(ops[0].table_name, rows);
      const byId = new Map(stored.map((row) => [row.id, row]));
      for (const op of ops) {
        const row = byId.get(op.row_id);
        if (row) await this.store.completeOp(op, row);
        else await this.refuse(op);
      }
    } catch (error) {
      if (ops.length > 1 && classify(error) !== 'wait') {
        // One bad row fails the batch; send them one at a time to find it.
        for (const op of ops) await this.pushInserts([op]);
        return;
      }
      if (error instanceof RemoteError && error.code === '23505') {
        // A retried create whose first attempt landed: the server already has the row.
        const row = await this.fetchOrStop(ops[0]);
        if (row) await this.store.completeOp(ops[0], row);
        else await this.store.rejectOp(ops[0], null);
        return;
      }
      await this.fail(ops[0], error);
    }
  }

  private async pushUpdates(ops: OutboxOp[]): Promise<void> {
    const results = await Promise.allSettled(
      ops.map((op) =>
        this.remote.update(op.table_name, op.row_id, {
          ...(op.kind === 'delete' ? { deleted_at: new Date(this.now()).toISOString() } : op.patch),
          // The version the write was based on, for the server's check-off rule.
          version: op.base_version ?? 0,
        }),
      ),
    );
    let stop: unknown = null;
    for (const [i, result] of results.entries()) {
      try {
        if (result.status === 'rejected') await this.fail(ops[i], result.reason);
        else if (result.value) await this.store.completeOp(ops[i], result.value);
        else await this.refuse(ops[i]);
      } catch (error) {
        stop ??= error;
      }
    }
    if (stop) throw stop;
  }

  private async fail(op: OutboxOp, error: unknown): Promise<void> {
    const kind = classify(error);
    if (kind === 'wait') throw new StopPush();
    if (kind === 'refused') return this.refuse(op);
    if ((await this.store.recordAttempt(op)) >= MAX_ATTEMPTS) return this.refuse(op);
    throw new StopPush();
  }

  /** Drops a write the server won't take, and shows the server's copy of the row again. */
  private async refuse(op: OutboxOp): Promise<void> {
    await this.store.rejectOp(op, await this.fetchOrStop(op));
  }

  private async fetchOrStop(op: OutboxOp): Promise<SyncRow | null> {
    try {
      return await this.remote.fetchRow(op.table_name, op.row_id);
    } catch {
      throw new StopPush();
    }
  }

  // ---------------------------------------------------------------------------
  // Pull (H-06.2)
  // ---------------------------------------------------------------------------

  /**
   * Pulls every table at once, so a new device waits for its slowest table rather than the
   * sum of them (A-01.3, FR-AUTH-8). The local store runs its writes one at a time. All
   * pulls finish before the first error is thrown, so none outlives the run.
   */
  protected async pullAll(): Promise<void> {
    if (this.stopped) return;
    const results = await Promise.allSettled(
      this.store.tableNames().map((table) => this.pullTable(table)),
    );
    const failed = results.find((result) => result.status === 'rejected');
    if (failed) throw failed.reason;
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

/** Consecutive creates on one table, each a different row. */
function takeInserts(ops: OutboxOp[]): OutboxOp[] {
  const ids = new Set<string>();
  const taken: OutboxOp[] = [];
  for (const op of ops) {
    if (op.kind !== 'insert' || op.table_name !== ops[0].table_name || ids.has(op.row_id)) break;
    ids.add(op.row_id);
    taken.push(op);
  }
  return taken;
}

/** Consecutive updates and deletes, each to a different row, so their order doesn't matter. */
function takeUpdates(ops: OutboxOp[]): OutboxOp[] {
  const rows = new Set<string>();
  const taken: OutboxOp[] = [];
  for (const op of ops) {
    const key = `${op.table_name}:${op.row_id}`;
    if (op.kind === 'insert' || rows.has(key) || taken.length >= PARALLEL_UPDATES) break;
    rows.add(key);
    taken.push(op);
  }
  return taken;
}
