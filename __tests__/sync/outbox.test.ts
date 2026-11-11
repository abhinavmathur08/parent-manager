import { MAX_ATTEMPTS, SyncEngine, classify } from '@/lib/sync/engine';
import { LocalStore } from '@/lib/sync/local-store';
import { RemoteError, type SyncRemote } from '@/lib/sync/remote';
import type { SqlDatabase, SyncTableDefinition } from '@/lib/sync/types';

import { FakeServer } from '../../test-utils/sync/fake-server';
import { createTestDatabase } from '../../test-utils/sync/sqlite';

const items: SyncTableDefinition = {
  name: 'items',
  columns: { name: 'text', checked: 'boolean', note: 'text' },
};

const engines: SyncEngine[] = [];
afterEach(() => {
  for (const engine of engines.splice(0)) engine.stop();
});

type Device = {
  engine: SyncEngine;
  net: { offline: boolean };
  db: SqlDatabase;
  /** Kills the app and starts it again on the same database file. */
  restart(): Promise<void>;
  row(id: string): Promise<Record<string, unknown> | null>;
};

async function device(server: FakeServer, user: string, remote?: SyncRemote): Promise<Device> {
  const db = createTestDatabase();
  const net = { offline: false };
  const start = async () => {
    const engine = new SyncEngine(
      new LocalStore(db, [items]),
      remote ?? server.remote(user, net),
      'h1',
    );
    engines.push(engine);
    await engine.open();
    return engine;
  };
  const d: Device = {
    engine: await start(),
    net,
    db,
    async restart() {
      d.engine.stop();
      d.engine = await start();
    },
    async row(id) {
      const row = await d.engine.store.row('items', id);
      return row && !row.deleted_at ? row : null;
    },
  };
  return d;
}

function newServer() {
  const server = new FakeServer();
  server.checkColumns.set('items', ['checked']);
  return server;
}

describe('outbox', () => {
  it('shows a local write at once and counts it as pending until it syncs (NFR-OFF-3)', async () => {
    const server = newServer();
    const a = await device(server, 'user-a');
    a.net.offline = true;
    await a.engine.insert('items', 'i1', { name: 'milk' });
    expect(await a.row('i1')).toMatchObject({ name: 'milk', version: 0 });
    await a.engine.sync();
    expect(a.engine.getStatus()).toMatchObject({ state: 'offline', pending: 1 });

    a.net.offline = false;
    await a.engine.sync();
    expect(a.engine.getStatus()).toMatchObject({ state: 'idle', pending: 0 });
    expect(await a.row('i1')).toMatchObject({ name: 'milk', version: 1 });
    expect(server.table('items').get('i1')).toMatchObject({ name: 'milk', version: 1 });
  });

  it('keeps queued writes across a restart and sends them in order', async () => {
    const server = newServer();
    const a = await device(server, 'user-a');
    a.net.offline = true;
    await a.engine.insert('items', 'i1', { name: 'milk' });
    await a.engine.update('items', 'i1', { name: 'oat milk' });
    await a.engine.insert('items', 'i2', { name: 'eggs' });
    await a.engine.remove('items', 'i2');

    await a.restart();
    expect(a.engine.getStatus().pending).toBe(4);
    expect(await a.row('i1')).toMatchObject({ name: 'oat milk' });
    expect(await a.row('i2')).toBeNull();

    a.net.offline = false;
    await a.engine.sync();
    expect(server.table('items').get('i1')).toMatchObject({ name: 'oat milk', version: 2 });
    expect(server.table('items').get('i2')?.deleted_at).not.toBeNull();
    expect(a.engine.getStatus().pending).toBe(0);
  });

  it('replays pending writes over newer server rows, so neither is lost', async () => {
    const server = newServer();
    server.put('items', { id: 'i1', household_id: 'h1', name: 'milk', note: null });
    const a = await device(server, 'user-a');
    await a.engine.sync();

    a.net.offline = true;
    await a.engine.update('items', 'i1', { name: 'oat milk' });
    server.put('items', { id: 'i1', household_id: 'h1', note: 'the big one' });
    a.net.offline = false;
    await a.engine.store.applyServerRows('items', [server.table('items').get('i1')!]);
    expect(await a.row('i1')).toMatchObject({ name: 'oat milk', note: 'the big one' });

    await a.engine.sync();
    expect(await a.row('i1')).toMatchObject({ name: 'oat milk', note: 'the big one', version: 3 });
  });

  it('shows the server copy once a write lands, even if Realtime delivered it first', async () => {
    const server = newServer();
    server.put('items', { id: 'i1', household_id: 'h1', name: 'rice', checked: true });
    const a = await device(server, 'user-a');
    await a.engine.sync();
    a.net.offline = true;
    await a.engine.update('items', 'i1', { checked: false });
    // Someone re-checks it: the uncheck is now stale.
    server.put('items', { id: 'i1', household_id: 'h1', checked: false });
    server.put('items', { id: 'i1', household_id: 'h1', checked: true });

    // The stale uncheck reaches the server; its event arrives before the response.
    const remote = server.remote('user-a');
    const op = (await a.engine.store.pendingOps())[0];
    const stored = await remote.update('items', 'i1', { checked: false, version: op.base_version });
    await a.engine.store.applyServerRows('items', [stored!]);
    await a.engine.store.completeOp(op, stored!);
    expect(await a.row('i1')).toMatchObject({ checked: true, version: stored!.version });
  });

  it('completes a retried create whose first response was lost', async () => {
    const server = newServer();
    const a = await device(server, 'user-a');
    a.net.offline = true;
    await a.engine.insert('items', 'i1', { name: 'milk' });
    // The create reached the server, but the device never heard back.
    await server.remote('user-a').insert('items', [{ id: 'i1', household_id: 'h1', name: 'milk' }]);
    a.net.offline = false;
    await a.engine.sync();
    expect(a.engine.getStatus()).toMatchObject({ pending: 0, rejected: 0 });
    expect(await a.row('i1')).toMatchObject({ version: 1 });
  });

  it('drops writes the server refuses, tells the user, and keeps going (NFR-OFF-6)', async () => {
    const server = newServer();
    server.put('items', { id: 'i1', household_id: 'h1', name: 'milk' });
    const a = await device(server, 'user-a');
    await a.engine.sync();
    a.net.offline = true;
    await a.engine.update('items', 'i1', { name: 'oat milk' });
    await a.engine.insert('items', 'i2', { name: 'eggs' });

    server.removed.add('user-a');
    a.net.offline = false;
    await a.engine.sync();
    expect(a.engine.getStatus()).toMatchObject({ pending: 0, rejected: 2 });
    expect(await a.row('i2')).toBeNull();
    expect(server.table('items').get('i1')).toMatchObject({ name: 'milk' });

    await a.engine.store.acknowledgeRejected();
    await a.engine.sync();
    expect(a.engine.getStatus().rejected).toBe(0);
  });

  it('retries server errors without counting them, and drops a write that keeps failing', async () => {
    const server = newServer();
    const base = server.remote('user-a');
    let failure: RemoteError | null = new RemoteError('down', 503, '');
    const remote: SyncRemote = {
      ...base,
      insert: async (table, rows) => {
        if (failure) throw failure;
        return base.insert(table, rows);
      },
    };
    const a = await device(server, 'user-a', remote);
    await a.engine.insert('items', 'i1', { name: 'milk' });
    await a.engine.sync();
    expect((await a.engine.store.pendingOps())[0].attempts).toBe(0);

    failure = new RemoteError('bad request', 400, 'PGRST204');
    for (let i = 0; i < MAX_ATTEMPTS; i++) await a.engine.sync();
    expect(a.engine.getStatus()).toMatchObject({ pending: 0, rejected: 1 });
  });

  it('sends 500 queued changes in few requests (NFR-OFF-4)', async () => {
    const server = newServer();
    const a = await device(server, 'user-a');
    a.net.offline = true;
    for (let i = 0; i < 250; i++) await a.engine.insert('items', `i${i}`, { name: `item ${i}` });
    for (let i = 0; i < 250; i++) await a.engine.update('items', `i${i}`, { checked: true });
    a.net.offline = false;
    server.requests = 0;
    await a.engine.sync();
    expect(a.engine.getStatus().pending).toBe(0);
    expect([...server.table('items').values()].every((r) => r.checked && r.version === 2)).toBe(
      true,
    );
    expect(server.requests).toBeLessThan(300);
  });

  it('classifies failures', () => {
    expect(classify(new TypeError('Network request failed'))).toBe('wait');
    expect(classify(new RemoteError('offline', 0, ''))).toBe('wait');
    expect(classify(new RemoteError('expired', 401, 'PGRST301'))).toBe('wait');
    expect(classify(new RemoteError('down', 502, ''))).toBe('wait');
    expect(classify(new RemoteError('rls', 403, '42501'))).toBe('refused');
    expect(classify(new RemoteError('check', 400, '23514'))).toBe('refused');
    expect(classify(new RemoteError('unknown', 400, 'PGRST204'))).toBe('retry');
  });
});

describe('two devices offline (architecture section 5, NFR-OFF-5)', () => {
  async function scenario() {
    const server = newServer();
    for (const [id, name, checked] of [
      ['different1', 'eggs', false],
      ['different2', 'bread', false],
      ['same', 'apples', false],
      ['bothCheck', 'butter', false],
      ['staleUncheck', 'rice', true],
      ['deleted', 'yoghurt', false],
    ] as const) {
      server.put('items', { id, household_id: 'h1', name, checked });
    }
    const a = await device(server, 'user-a');
    const b = await device(server, 'user-b');
    await a.engine.sync();
    await b.engine.sync();
    a.net.offline = true;
    b.net.offline = true;
    return { server, a, b };
  }

  it('merges offline edits on both devices and converges', async () => {
    const { server, a, b } = await scenario();

    await a.engine.update('items', 'different1', { name: 'eggs (A)' });
    await b.engine.update('items', 'different2', { name: 'bread (B)' });
    await a.engine.update('items', 'same', { name: 'apples (A)' });
    await b.engine.update('items', 'same', { name: 'apples (B)' });
    await a.engine.update('items', 'bothCheck', { checked: true });
    await b.engine.update('items', 'bothCheck', { checked: true });
    await a.engine.insert('items', 'newOnA', { name: 'pasta (A)' });
    await b.engine.insert('items', 'newOnB', { name: 'tea (B)' });
    // S4: A deletes a row that B edits offline.
    await a.engine.remove('items', 'deleted');
    await b.engine.update('items', 'deleted', { name: 'yoghurt (B edit after A deleted)' });
    // S6: B unchecks rice from the checked state it saw.
    await b.engine.update('items', 'staleUncheck', { checked: false });

    // A restarts while offline, then comes back first and unchecks and re-checks rice.
    await a.restart();
    a.net.offline = false;
    await a.engine.sync();
    await a.engine.update('items', 'staleUncheck', { checked: false });
    await a.engine.sync();
    await a.engine.update('items', 'staleUncheck', { checked: true });
    await a.engine.sync();

    b.net.offline = false;
    await b.engine.sync();
    await a.engine.sync();

    const both = async (id: string) => [await a.row(id), await b.row(id)];
    expect(await both('different1')).toEqual([
      expect.objectContaining({ name: 'eggs (A)' }),
      expect.objectContaining({ name: 'eggs (A)' }),
    ]);
    expect((await both('different2')).map((r) => r?.name)).toEqual(['bread (B)', 'bread (B)']);
    // S2: last write to reach the server wins, on both devices.
    expect((await both('same')).map((r) => r?.name)).toEqual(['apples (B)', 'apples (B)']);
    // S3
    expect((await both('bothCheck')).map((r) => r?.checked)).toEqual([true, true]);
    // S4: the deleted row doesn't come back on either device.
    expect(server.table('items').get('deleted')?.deleted_at).not.toBeNull();
    expect(await both('deleted')).toEqual([null, null]);
    // S5
    expect((await both('newOnA')).map((r) => r?.name)).toEqual(['pasta (A)', 'pasta (A)']);
    expect((await both('newOnB')).map((r) => r?.name)).toEqual(['tea (B)', 'tea (B)']);
    // S6: the stale uncheck doesn't override the newer check, and nothing is stuck.
    expect(server.table('items').get('staleUncheck')?.checked).toBe(true);
    expect((await both('staleUncheck')).map((r) => r?.checked)).toEqual([true, true]);
    expect([a.engine.getStatus().pending, b.engine.getStatus().pending]).toEqual([0, 0]);
    expect([a.engine.getStatus().rejected, b.engine.getStatus().rejected]).toEqual([0, 0]);

    // Every row matches the server on both devices.
    for (const row of server.table('items').values()) {
      for (const d of [a, b]) {
        const local = await d.engine.store.row('items', row.id);
        expect(local).toMatchObject({ version: row.version, deleted_at: row.deleted_at });
      }
    }
  });
});
