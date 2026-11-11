/**
 * @jest-environment node
 */
// Two-device sync harness (H-06.3 acceptance, NFR-OFF-5), ported from the H-06.1 spike
// (PR #110) to our own engine. Two "devices" each have their own signed-in Supabase client,
// their own SQLite file and their own engine, against a local Supabase stack. "Offline"
// makes the device's fetch fail the way React Native's does. The spike's two failures are
// regression cases here: S4 (a row deleted elsewhere came back) and S6 (a stale uncheck
// stalled the queue).
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

import { SyncEngine } from '@/lib/sync/engine';
import { LocalStore } from '@/lib/sync/local-store';
import { createSupabaseRemote } from '@/lib/sync/remote';
import type { SyncRow, SyncTableDefinition } from '@/lib/sync/types';

import { createTestDatabase } from '../sqlite';

const env = (...names: string[]) => names.map((n) => process.env[n]).find(Boolean);
const URL = env('API_URL');
const ANON_KEY = env('ANON_KEY', 'PUBLISHABLE_KEY');
const SERVICE_KEY = env('SERVICE_ROLE_KEY', 'SECRET_KEY');

const TABLE = 'harness_items';
const items: SyncTableDefinition = { name: TABLE, columns: { name: 'text', checked: 'boolean' } };

jest.setTimeout(120_000);

if (!URL || !ANON_KEY || !SERVICE_KEY) {
  throw new Error('Set API_URL, ANON_KEY and SERVICE_ROLE_KEY from `pnpm supabase status -o env`.');
}

const admin = createClient(URL, SERVICE_KEY, { auth: { persistSession: false } });
const password = crypto.randomUUID();
let householdId = '';
const users: Record<string, { id: string; email: string }> = {};

export type Device = {
  name: string;
  client: SupabaseClient;
  engine: SyncEngine;
  net: { online: boolean };
  restart(): Promise<void>;
  row(id: string): Promise<SyncRow | null>;
  goOffline(): void;
  goOnline(): Promise<void>;
};

async function createDevice(name: string): Promise<Device> {
  const net = { online: true };
  const client = createClient(URL!, ANON_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: {
      fetch: (input, init) =>
        net.online ? fetch(input, init) : Promise.reject(new TypeError('Network request failed')),
    },
  });
  const { error } = await client.auth.signInWithPassword({ email: users[name].email, password });
  if (error) throw error;
  const db = createTestDatabase();
  const start = async () => {
    const engine = new SyncEngine(
      new LocalStore(db, [items]),
      createSupabaseRemote(client),
      householdId,
    );
    await engine.open();
    return engine;
  };
  const device: Device = {
    name,
    client,
    net,
    engine: await start(),
    // Killing the app: a new engine on the same database file.
    async restart() {
      device.engine.stop();
      device.engine = await start();
    },
    async row(id) {
      const row = await device.engine.store.row(TABLE, id);
      return row && !row.deleted_at ? row : null;
    },
    goOffline() {
      net.online = false;
    },
    // What the app does on regaining connectivity.
    async goOnline() {
      net.online = true;
      await device.engine.sync();
    },
  };
  await device.engine.sync();
  return device;
}

async function serverRow(id: string): Promise<SyncRow | null> {
  const { data } = await admin.from(TABLE).select().eq('id', id).maybeSingle();
  return data as SyncRow | null;
}

async function seed(rows: { id: string; name: string; checked?: boolean }[]) {
  const { error } = await admin
    .from(TABLE)
    .insert(rows.map((r) => ({ household_id: householdId, ...r })));
  if (error) throw error;
}

let A: Device;
let B: Device;

beforeAll(async () => {
  for (const name of ['a', 'b']) {
    const { data, error } = await admin.auth.admin.createUser({
      email: `harness-${name}-${crypto.randomUUID()}@example.test`,
      password,
      email_confirm: true,
    });
    if (error) throw error;
    users[name] = { id: data.user.id, email: data.user.email! };
  }
  const { data: household, error } = await admin
    .from('households')
    .insert({
      name: 'Harness',
      region: 'US',
      locale: 'en-US',
      unit_system: 'us_customary',
      timezone: 'UTC',
      week_start: 7,
    })
    .select()
    .single();
  if (error) throw error;
  householdId = household.id;
  const { error: membersError } = await admin.from('household_members').insert([
    { household_id: householdId, user_id: users.a.id, role: 'parent' },
    { household_id: householdId, user_id: users.b.id, role: 'parent' },
  ]);
  if (membersError) throw membersError;

  A = await createDevice('a');
  B = await createDevice('b');
});

afterAll(() => {
  A?.engine.stop();
  B?.engine.stop();
});

describe('two devices offline (architecture section 5)', () => {
  const ids = {
    different1: crypto.randomUUID(),
    different2: crypto.randomUUID(),
    same: crypto.randomUUID(),
    bothCheck: crypto.randomUUID(),
    staleUncheck: crypto.randomUUID(),
    deleted: crypto.randomUUID(),
  };
  const newOnA = crypto.randomUUID();
  const newOnB = crypto.randomUUID();
  const server: Record<string, SyncRow | null> = {};
  const both = async (id: string) => [await A.row(id), await B.row(id)];

  beforeAll(async () => {
    await seed([
      { id: ids.different1, name: 'eggs' },
      { id: ids.different2, name: 'bread' },
      { id: ids.same, name: 'apples' },
      { id: ids.bothCheck, name: 'butter' },
      { id: ids.staleUncheck, name: 'rice', checked: true },
      { id: ids.deleted, name: 'yoghurt' },
    ]);
    await A.engine.sync();
    await B.engine.sync();
    expect((await A.engine.store.rows(TABLE)).length).toBe(6);
    expect((await B.engine.store.rows(TABLE)).length).toBe(6);

    A.goOffline();
    B.goOffline();

    await A.engine.update(TABLE, ids.different1, { name: 'eggs (A)' });
    await B.engine.update(TABLE, ids.different2, { name: 'bread (B)' });
    await A.engine.update(TABLE, ids.same, { name: 'apples (A)' });
    await B.engine.update(TABLE, ids.same, { name: 'apples (B)' });
    await A.engine.update(TABLE, ids.bothCheck, { checked: true });
    await B.engine.update(TABLE, ids.bothCheck, { checked: true });
    await A.engine.insert(TABLE, newOnA, { name: 'pasta (A)' });
    await B.engine.insert(TABLE, newOnB, { name: 'tea (B)' });
    await A.engine.remove(TABLE, ids.deleted);
    await B.engine.update(TABLE, ids.deleted, { name: 'yoghurt (B edit after A deleted)' });
    await B.engine.update(TABLE, ids.staleUncheck, { checked: false });

    await A.restart();
  });

  it('S7 keeps queued offline edits across a restart', async () => {
    expect(A.engine.getStatus().pending).toBe(5);
    expect((await A.row(ids.different1))?.name).toBe('eggs (A)');
    expect((await A.row(newOnA))?.name).toBe('pasta (A)');
    expect(await A.row(ids.deleted)).toBeNull();
  });

  it('reconnects and drains both queues', async () => {
    // A comes back first and unchecks then re-checks rice while B is still offline, so the
    // newest server state is "checked" at a later version than B saw.
    await A.goOnline();
    expect(A.engine.getStatus()).toMatchObject({ state: 'idle', pending: 0 });
    await A.engine.update(TABLE, ids.staleUncheck, { checked: false });
    await A.engine.sync();
    await A.engine.update(TABLE, ids.staleUncheck, { checked: true });
    await A.engine.sync();
    expect((await serverRow(ids.staleUncheck))?.checked).toBe(true);

    await B.goOnline();
    await A.engine.sync();
    expect(A.engine.getStatus()).toMatchObject({ state: 'idle', pending: 0, rejected: 0 });
    expect(B.engine.getStatus()).toMatchObject({ state: 'idle', pending: 0, rejected: 0 });

    for (const [key, id] of Object.entries({ ...ids, newOnA, newOnB })) {
      server[key] = await serverRow(id);
    }
  });

  it('S1 keeps edits to different rows from both devices', async () => {
    expect(server.different1?.name).toBe('eggs (A)');
    expect(server.different2?.name).toBe('bread (B)');
    expect((await both(ids.different1)).map((r) => r?.name)).toEqual(['eggs (A)', 'eggs (A)']);
    expect((await both(ids.different2)).map((r) => r?.name)).toEqual(['bread (B)', 'bread (B)']);
  });

  it('S2 converges on the last write to reach the server', async () => {
    expect(server.same?.name).toBe('apples (B)');
    expect((await both(ids.same)).map((r) => r?.name)).toEqual(['apples (B)', 'apples (B)']);
  });

  it('S3 leaves an item both devices ticked ticked', async () => {
    expect(server.bothCheck?.checked).toBe(true);
    expect((await both(ids.bothCheck)).map((r) => r?.checked)).toEqual([true, true]);
  });

  it('S4 does not bring back a row deleted on the other device (spike regression)', async () => {
    expect(server.deleted?.deleted_at).not.toBeNull();
    expect(server.deleted?.name).toBe('yoghurt');
    expect(await both(ids.deleted)).toEqual([null, null]);
  });

  it('S5 delivers rows created offline on both devices to both', async () => {
    expect((await both(newOnA)).map((r) => r?.name)).toEqual(['pasta (A)', 'pasta (A)']);
    expect((await both(newOnB)).map((r) => r?.name)).toEqual(['tea (B)', 'tea (B)']);
  });

  it('S6 lets no stale uncheck override a newer check, and no queue stall (spike regression)', async () => {
    expect(server.staleUncheck?.checked).toBe(true);
    expect((await both(ids.staleUncheck)).map((r) => r?.checked)).toEqual([true, true]);
    expect([A.engine.getStatus().pending, B.engine.getStatus().pending]).toEqual([0, 0]);
  });

  it('converges: both devices hold exactly the server row, version included', async () => {
    for (const row of Object.values(server)) {
      for (const device of [A, B]) {
        const local = await device.engine.store.row(TABLE, row!.id);
        expect({ device: device.name, ...local }).toMatchObject({
          device: device.name,
          version: row!.version,
          name: row!.name,
          checked: row!.checked,
          deleted_at: row!.deleted_at,
        });
      }
    }
  });
});

describe('queue limits', () => {
  it('sends 500 queued changes within 10 seconds of reconnecting (NFR-OFF-4)', async () => {
    A.goOffline();
    const created = Array.from({ length: 250 }, () => crypto.randomUUID());
    for (const id of created) await A.engine.insert(TABLE, id, { name: 'bulk' });
    for (const id of created) await A.engine.update(TABLE, id, { checked: true });
    expect(A.engine.getStatus().pending).toBe(500);

    const start = performance.now();
    await A.goOnline();
    const ms = performance.now() - start;
    console.log(`500 queued changes synced in ${ms.toFixed(0)} ms`);
    expect(A.engine.getStatus().pending).toBe(0);
    expect(ms).toBeLessThan(10_000);
    const { count } = await admin
      .from(TABLE)
      .select('id', { count: 'exact', head: true })
      .in('id', created)
      .eq('checked', true)
      .eq('version', 2);
    expect(count).toBe(250);
  });

  it('discards writes from a removed member and tells them, without stalling (NFR-OFF-6)', async () => {
    const id = crypto.randomUUID();
    await seed([{ id, name: 'flour' }]);
    await B.engine.sync();
    B.goOffline();
    await B.engine.update(TABLE, id, { name: 'flour (B, after removal)' });
    await B.engine.insert(TABLE, crypto.randomUUID(), { name: 'sugar (B, after removal)' });

    const { error } = await admin
      .from('household_members')
      .update({ status: 'removed' })
      .eq('user_id', users.b.id);
    if (error) throw error;

    await B.goOnline();
    expect(B.engine.getStatus()).toMatchObject({ pending: 0, rejected: 2 });
    expect((await serverRow(id))?.name).toBe('flour');
  });
});
