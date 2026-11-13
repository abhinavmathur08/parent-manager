/**
 * @jest-environment node
 */
// The plan on two devices (P-01.1 acceptance, FR-PLAN-4, FR-PLAN-11): plan changes reach the
// partner within 2 seconds online, both partners adding to one slot offline keeps both
// entries, a delete wins over a move, and portions written offline by both land on one row.
// Runs against the real planner tables from the migrations, through the engine.
import { createClient } from '@supabase/supabase-js';

import {
  PLAN_ENTRIES,
  PLAN_ENTRY_PORTIONS,
  PLAN_TABLES,
  portionId,
} from '@/features/planner/tables';
import { RECIPE_TABLES } from '@/features/recipes/tables';
import { SyncEngine } from '@/lib/sync/engine';
import { LocalStore } from '@/lib/sync/local-store';
import { createSupabaseRemote } from '@/lib/sync/remote';
import type { SyncRow } from '@/lib/sync/types';

import { createTestDatabase } from '../sqlite';

const env = (...names: string[]) => names.map((n) => process.env[n]).find(Boolean);
const URL = env('API_URL');
const ANON_KEY = env('ANON_KEY', 'PUBLISHABLE_KEY');
const SERVICE_KEY = env('SERVICE_ROLE_KEY', 'SECRET_KEY');

jest.setTimeout(60_000);

if (!URL || !ANON_KEY || !SERVICE_KEY) {
  throw new Error('Set API_URL, ANON_KEY and SERVICE_ROLE_KEY from `pnpm supabase status -o env`.');
}

const admin = createClient(URL, SERVICE_KEY, { auth: { persistSession: false } });
const password = crypto.randomUUID();
let householdId = '';
let personId = '';

type Device = {
  engine: SyncEngine;
  row(table: string, id: string): Promise<SyncRow | null>;
  goOffline(): void;
  goOnline(): Promise<void>;
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Milliseconds until the predicate holds, or null after the timeout. */
async function waitUntil(predicate: () => Promise<boolean>, timeoutMs = 10_000) {
  const start = performance.now();
  while (performance.now() - start < timeoutMs) {
    if (await predicate()) return performance.now() - start;
    await sleep(10);
  }
  return null;
}

async function createDevice(email: string): Promise<Device> {
  const net = { online: true };
  const client = createClient(URL!, ANON_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: {
      fetch: (input, init) =>
        net.online ? fetch(input, init) : Promise.reject(new TypeError('Network request failed')),
    },
  });
  const { error } = await client.auth.signInWithPassword({ email, password });
  if (error) throw error;
  const engine = new SyncEngine(
    new LocalStore(createTestDatabase(), [...RECIPE_TABLES, ...PLAN_TABLES]),
    createSupabaseRemote(client),
    householdId,
  );
  await engine.open();
  const device: Device = {
    engine,
    async row(table, id) {
      const row = await engine.store.row(table, id);
      return row && !row.deleted_at ? row : null;
    },
    goOffline() {
      net.online = false;
      engine.stopRealtime();
    },
    async goOnline() {
      net.online = true;
      engine.startRealtime();
      await engine.sync();
      await waitUntil(async () => engine.getStatus().realtime === 'connected');
    },
  };
  await device.goOnline();
  return device;
}

let A: Device;
let B: Device;

beforeAll(async () => {
  const emails: string[] = [];
  const ids: string[] = [];
  for (const name of ['a', 'b']) {
    const { data, error } = await admin.auth.admin.createUser({
      email: `planner-${name}-${crypto.randomUUID()}@example.test`,
      password,
      email_confirm: true,
    });
    if (error) throw error;
    emails.push(data.user.email!);
    ids.push(data.user.id);
  }
  const { data: household, error } = await admin
    .from('households')
    .insert({
      name: 'Planner harness',
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
  const { error: membersError } = await admin
    .from('household_members')
    .insert(ids.map((user_id) => ({ household_id: householdId, user_id, role: 'parent' })));
  if (membersError) throw membersError;
  const { data: person, error: personError } = await admin
    .from('household_people')
    .insert({
      household_id: householdId,
      display_name: 'Toddler',
      kind: 'child',
      age_band: 'toddler',
    })
    .select('id')
    .single();
  if (personError) throw personError;
  personId = person.id;

  A = await createDevice(emails[0]);
  B = await createDevice(emails[1]);
  await sleep(1500);
});

afterAll(() => {
  A?.engine.stop();
  B?.engine.stop();
});

const entry = (date: string, text: string) => ({
  date,
  slot: 'dinner',
  position: 0,
  recipe_id: null,
  free_text: text,
  servings: 2,
  leftover_of_entry_id: null,
});

it('shows a new plan entry on the partner within 2 seconds (FR-PLAN-11)', async () => {
  const timings: number[] = [];
  for (let i = 0; i < 10; i++) {
    const id = crypto.randomUUID();
    await A.engine.insert(PLAN_ENTRIES.name, id, entry('2026-11-16', `Dinner ${i}`));
    const ms = await waitUntil(async () => (await B.row(PLAN_ENTRIES.name, id)) !== null);
    timings.push(ms ?? Infinity);
    await sleep(100);
  }
  timings.sort((x, y) => x - y);
  const p95 = timings[Math.floor(timings.length * 0.95)];
  console.log(`plan entry to the partner: p95 ${p95.toFixed(0)} ms`);
  expect(p95).toBeLessThan(2000);
});

it('keeps both entries when both partners add to the same slot offline (FR-PLAN-4)', async () => {
  const fromA = crypto.randomUUID();
  const fromB = crypto.randomUUID();
  A.goOffline();
  B.goOffline();
  await A.engine.insert(PLAN_ENTRIES.name, fromA, entry('2026-11-17', 'Chili'));
  await B.engine.insert(PLAN_ENTRIES.name, fromB, entry('2026-11-17', 'Takeout'));
  await A.goOnline();
  await B.goOnline();
  await A.engine.sync();

  for (const device of [A, B]) {
    expect(device.engine.getStatus()).toMatchObject({ pending: 0, rejected: 0 });
    expect((await device.row(PLAN_ENTRIES.name, fromA))?.free_text).toBe('Chili');
    expect((await device.row(PLAN_ENTRIES.name, fromB))?.free_text).toBe('Takeout');
  }
});

it('lets a delete by one partner win over a move by the other (spec 3.6)', async () => {
  const id = crypto.randomUUID();
  await A.engine.insert(PLAN_ENTRIES.name, id, entry('2026-11-18', 'Soup'));
  await A.engine.sync();
  await B.engine.sync();
  expect(await B.row(PLAN_ENTRIES.name, id)).not.toBeNull();

  A.goOffline();
  B.goOffline();
  await A.engine.remove(PLAN_ENTRIES.name, id);
  await B.engine.update(PLAN_ENTRIES.name, id, { date: '2026-11-19', slot: 'lunch' });
  // The move reaches the server first; the delete still wins.
  await B.goOnline();
  await A.goOnline();
  await B.engine.sync();

  for (const device of [A, B]) {
    expect(await device.row(PLAN_ENTRIES.name, id)).toBeNull();
  }
});

it('lands portions set offline by both partners on one row', async () => {
  const id = crypto.randomUUID();
  await A.engine.insert(PLAN_ENTRIES.name, id, entry('2026-11-20', 'Pasta'));
  await A.engine.sync();
  await B.engine.sync();

  A.goOffline();
  B.goOffline();
  const portion = portionId(id, personId);
  const values = (portions: number) => ({
    entry_id: id,
    person_id: personId,
    portions,
    variant: 'standard',
  });
  await A.engine.insert(PLAN_ENTRY_PORTIONS.name, portion, values(0.5));
  await B.engine.insert(PLAN_ENTRY_PORTIONS.name, portion, values(1));
  await A.goOnline();
  await B.goOnline();
  await A.engine.sync();

  const { count } = await admin
    .from('plan_entry_portions')
    .select('id', { count: 'exact', head: true })
    .eq('entry_id', id);
  expect(count).toBe(1);
  const onA = await A.row(PLAN_ENTRY_PORTIONS.name, portion);
  const onB = await B.row(PLAN_ENTRY_PORTIONS.name, portion);
  expect(onA?.portions).toBe(0.5);
  expect(onB?.portions).toBe(onA?.portions);
  for (const device of [A, B]) {
    expect(device.engine.getStatus()).toMatchObject({ pending: 0, rejected: 0 });
  }
});
