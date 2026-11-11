// Jest stand-in for expo-sqlite's database, backed by Node's built-in SQLite, so the
// sync layer's SQL runs for real in unit tests.
import type { SqlDatabase, SqlParam } from '@/lib/sync/types';

type Statement = {
  run(...params: SqlParam[]): { changes: number | bigint };
  all(...params: SqlParam[]): unknown[];
  get(...params: SqlParam[]): unknown;
};
type NodeDatabase = { exec(sql: string): void; prepare(sql: string): Statement };

const { DatabaseSync } = jest.requireActual<{ DatabaseSync: new (path: string) => NodeDatabase }>(
  'node:sqlite',
);

// node:sqlite returns rows with a null prototype; copy them so toEqual compares plainly.
const plain = (row: unknown) => (row ? { ...(row as object) } : null);

/** An in-memory database. Reuse it across stores to simulate an app restart. */
export function createTestDatabase(): SqlDatabase & { raw: NodeDatabase } {
  const raw = new DatabaseSync(':memory:');
  return {
    raw,
    async execAsync(source) {
      raw.exec(source);
    },
    async runAsync(source, params) {
      return { changes: Number(raw.prepare(source).run(...params).changes) };
    },
    async getAllAsync<T>(source: string, params: SqlParam[]) {
      return raw
        .prepare(source)
        .all(...params)
        .map(plain) as T[];
    },
    async getFirstAsync<T>(source: string, params: SqlParam[]) {
      return plain(raw.prepare(source).get(...params)) as T | null;
    },
    async withTransactionAsync(task) {
      raw.exec('BEGIN');
      try {
        await task();
        raw.exec('COMMIT');
      } catch (error) {
        raw.exec('ROLLBACK');
        throw error;
      }
    },
  };
}
