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

type Listener = (tables: ReadonlySet<string>) => void;

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
 * The local copy of the household's working data (H-06.2, NFR-OFF-1).
 *
 * Each registered table gets a SQLite table with the server's system columns and its own
 * columns, so features can query it with SQL. `sync_meta` holds the household the copy
 * belongs to, each table's schema and its pull cursor. Every call runs through one queue,
 * because expo-sqlite transactions aren't exclusive.
 */
export class LocalStore {
  private readonly tables: Map<string, SyncTableDefinition>;
  private readonly listeners = new Set<Listener>();
  private queue: Promise<unknown> = Promise.resolve();

  constructor(
    readonly db: SqlDatabase,
    tables: readonly SyncTableDefinition[],
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
   * Creates the local tables, and empties the copy if it belonged to another household.
   * A table whose definition changed is rebuilt and pulled again from the server.
   */
  open(householdId: string): Promise<void> {
    return this.serial(async () => {
      await this.db.execAsync(
        'CREATE TABLE IF NOT EXISTS sync_meta (key TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL);',
      );
      const owner = await this.getMetaUnsafe('household');
      if (owner !== null && owner !== householdId) await this.clearUnsafe();
      await this.setMetaUnsafe('household', householdId);
      for (const definition of this.tables.values()) {
        const schema = JSON.stringify(definition.columns);
        if ((await this.getMetaUnsafe(`schema:${definition.name}`)) !== schema) {
          await this.db.execAsync(`DROP TABLE IF EXISTS ${quote(definition.name)};`);
          await this.deleteMetaUnsafe(`cursor:${definition.name}`);
        }
        const columns = [
          ...SYSTEM_COLUMNS.map((c) => `${quote(c)} ${SYSTEM_TYPES[c]}`),
          ...Object.entries(definition.columns).map(([c, t]) => `${quote(c)} ${SQL_TYPES[t]}`),
        ];
        await this.db.execAsync(
          `CREATE TABLE IF NOT EXISTS ${quote(definition.name)} (${columns.join(', ')});`,
        );
        await this.setMetaUnsafe(`schema:${definition.name}`, schema);
      }
    });
  }

  /** The household's rows of `table` that aren't deleted, oldest first. */
  rows(table: string): Promise<SyncRow[]> {
    const definition = this.definition(table);
    return this.serial(async () => {
      const raw = await this.db.getAllAsync<Record<string, SqlParam>>(
        `SELECT * FROM ${quote(definition.name)} WHERE deleted_at IS NULL ORDER BY created_at, id`,
        [],
      );
      return raw.map((r) => this.decodeRow(definition, r));
    });
  }

  /** One row, including a deleted one, or null. */
  row(table: string, id: string): Promise<SyncRow | null> {
    return this.serial(() => this.rowUnsafe(table, id));
  }

  /**
   * Applies rows from the server. A row replaces the local one only when its version is
   * newer, so a late or repeated delivery can't roll a row back or bring a deleted one back.
   * Returns the IDs that changed.
   */
  applyServerRows(table: string, rows: readonly SyncRow[]): Promise<string[]> {
    return this.serial(async () => {
      const changed: string[] = [];
      await this.db.withTransactionAsync(async () => {
        for (const row of rows) {
          if (await this.applyServerRowUnsafe(table, row)) changed.push(row.id);
        }
      });
      if (changed.length) this.emit([table]);
      return changed;
    });
  }

  /** After a full pull: removes local rows the server no longer has for the household. */
  removeRowsExcept(table: string, keep: ReadonlySet<string>): Promise<number> {
    const definition = this.definition(table);
    return this.serial(async () => {
      const local = await this.db.getAllAsync<{ id: string }>(
        `SELECT id FROM ${quote(definition.name)}`,
        [],
      );
      const gone = local.map((r) => r.id).filter((id) => !keep.has(id) && this.canPrune(table, id));
      await this.db.withTransactionAsync(async () => {
        for (const id of gone) {
          await this.db.runAsync(`DELETE FROM ${quote(definition.name)} WHERE id = ?`, [id]);
        }
      });
      if (gone.length) this.emit([table]);
      return gone.length;
    });
  }

  getMeta(key: string): Promise<string | null> {
    return this.serial(() => this.getMetaUnsafe(key));
  }

  setMeta(key: string, value: string): Promise<void> {
    return this.serial(() => this.setMetaUnsafe(key, value));
  }

  /** Empties the local copy, for sign-out or a change of household. */
  clear(): Promise<void> {
    return this.serial(async () => {
      await this.clearUnsafe();
      this.emit(this.tableNames());
    });
  }

  /** Calls `listener` with the tables that changed after each write. */
  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  // ---------------------------------------------------------------------------
  // The methods below assume the caller is already inside `serial`.
  // ---------------------------------------------------------------------------

  protected emit(tables: Iterable<string>): void {
    const changed = new Set(tables);
    for (const listener of this.listeners) listener(changed);
  }

  /** Whether a row the server no longer lists may be removed locally. */
  protected canPrune(_table: string, _id: string): boolean {
    return true;
  }

  protected async applyServerRowUnsafe(table: string, row: SyncRow): Promise<boolean> {
    const local = await this.db.getFirstAsync<{ version: number }>(
      `SELECT version FROM ${quote(this.definition(table).name)} WHERE id = ?`,
      [row.id],
    );
    if (local && local.version >= row.version) return false;
    await this.writeRowUnsafe(table, row);
    return true;
  }

  protected async rowUnsafe(table: string, id: string): Promise<SyncRow | null> {
    const definition = this.definition(table);
    const raw = await this.db.getFirstAsync<Record<string, SqlParam>>(
      `SELECT * FROM ${quote(definition.name)} WHERE id = ?`,
      [id],
    );
    return raw ? this.decodeRow(definition, raw) : null;
  }

  protected async writeRowUnsafe(table: string, row: SyncRow): Promise<void> {
    const definition = this.definition(table);
    const columns = [...SYSTEM_COLUMNS, ...Object.keys(definition.columns)];
    const values = columns.map((c) =>
      encode(definition.columns[c], c === 'version' ? (row.version ?? 0) : row[c]),
    );
    await this.db.runAsync(
      `INSERT OR REPLACE INTO ${quote(definition.name)} (${columns.map(quote).join(', ')}) VALUES (${columns.map(() => '?').join(', ')})`,
      values,
    );
  }

  protected async deleteRowUnsafe(table: string, id: string): Promise<void> {
    await this.db.runAsync(`DELETE FROM ${quote(this.definition(table).name)} WHERE id = ?`, [id]);
  }

  protected async getMetaUnsafe(key: string): Promise<string | null> {
    const row = await this.db.getFirstAsync<{ value: string }>(
      'SELECT value FROM sync_meta WHERE key = ?',
      [key],
    );
    return row?.value ?? null;
  }

  protected async setMetaUnsafe(key: string, value: string): Promise<void> {
    await this.db.runAsync('INSERT OR REPLACE INTO sync_meta (key, value) VALUES (?, ?)', [
      key,
      value,
    ]);
  }

  protected async deleteMetaUnsafe(key: string): Promise<void> {
    await this.db.runAsync('DELETE FROM sync_meta WHERE key = ?', [key]);
  }

  protected async clearUnsafe(): Promise<void> {
    for (const name of this.tableNames()) {
      await this.db.execAsync(`DELETE FROM ${quote(name)};`).catch(() => undefined);
      await this.deleteMetaUnsafe(`cursor:${name}`);
      await this.deleteMetaUnsafe(`pulledAt:${name}`);
    }
  }

  private decodeRow(definition: SyncTableDefinition, raw: Record<string, SqlParam>): SyncRow {
    const row: Record<string, SyncValue> = {};
    for (const [column, value] of Object.entries(raw)) {
      row[column] = decode(definition.columns[column], value);
    }
    return row as SyncRow;
  }
}
