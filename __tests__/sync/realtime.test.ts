import { SyncEngine } from '@/lib/sync/engine';
import { LocalStore } from '@/lib/sync/local-store';
import type { SyncRow, SyncTableDefinition } from '@/lib/sync/types';

import { FakeServer } from '../../test-utils/sync/fake-server';
import { createTestDatabase } from '../../test-utils/sync/sqlite';

const items: SyncTableDefinition = { name: 'items', columns: { name: 'text', note: 'text' } };
const engines: SyncEngine[] = [];
afterEach(() => {
  for (const engine of engines.splice(0)) engine.stop();
});

async function device(server: FakeServer, user: string) {
  const engine = new SyncEngine(
    new LocalStore(createTestDatabase(), [items]),
    server.remote(user),
    'h1',
  );
  engines.push(engine);
  await engine.open();
  return engine;
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
const name = async (engine: SyncEngine, id: string) => (await engine.store.row('items', id))?.name;

describe('realtime (H-06.4)', () => {
  it('applies another member’s change without a pull, and tells listeners', async () => {
    const server = new FakeServer();
    const a = await device(server, 'user-a');
    const remote = server.remote('user-b');
    let pulls = 0;
    const b = new SyncEngine(
      new LocalStore(createTestDatabase(), [items]),
      { ...remote, fetchPage: (...args) => (pulls++, remote.fetchPage(...args)) },
      'h1',
    );
    engines.push(b);
    await b.open();
    b.startRealtime();
    await flush();
    expect(b.getStatus().realtime).toBe('connected');
    await b.sync(); // the catch-up pull on joining

    const listener = jest.fn();
    b.store.subscribe(listener);
    const pullsBefore = pulls;
    await a.insert('items', 'i1', { name: 'milk' });
    await a.sync();
    await flush();
    expect(await name(b, 'i1')).toBe('milk');
    expect(pulls).toBe(pullsBefore);
    expect(listener).toHaveBeenCalledWith({ tables: new Set(['items']), outbox: false });
  });

  it('catches up with a pull when it joins', async () => {
    const server = new FakeServer();
    server.put('items', { id: 'i1', household_id: 'h1', name: 'missed while away' });
    const b = await device(server, 'user-b');
    b.startRealtime();
    await flush();
    await b.sync();
    expect(await name(b, 'i1')).toBe('missed while away');
  });

  it('ignores an older delivery and keeps a pending local write on top', async () => {
    const server = new FakeServer();
    const first = server.put('items', { id: 'i1', household_id: 'h1', name: 'milk', note: null });
    const b = await device(server, 'user-b');
    b.startRealtime();
    await b.sync();
    server.put('items', { id: 'i1', household_id: 'h1', name: 'oat milk' });
    await flush();
    await b.store.applyServerRows('items', [first]); // a late, older event
    expect(await name(b, 'i1')).toBe('oat milk');

    server.offline = true;
    await b.update('items', 'i1', { note: 'big one' });
    server.put('items', { id: 'i1', household_id: 'h1', name: 'whole milk' });
    await flush();
    expect(await b.store.row('items', 'i1')).toMatchObject({ name: 'whole milk', note: 'big one' });
  });

  it('fetches the whole row when an event leaves a column out', async () => {
    const server = new FakeServer();
    const b = await device(server, 'user-b');
    const stored = server.put('items', { id: 'i1', household_id: 'h1', name: 'milk', note: 'n' });
    const partial: SyncRow = { ...stored };
    delete partial.note;
    const remote = server.remote('user-b');
    let deliver: ((row: SyncRow) => void) | null = null;
    const engine = new SyncEngine(
      b.store,
      {
        ...remote,
        subscribe: (_h, _t, listener) => {
          deliver = (row) => listener.onRow('items', row);
          return () => undefined;
        },
      },
      'h1',
    );
    engines.push(engine);
    engine.startRealtime();
    deliver!(partial);
    await flush();
    await flush();
    expect(await b.store.row('items', 'i1')).toMatchObject({ name: 'milk', note: 'n' });
  });

  it('stops delivering to a removed member', async () => {
    const server = new FakeServer();
    const a = await device(server, 'user-a');
    const b = await device(server, 'user-b');
    b.startRealtime();
    await flush();
    server.removed.add('user-b');
    await a.insert('items', 'i1', { name: 'milk' });
    await a.sync();
    await flush();
    expect(await b.store.row('items', 'i1')).toBeNull();
  });

  it('stops listening while offline and when stopped', async () => {
    const server = new FakeServer();
    const b = await device(server, 'user-b');
    b.startRealtime();
    await flush();
    b.stopRealtime();
    expect(b.getStatus().realtime).toBe('off');
    server.put('items', { id: 'i1', household_id: 'h1', name: 'milk' });
    await flush();
    expect(await b.store.row('items', 'i1')).toBeNull();
  });
});
