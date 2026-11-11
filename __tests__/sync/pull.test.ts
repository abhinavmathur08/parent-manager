import { PAGE_SIZE, STALE_AFTER_MS, SyncEngine } from '@/lib/sync/engine';
import { LocalStore } from '@/lib/sync/local-store';
import type { SyncTableDefinition } from '@/lib/sync/types';
import { FakeServer } from '../../test-utils/sync/fake-server';
import { createTestDatabase } from '../../test-utils/sync/sqlite';

const items: SyncTableDefinition = { name: 'items', columns: { name: 'text' } };

function setup() {
  const server = new FakeServer();
  const db = createTestDatabase();
  let now = Date.UTC(2026, 10, 10);
  const clock = { advance: (ms: number) => (now += ms) };
  const device = async () => {
    const engine = new SyncEngine(new LocalStore(db, [items]), server.remote(), 'h1', () => now);
    await engine.open();
    return engine;
  };
  return { server, device, clock };
}

const names = async (engine: SyncEngine) =>
  (await engine.store.rows('items')).map((r) => r.name).sort();

describe('SyncEngine pull', () => {
  it('copies the household, and only that household, to the device', async () => {
    const { server, device } = setup();
    server.put('items', { id: 'a', household_id: 'h1', name: 'milk' });
    server.put('items', { id: 'b', household_id: 'h2', name: 'not ours' });
    const engine = await device();
    await engine.sync();
    expect(await names(engine)).toEqual(['milk']);
    expect(engine.getStatus()).toEqual({ state: 'idle', lastSyncedAt: expect.any(Number) });
  });

  it('shows cached rows after a restart in airplane mode (NFR-OFF-1)', async () => {
    const { server, device } = setup();
    server.put('items', { id: 'a', household_id: 'h1', name: 'milk' });
    await (await device()).sync();

    server.offline = true;
    const restarted = await device();
    await restarted.sync();
    expect(restarted.getStatus().state).toBe('offline');
    expect(await names(restarted)).toEqual(['milk']);
  });

  it('pulls changes and tombstones since the last pull', async () => {
    const { server, device } = setup();
    server.put('items', { id: 'a', household_id: 'h1', name: 'milk' });
    server.put('items', { id: 'b', household_id: 'h1', name: 'eggs' });
    const engine = await device();
    await engine.sync();

    server.put('items', { id: 'a', household_id: 'h1', name: 'oat milk' });
    server.put('items', { id: 'b', household_id: 'h1', deleted_at: 'now' });
    server.put('items', { id: 'c', household_id: 'h1', name: 'bread' });
    await engine.sync();
    expect(await names(engine)).toEqual(['bread', 'oat milk']);
  });

  it('picks up a write that committed late with an earlier timestamp', async () => {
    const { server, device } = setup();
    const late = server.timestamp(); // taken before the next write, committed after the pull
    server.put('items', { id: 'a', household_id: 'h1', name: 'milk' });
    const engine = await device();
    await engine.sync();

    server.table('items').set('late', {
      id: 'late',
      household_id: 'h1',
      version: 1,
      created_at: late,
      updated_at: late,
      deleted_at: null,
      name: 'late',
    });
    await engine.sync();
    expect(await names(engine)).toEqual(['late', 'milk']);
  });

  it('pages through large tables', async () => {
    const { server, device } = setup();
    for (let i = 0; i < PAGE_SIZE * 2 + 7; i++) {
      server.put('items', { id: `r${String(i).padStart(4, '0')}`, household_id: 'h1', name: 'x' });
    }
    const engine = await device();
    await engine.sync();
    expect(await engine.store.rows('items')).toHaveLength(PAGE_SIZE * 2 + 7);
  });

  it('lists everything again after 30 days away, dropping rows deleted meanwhile (NFR-OFF-6)', async () => {
    const { server, device, clock } = setup();
    server.put('items', { id: 'a', household_id: 'h1', name: 'milk' });
    server.put('items', { id: 'b', household_id: 'h1', name: 'eggs' });
    const engine = await device();
    await engine.sync();

    // The server purged b's tombstone while the device was away.
    server.table('items').delete('b');
    clock.advance(STALE_AFTER_MS + 1);
    await engine.sync();
    expect(await names(engine)).toEqual(['milk']);
  });

  it('runs one sync at a time, folding calls made meanwhile into one more', async () => {
    const { server, device } = setup();
    const engine = await device();
    await Promise.all([engine.sync(), engine.sync(), engine.sync()]);
    expect(server.requests).toBe(2);
  });

  it('does nothing once stopped', async () => {
    const { server, device } = setup();
    const engine = await device();
    engine.stop();
    await engine.sync();
    expect(server.requests).toBe(0);
  });
});
