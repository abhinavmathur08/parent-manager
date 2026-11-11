import { validateDefinition } from '@/lib/sync/registry';
import {
  SYSTEM_COLUMNS,
  type ColumnType,
  type SqlDatabase,
  type SqlParam,
  type SyncRow,
  type SyncTableDefinition,
  type SyncValue,
} from '@/lib/sync/types';

/** What changed: tables whose rows changed, and whether the outbox did. */
export type StoreChange = { tables: ReadonlySet<string>; outbox: boolean };
type Listener = (change: StoreChange) => void;

export type OpKind = 'insert' | 'update' | 'delete';

/** A queued local write (H-06.3, NFR-OFF-3). */
export type OutboxOp = {
  seq: number;
  table_name: string;
  row_id: string;
  household_id: string;
  kind: OpKind;
  /** The column values the write set. Empty for a delete. */
  patch: Record<string, SyncValue>;
  /** The server version the write was based on; null for a row the server doesn't have yet. */
  base_version: number | null;
  attempts: number;
  created_at: string;
};

type RawOp = Omit<OutboxOp, 'patch'> & { patch: string };

const SYSTEM_TYPES: Record<string, string> = {
  id: 'TEXT PRIMARY KEY NOT NULL',
  household_id: 'TEXT NOT NULL',
  version: 'INTEGER NOT NULL DEFAULT 0',
  created_at: 'TEXT',
  updated_at: 'TEXT',
  deleted_at: 'TEXT',
};

const SQL_TYPES: Record<ColumnType, string> = {
  text: 'TEXT',
  integer: 'INTEGER',
  real: 'REAL',
  boolean: 'INTEGER',
  json: 'TEXT',
};

/** Each local row also keeps the last row the server sent, as JSON, to replay writes onto. */
const BASE = 'sync_base';

const quote = (identifier: string) => `"${identifier}"`;

function encode(type: ColumnType | undefined, value: SyncValue | undefined): SqlParam {
  if (value === undefined || value === null) return null;
  if (type === 'boolean') return value ? 1 : 0;
  if (type === 'json') return JSON.stringify(value);
  return value as SqlParam;
}

function decode(type: ColumnType | undefined, value: SqlParam): SyncValue {
  if (value === null) return null;
  if (type === 'boolean') return value === 1;
  if (type === 'json') return JSON.parse(String(value)) as SyncValue;
  return value;
}

/**
 * The local copy of the household's working data (H-06.2, NFR-OFF-1) and the outbox of
 * writes not yet on the server (H-06.3, NFR-OFF-3).
 *
 * Each row keeps the last version the server sent (its base). What the app reads is that
 * base with the row's queued writes replayed on top, so a pull, a Realtime event or a push
 * response never hides a write still waiting, and once the outbox drains the row is exactly
 * what the server says. A tombstone base stays deleted whatever is replayed onto it.
 *
 * Every call runs through one queue, because expo-sqlite transactions aren't exclusive.
 */
export class LocalStore {
  private readonly tables: Map<string, SyncTableDefinition>;
  private readonly listeners = new Set<Listener>();
  private queue: Promise<unknown> = Promise.resolve();
  private householdId: string | null = null;

  constructor(
    readonly db: SqlDatabase,
    tables: readonly SyncTableDefinition[],
    private readonly now: () => number = Date.now,
  ) {
    this.tables = new Map(tables.map((t) => [t.name, validateDefinition(t)]));
  }

  /** Runs `task` after every earlier call has finished. */
  serial<T>(task: () => Promise<T>): Promise<T> {
    const run = this.queue.then(task, task);
    this.queue = run.catch(() => undefined);
    return run;
  }

  definition(table: string): SyncTableDefinition {
    const definition = this.tables.get(table);
    if (!definition) throw new Error(`Sync table not registered: ${table}`);
    return definition;
  }

  tableNames(): string[] {
    return [...this.tables.keys()];
  }

  /**
   * Creates the local tables, and empties the copy and outbox if they belonged to another
   * household. A table whose definition changed is rebuilt and pulled again; its queued
   * writes stay in the outbox.
   */
  open(householdId: string): Promise<void> {
    return this.serial(async () => {
      await this.db.execAsync(
        `CREATE TABLE IF NOT EXISTS sync_meta (key TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL);
         CREATE TABLE IF NOT EXISTS sync_outbox (
           seq INTEGER PRIMARY KEY AUTOINCREMENT,
           table_name TEXT NOT NULL,
           row_id TEXT NOT NULL,
           household_id TEXT NOT NULL,
           kind TEXT NOT NULL,
           patch TEXT NOT NULL,
           base_version INTEGER,
           attempts INTEGER NOT NULL DEFAULT 0,
           created_at TEXT NOT NULL);
         CREATE INDEX IF NOT EXISTS sync_outbox_row ON sync_outbox (table_name, row_id);`,
      );
      const owner = await this.getMetaUnsafe('household');
      if (owner !== null && owner !== householdId) await this.clearUnsafe();
      await this.setMetaUnsafe('household', householdId);
      this.householdId = householdId;
      for (const definition of this.tables.values()) {
        const schema = JSON.stringify(definition.columns);
        if ((await this.getMetaUnsafe(`schema:${definition.name}`)) !== schema) {
          await this.db.execAsync(`DROP TABLE IF EXISTS ${quote(definition.name)};`);
          await this.deleteMetaUnsafe(`cursor:${definition.name}`);
        }
        const columns = [
          ...SYSTEM_COLUMNS.map((c) => `${quote(c)} ${SYSTEM_TYPES[c]}`),
          ...Object.entries(definition.columns).map(([c, t]) => `${quote(c)} ${SQL_TYPES[t]}`),
          `${BASE} TEXT`,
        ];
        await this.db.execAsync(
          `CREATE TABLE IF NOT EXISTS ${quote(definition.name)} (${columns.join(', ')});`,
        );
        await this.setMetaUnsafe(`schema:${definition.name}`, schema);
        // Rows with queued writes that a rebuild dropped come back from their writes.
        const pending = await this.db.getAllAsync<{ row_id: string }>(
          'SELECT DISTINCT row_id FROM sync_outbox WHERE table_name = ?',
          [definition.name],
        );
        for (const { row_id } of pending) await this.replayUnsafe(definition.name, row_id);
      }
    });
  }

  // ---------------------------------------------------------------------------
  // Reads
  // ---------------------------------------------------------------------------

  /** The household's rows of `table` that aren't deleted, oldest first. */
  rows(table: string): Promise<SyncRow[]> {
    const definition = this.definition(table);
    return this.serial(async () => {
      const raw = await this.db.getAllAsync<Record<string, SqlParam>>(
        `SELECT * FROM ${quote(definition.name)} WHERE deleted_at IS NULL ORDER BY created_at IS NULL, created_at, id`,
        [],
      );
      return raw.map((r) => this.decodeRow(definition, r));
    });
  }

  /** One row, including a deleted one, or null. */
  row(table: string, id: string): Promise<SyncRow | null> {
    return this.serial(() => this.rowUnsafe(table, id));
  }

  // ---------------------------------------------------------------------------
  // Local writes: applied at once and queued for the server
  // ---------------------------------------------------------------------------

  /** Creates a row. `id` is generated by the caller, so rows can be created offline. */
  insert(table: string, id: string, values: Record<string, SyncValue>): Promise<SyncRow> {
    const patch = this.checkPatch(table, values);
    return this.write(table, id, async () => {
      if (await this.rowUnsafe(table, id)) throw new Error(`Row already exists: ${table} ${id}`);
      return { kind: 'insert', patch, base: null };
    });
  }

  /** Changes columns of a live row. */
  update(table: string, id: string, values: Record<string, SyncValue>): Promise<SyncRow> {
    const patch = this.checkPatch(table, values);
    return this.write(table, id, async () => {
      const row = await this.liveRowUnsafe(table, id);
      return { kind: 'update', patch, base: row.version || null };
    });
  }

  /** Deletes a row. The server keeps a tombstone, so it can't come back. */
  remove(table: string, id: string): Promise<SyncRow> {
    return this.write(table, id, async () => {
      const row = await this.liveRowUnsafe(table, id);
      return { kind: 'delete', patch: {}, base: row.version || null };
    });
  }

  // ---------------------------------------------------------------------------
  // The outbox
  // ---------------------------------------------------------------------------

  /** Queued writes, oldest first. */
  pendingOps(limit = 100): Promise<OutboxOp[]> {
    return this.serial(async () => {
      const raw = await this.db.getAllAsync<RawOp>(
        'SELECT * FROM sync_outbox ORDER BY seq LIMIT ?',
        [limit],
      );
      return raw.map((op) => ({ ...op, patch: JSON.parse(op.patch) as OutboxOp['patch'] }));
    });
  }

  pendingCount(): Promise<number> {
    return this.serial(async () => {
      const row = await this.db.getFirstAsync<{ n: number }>(
        'SELECT count(*) AS n FROM sync_outbox',
        [],
      );
      return row?.n ?? 0;
    });
  }

  /**
   * The server accepted `op` and answered with `row`. Later writes to the same row that
   * were based on the same view move their base up to the new version, unless someone
   * else's write came in between.
   */
  completeOp(op: OutboxOp, row: SyncRow): Promise<void> {
    return this.serial(async () => {
      await this.db.withTransactionAsync(async () => {
        await this.db.runAsync('DELETE FROM sync_outbox WHERE seq = ?', [op.seq]);
        if (row.version === (op.base_version ?? 0) + 1) {
          await this.db.runAsync(
            'UPDATE sync_outbox SET base_version = ? WHERE table_name = ? AND row_id = ? AND base_version IS ?',
            [row.version, op.table_name, op.row_id, op.base_version],
          );
        }
        await this.setBaseUnsafe(op.table_name, row);
        await this.replayUnsafe(op.table_name, op.row_id);
      });
      this.emit([op.table_name], true);
    });
  }

  /**
   * The server refused `op` for good (NFR-OFF-6): it leaves the queue, which never stalls,
   * and the row shows the server's copy again. `row` is that copy, or null if the caller
   * can no longer see the row.
   */
  rejectOp(op: OutboxOp, row: SyncRow | null): Promise<void> {
    return this.serial(async () => {
      await this.db.withTransactionAsync(async () => {
        await this.db.runAsync('DELETE FROM sync_outbox WHERE seq = ?', [op.seq]);
        if (row) await this.setBaseUnsafe(op.table_name, row);
        else await this.clearBaseUnsafe(op.table_name, op.row_id);
        await this.replayUnsafe(op.table_name, op.row_id);
        const rejected = Number(await this.getMetaUnsafe('rejected'));
        await this.setMetaUnsafe('rejected', String(rejected + 1));
      });
      this.emit([op.table_name], true);
    });
  }

  /** Counts a failed attempt that may succeed later. */
  recordAttempt(op: OutboxOp): Promise<number> {
    return this.serial(async () => {
      await this.db.runAsync('UPDATE sync_outbox SET attempts = attempts + 1 WHERE seq = ?', [
        op.seq,
      ]);
      return op.attempts + 1;
    });
  }

  /** How many writes the server refused since the user was last told. */
  async rejectedCount(): Promise<number> {
    return Number(await this.getMeta('rejected'));
  }

  async acknowledgeRejected(): Promise<void> {
    await this.setMeta('rejected', '0');
    this.emit([], true);
  }

  // ---------------------------------------------------------------------------
  // Server rows
  // ---------------------------------------------------------------------------

  /**
   * Applies rows from the server. A row becomes the new base only when its version is
   * newer, so a late or repeated delivery can't roll a row back or bring a deleted one
   * back. Queued writes are replayed on top. Returns the IDs that changed.
   */
  applyServerRows(table: string, rows: readonly SyncRow[]): Promise<string[]> {
    return this.serial(async () => {
      const changed: string[] = [];
      await this.db.withTransactionAsync(async () => {
        for (const row of rows) {
          const base = await this.baseUnsafe(table, row.id);
          if (base && base.version >= row.version) continue;
          await this.setBaseUnsafe(table, row);
          await this.replayUnsafe(table, row.id);
          changed.push(row.id);
        }
      });
      if (changed.length) this.emit([table], false);
      return changed;
    });
  }

  /** After a full pull: removes rows the server no longer has, unless writes are queued. */
  removeRowsExcept(table: string, keep: ReadonlySet<string>): Promise<number> {
    const definition = this.definition(table);
    return this.serial(async () => {
      const local = await this.db.getAllAsync<{ id: string; queued: number }>(
        `SELECT id, EXISTS (SELECT 1 FROM sync_outbox o WHERE o.table_name = ? AND o.row_id = t.id) AS queued
         FROM ${quote(definition.name)} t`,
        [table],
      );
      const gone = local.filter((r) => !keep.has(r.id) && !r.queued).map((r) => r.id);
      await this.db.withTransactionAsync(async () => {
        for (const id of gone) {
          await this.db.runAsync(`DELETE FROM ${quote(definition.name)} WHERE id = ?`, [id]);
        }
      });
      if (gone.length) this.emit([table], false);
      return gone.length;
    });
  }

  getMeta(key: string): Promise<string | null> {
    return this.serial(() => this.getMetaUnsafe(key));
  }

  setMeta(key: string, value: string): Promise<void> {
    return this.serial(() => this.setMetaUnsafe(key, value));
  }

  /** Empties the local copy and the outbox, for sign-out or a change of household. */
  clear(): Promise<void> {
    return this.serial(async () => {
      await this.clearUnsafe();
      this.emit(this.tableNames(), true);
    });
  }

  /** Calls `listener` after each change. */
  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  // ---------------------------------------------------------------------------
  // The methods below assume the caller is already inside `serial`.
  // ---------------------------------------------------------------------------

  private emit(tables: Iterable<string>, outbox: boolean): void {
    const change = { tables: new Set(tables), outbox };
    for (const listener of this.listeners) listener(change);
  }

  private checkPatch(table: string, values: Record<string, SyncValue>) {
    const { columns } = this.definition(table);
    for (const column of Object.keys(values)) {
      if (!(column in columns)) throw new Error(`Unknown column ${column} on ${table}`);
    }
    return values;
  }

  private write(
    table: string,
    id: string,
    prepare: () => Promise<{
      kind: OpKind;
      patch: Record<string, SyncValue>;
      base: number | null;
    }>,
  ): Promise<SyncRow> {
    return this.serial(async () => {
      if (!this.householdId) throw new Error('The local copy is not open');
      const householdId = this.householdId;
      let row: SyncRow | null = null;
      await this.db.withTransactionAsync(async () => {
        const { kind, patch, base } = await prepare();
        await this.db.runAsync(
          'INSERT INTO sync_outbox (table_name, row_id, household_id, kind, patch, base_version, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
          [
            table,
            id,
            householdId,
            kind,
            JSON.stringify(patch),
            base,
            new Date(this.now()).toISOString(),
          ],
        );
        row = await this.replayUnsafe(table, id);
      });
      this.emit([table], true);
      return row as unknown as SyncRow;
    });
  }

  private async liveRowUnsafe(table: string, id: string): Promise<SyncRow> {
    const row = await this.rowUnsafe(table, id);
    if (!row || row.deleted_at) throw new Error(`No such row: ${table} ${id}`);
    return row;
  }

  private async rowUnsafe(table: string, id: string): Promise<SyncRow | null> {
    const definition = this.definition(table);
    const raw = await this.db.getFirstAsync<Record<string, SqlParam>>(
      `SELECT * FROM ${quote(definition.name)} WHERE id = ?`,
      [id],
    );
    return raw ? this.decodeRow(definition, raw) : null;
  }

  private async baseUnsafe(table: string, id: string): Promise<SyncRow | null> {
    const raw = await this.db.getFirstAsync<{ base: string | null }>(
      `SELECT ${BASE} AS base FROM ${quote(this.definition(table).name)} WHERE id = ?`,
      [id],
    );
    return raw?.base ? (JSON.parse(raw.base) as SyncRow) : null;
  }

  private async setBaseUnsafe(table: string, row: SyncRow): Promise<void> {
    const base = await this.baseUnsafe(table, row.id);
    if (base && base.version > row.version) return;
    // The visible columns are rewritten by `replayUnsafe`; this records the base.
    await this.writeRowUnsafe(table, row, row);
  }

  private async clearBaseUnsafe(table: string, id: string): Promise<void> {
    await this.db.runAsync(
      `UPDATE ${quote(this.definition(table).name)} SET ${BASE} = NULL, version = 0 WHERE id = ?`,
      [id],
    );
  }

  /**
   * Rebuilds the visible row from its base and its queued writes, in order. A row with
   * neither (a refused create) is removed.
   */
  private async replayUnsafe(table: string, id: string): Promise<SyncRow | null> {
    const base = await this.baseUnsafe(table, id);
    const ops = await this.db.getAllAsync<RawOp>(
      'SELECT * FROM sync_outbox WHERE table_name = ? AND row_id = ? ORDER BY seq',
      [table, id],
    );
    if (!base && !ops.length) {
      await this.db.runAsync(`DELETE FROM ${quote(this.definition(table).name)} WHERE id = ?`, [
        id,
      ]);
      return null;
    }
    const row: SyncRow = base
      ? { ...base }
      : {
          id,
          household_id: ops[0].household_id,
          version: 0,
          created_at: null,
          updated_at: null,
          deleted_at: null,
        };
    for (const op of ops) {
      if (op.kind === 'delete') row.deleted_at ??= op.created_at;
      else Object.assign(row, JSON.parse(op.patch));
    }
    await this.writeRowUnsafe(table, row, base);
    return row;
  }

  private async writeRowUnsafe(table: string, row: SyncRow, base: SyncRow | null): Promise<void> {
    const definition = this.definition(table);
    const columns = [...SYSTEM_COLUMNS, ...Object.keys(definition.columns)];
    const values = columns.map((c) =>
      encode(definition.columns[c], c === 'version' ? (row.version ?? 0) : row[c]),
    );
    await this.db.runAsync(
      `INSERT OR REPLACE INTO ${quote(definition.name)} (${[...columns.map(quote), BASE].join(', ')}) VALUES (${[...columns, BASE].map(() => '?').join(', ')})`,
      [...values, base ? JSON.stringify(base) : null],
    );
  }

  private async getMetaUnsafe(key: string): Promise<string | null> {
    const row = await this.db.getFirstAsync<{ value: string }>(
      'SELECT value FROM sync_meta WHERE key = ?',
      [key],
    );
    return row?.value ?? null;
  }

  private async setMetaUnsafe(key: string, value: string): Promise<void> {
    await this.db.runAsync('INSERT OR REPLACE INTO sync_meta (key, value) VALUES (?, ?)', [
      key,
      value,
    ]);
  }

  private async deleteMetaUnsafe(key: string): Promise<void> {
    await this.db.runAsync('DELETE FROM sync_meta WHERE key = ?', [key]);
  }

  private async clearUnsafe(): Promise<void> {
    await this.db.execAsync('DELETE FROM sync_outbox;');
    await this.deleteMetaUnsafe('rejected');
    for (const name of this.tableNames()) {
      await this.db.execAsync(`DELETE FROM ${quote(name)};`).catch(() => undefined);
      await this.deleteMetaUnsafe(`cursor:${name}`);
      await this.deleteMetaUnsafe(`pulledAt:${name}`);
    }
  }

  private decodeRow(definition: SyncTableDefinition, raw: Record<string, SqlParam>): SyncRow {
    const row: Record<string, SyncValue> = {};
    for (const [column, value] of Object.entries(raw)) {
      if (column !== BASE) row[column] = decode(definition.columns[column], value);
    }
    return row as SyncRow;
  }
}
