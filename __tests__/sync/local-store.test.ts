import { LocalStore } from '@/lib/sync/local-store';
import { defineSyncTable, clearRegistry, registeredTables } from '@/lib/sync/registry';
import type { SyncRow, SyncTableDefinition } from '@/lib/sync/types';
import { createTestDatabase } from '../../test-utils/sync/sqlite';

const items: SyncTableDefinition = {
  name: 'items',
  columns: { name: 'text', checked: 'boolean', quantity: 'real', tags: 'json' },
};

function serverRow(id: string, version: number, extra: Partial<SyncRow> = {}): SyncRow {
  return {
    id,
    household_id: 'h1',
    version,
    created_at: '2026-11-10T00:00:00+00:00',
    updated_at: `2026-11-10T00:00:0${version}+00:00`,
    deleted_at: null,
    name: `item v${version}`,
    checked: false,
    quantity: 1.5,
    tags: ['a'],
    ...extra,
  };
}

describe('LocalStore', () => {
  it('stores and returns rows with their column types', async () => {
    const store = new LocalStore(createTestDatabase(), [items]);
    await store.open('h1');
    await store.applyServerRows('items', [serverRow('r1', 1, { checked: true })]);
    expect(await store.rows('items')).toEqual([serverRow('r1', 1, { checked: true })]);
  });

  it('keeps data across a restart (a new store on the same file)', async () => {
    const db = createTestDatabase();
    const first = new LocalStore(db, [items]);
    await first.open('h1');
    await first.applyServerRows('items', [serverRow('r1', 1)]);

    const second = new LocalStore(db, [items]);
    await second.open('h1');
    expect((await second.rows('items')).map((r) => r.id)).toEqual(['r1']);
  });

  it('only replaces a row with a newer version', async () => {
    const store = new LocalStore(createTestDatabase(), [items]);
    await store.open('h1');
    await store.applyServerRows('items', [serverRow('r1', 2)]);
    expect(await store.applyServerRows('items', [serverRow('r1', 1)])).toEqual([]);
    expect(await store.applyServerRows('items', [serverRow('r1', 2)])).toEqual([]);
    expect((await store.row('items', 'r1'))?.name).toBe('item v2');
    expect(await store.applyServerRows('items', [serverRow('r1', 3)])).toEqual(['r1']);
    expect((await store.row('items', 'r1'))?.name).toBe('item v3');
  });

  it('keeps tombstones but leaves deleted rows out of reads, so an old copy cannot return', async () => {
    const store = new LocalStore(createTestDatabase(), [items]);
    await store.open('h1');
    await store.applyServerRows('items', [serverRow('r1', 2, { deleted_at: 'x' })]);
    expect(await store.rows('items')).toEqual([]);
    await store.applyServerRows('items', [serverRow('r1', 1)]);
    expect(await store.rows('items')).toEqual([]);
  });

  it('empties the copy when it opens for another household', async () => {
    const db = createTestDatabase();
    const store = new LocalStore(db, [items]);
    await store.open('h1');
    await store.applyServerRows('items', [serverRow('r1', 1)]);
    await store.setMeta('cursor:items', 'c');

    const other = new LocalStore(db, [items]);
    await other.open('h2');
    expect(await other.rows('items')).toEqual([]);
    expect(await other.getMeta('cursor:items')).toBeNull();
  });

  it('rebuilds a table whose columns changed, and pulls it again', async () => {
    const db = createTestDatabase();
    const store = new LocalStore(db, [items]);
    await store.open('h1');
    await store.applyServerRows('items', [serverRow('r1', 1)]);
    await store.setMeta('cursor:items', 'c');

    const changed = { name: 'items', columns: { ...items.columns, note: 'text' as const } };
    const next = new LocalStore(db, [changed]);
    await next.open('h1');
    expect(await next.rows('items')).toEqual([]);
    expect(await next.getMeta('cursor:items')).toBeNull();
  });

  it('removes rows the server no longer lists, and tells subscribers', async () => {
    const store = new LocalStore(createTestDatabase(), [items]);
    await store.open('h1');
    await store.applyServerRows('items', [serverRow('r1', 1), serverRow('r2', 1)]);
    const listener = jest.fn();
    store.subscribe(listener);
    expect(await store.removeRowsExcept('items', new Set(['r2']))).toBe(1);
    expect((await store.rows('items')).map((r) => r.id)).toEqual(['r2']);
    expect(listener).toHaveBeenCalledWith(new Set(['items']));
  });

  it('clears everything for sign-out', async () => {
    const store = new LocalStore(createTestDatabase(), [items]);
    await store.open('h1');
    await store.applyServerRows('items', [serverRow('r1', 1)]);
    await store.clear();
    expect(await store.rows('items')).toEqual([]);
  });
});

describe('defineSyncTable', () => {
  afterEach(clearRegistry);

  it('registers tables in order', () => {
    defineSyncTable(items);
    defineSyncTable({ name: 'notes', columns: { body: 'text' } });
    expect(registeredTables().map((t) => t.name)).toEqual(['items', 'notes']);
  });

  it.each([
    ['a name that is not a plain identifier', { name: 'items; drop', columns: {} }],
    ['a reserved prefix', { name: 'sync_outbox', columns: {} }],
    ['a system column', { name: 'items', columns: { version: 'integer' as const } }],
    [
      'a column that is not a plain identifier',
      { name: 'items', columns: { 'a"b': 'text' as const } },
    ],
  ])('rejects %s', (_, definition) => {
    expect(() => defineSyncTable(definition)).toThrow();
  });
});
