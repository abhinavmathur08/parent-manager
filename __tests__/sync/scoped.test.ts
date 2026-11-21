import { SyncEngine, VISIBILITY_INTERVAL_MS } from '@/lib/sync/engine';
import { LocalStore } from '@/lib/sync/local-store';
import { RemoteError } from '@/lib/sync/remote';
import type { SyncTableDefinition } from '@/lib/sync/types';

import { FakeServer } from '../../test-utils/sync/fake-server';
import { createTestDatabase } from '../../test-utils/sync/sqlite';

// Scoped tables (C-01.3, R2-ACC-2, NFR2-OFF-2): rows a member can no longer see leave their
// device, and rows that become visible again without changing come back.
const events: SyncTableDefinition = {
  name: 'events',
  columns: { title: 'text', shared: 'boolean' },
  scoped: true,
};
const people: SyncTableDefinition = {
  name: 'event_people',
  columns: { event_id: 'text' },
  scoped: true,
};
const plan: SyncTableDefinition = { name: 'plan', columns: { title: 'text' } };

const engines: SyncEngine[] = [];
afterEach(() => {
  jest.useRealTimers();
  for (const engine of engines.splice(0)) engine.stop();
});

/** A server where the caregiver sees shared events and their people, while not paused. */
function server() {
  const s = new FakeServer();
  s.scoped.add('events');
  s.scoped.add('event_people');
  const paused = new Set<string>();
  s.canSee = (user, table, row) => {
    if (user !== 'caregiver') return true;
    if (paused.has(user) && table !== 'plan') return false;
    if (table === 'events') return !!row.shared;
    if (table === 'event_people') return !!s.table('events').get(row.event_id as string)?.shared;
    return true;
  };
  s.put('events', { id: 'e1', household_id: 'h1', title: 'Daycare', shared: true });
  s.put('events', { id: 'e2', household_id: 'h1', title: 'Pediatrician', shared: false });
  s.put('event_people', { id: 'p1', household_id: 'h1', event_id: 'e1' });
  s.put('plan', { id: 'm1', household_id: 'h1', title: 'Soup' });
  return { s, paused };
}

async function device(s: FakeServer, user: string) {
  const engine = new SyncEngine(
    new LocalStore(createTestDatabase(), [events, people, plan]),
    s.remote(user),
    'h1',
  );
  engines.push(engine);
  await engine.open();
  await engine.sync();
  return engine;
}

const ids = async (engine: SyncEngine, table: string) => (await engine.store.liveIds(table)).sort();
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('scoped sync tables (C-01.3)', () => {
  it('pulls only what the member can see', async () => {
    const { s } = server();
    const caregiver = await device(s, 'caregiver');
    expect(await ids(caregiver, 'events')).toEqual(['e1']);
    expect(await ids(caregiver, 'event_people')).toEqual(['p1']);
  });

  it('drops an unshared event and its people on the next check', async () => {
    const { s } = server();
    const caregiver = await device(s, 'caregiver');
    s.put('events', { id: 'e1', household_id: 'h1', shared: false });
    // An incremental pull alone can't see it: the caregiver never gets the changed row.
    await caregiver.sync();
    await caregiver.checkVisibility();
    expect(await ids(caregiver, 'events')).toEqual([]);
    expect(await ids(caregiver, 'event_people')).toEqual([]);
    expect(await ids(caregiver, 'plan')).toEqual(['m1']);
  });

  it('brings back unchanged child rows when an event is shared again', async () => {
    const { s } = server();
    const caregiver = await device(s, 'caregiver');
    s.put('events', { id: 'e1', household_id: 'h1', shared: false });
    await caregiver.checkVisibility();
    s.put('events', { id: 'e1', household_id: 'h1', shared: true });
    await caregiver.sync();
    await caregiver.checkVisibility();
    expect(await ids(caregiver, 'events')).toEqual(['e1']);
    expect(await ids(caregiver, 'event_people')).toEqual(['p1']);
  });

  it('clears every scoped table on a lapse, and leaves the rest', async () => {
    const { s, paused } = server();
    const caregiver = await device(s, 'caregiver');
    paused.add('caregiver');
    await caregiver.checkVisibility();
    expect(await ids(caregiver, 'events')).toEqual([]);
    expect(await ids(caregiver, 'event_people')).toEqual([]);
    expect(await ids(caregiver, 'plan')).toEqual(['m1']);
  });

  it('clears every scoped table when the member is removed', async () => {
    const { s } = server();
    const caregiver = await device(s, 'caregiver');
    s.removed.add('caregiver');
    await caregiver.checkVisibility();
    expect(await ids(caregiver, 'events')).toEqual([]);
    expect(await ids(caregiver, 'event_people')).toEqual([]);
  });

  it('keeps a row with a write still queued', async () => {
    const { s } = server();
    // The server is down for writes, so the caregiver's new row stays queued.
    const remote = s.remote('caregiver');
    const caregiver = new SyncEngine(
      new LocalStore(createTestDatabase(), [events, people, plan]),
      { ...remote, insert: async () => Promise.reject(new RemoteError('down', 503, '')) },
      'h1',
    );
    engines.push(caregiver);
    await caregiver.open();
    await caregiver.insert('events', 'e3', { title: 'Park', shared: false });
    await caregiver.sync();
    expect(caregiver.getStatus().pending).toBe(1);
    await caregiver.checkVisibility();
    expect(await ids(caregiver, 'events')).toEqual(['e1', 'e3']);
  });

  it('keeps everything when the check fails offline', async () => {
    const { s } = server();
    const caregiver = await device(s, 'caregiver');
    s.put('events', { id: 'e1', household_id: 'h1', shared: false });
    s.offline = true;
    await caregiver.checkVisibility();
    expect(await ids(caregiver, 'events')).toEqual(['e1']);
  });

  it('checks on every Realtime join, and every minute while connected', async () => {
    const { s } = server();
    const caregiver = await device(s, 'caregiver');
    s.put('events', { id: 'e1', household_id: 'h1', shared: false });
    caregiver.startRealtime();
    await flush();
    await caregiver.sync();
    expect(await ids(caregiver, 'events')).toEqual([]);

    s.put('events', { id: 'e4', household_id: 'h1', title: 'Swim', shared: true });
    await flush();
    expect(await ids(caregiver, 'events')).toEqual(['e4']);
    jest.useFakeTimers({ doNotFake: ['queueMicrotask', 'nextTick', 'setImmediate'] });
    caregiver.stopRealtime();
    caregiver.startRealtime();
    await Promise.resolve();
    await jest.advanceTimersByTimeAsync(0);
    s.put('events', { id: 'e4', household_id: 'h1', shared: false });
    // Unsharing sends the caregiver no event; the timer's check removes it, with no sync.
    await jest.advanceTimersByTimeAsync(VISIBILITY_INTERVAL_MS);
    jest.useRealTimers();
    for (let i = 0; i < 20; i++) await flush();
    expect(await ids(caregiver, 'events')).toEqual([]);
  });

  it('never asks the server about tables that are not scoped', async () => {
    const s = new FakeServer();
    s.put('plan', { id: 'm1', household_id: 'h1', title: 'Soup' });
    const engine = new SyncEngine(new LocalStore(createTestDatabase(), [plan]), s.remote(), 'h1');
    engines.push(engine);
    await engine.open();
    await engine.sync();
    await engine.checkVisibility();
    expect(await ids(engine, 'plan')).toEqual(['m1']);
  });
});
