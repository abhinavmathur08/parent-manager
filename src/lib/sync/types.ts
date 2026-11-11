/**
 * Types for the household sync layer (architecture section 5, D-13).
 *
 * The engine is generic over tables: a feature registers a table with `defineSyncTable`
 * and the engine keeps a local copy of the household's rows of that table.
 */

/** How a column is stored in the local copy. JSON columns hold arrays and objects. */
export type ColumnType = 'text' | 'integer' | 'real' | 'boolean' | 'json';

export type SyncTableDefinition = {
  /** The Postgres table in `public`, which is also the local table's name. */
  name: string;
  /** The table's own columns, without the system columns every synced table has. */
  columns: Readonly<Record<string, ColumnType>>;
};

/** Columns every synced table has on the server (architecture section 3). */
export const SYSTEM_COLUMNS = [
  'id',
  'household_id',
  'version',
  'created_at',
  'updated_at',
  'deleted_at',
] as const;

export type SystemColumn = (typeof SYSTEM_COLUMNS)[number];

export type SyncValue = string | number | boolean | null | readonly unknown[] | object;

/** A row as the server sends it, and as the local copy returns it. */
export type SyncRow = {
  id: string;
  household_id: string;
  /** Set by the server and incremented on every write. 0 until the server has the row. */
  version: number;
  created_at: string | null;
  updated_at: string | null;
  /** A tombstone: set once the row is deleted, and never cleared. */
  deleted_at: string | null;
  [column: string]: SyncValue | undefined;
};

/** The subset of expo-sqlite's `SQLiteDatabase` the sync layer uses, so tests can stand in. */
export type SqlParam = string | number | null;

export type SqlDatabase = {
  execAsync(source: string): Promise<void>;
  runAsync(source: string, params: SqlParam[]): Promise<{ changes: number }>;
  getAllAsync<T>(source: string, params: SqlParam[]): Promise<T[]>;
  getFirstAsync<T>(source: string, params: SqlParam[]): Promise<T | null>;
  withTransactionAsync(task: () => Promise<void>): Promise<void>;
};
