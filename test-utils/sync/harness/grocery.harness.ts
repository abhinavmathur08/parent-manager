/**
 * @jest-environment node
 */
// Two partners shopping from one list (G-04.1 and G-04.2 acceptance, FR-LIST-8, FR-LIST-9,
// FR-LIST-11, FR-MEM-1, NFR-OFF-5): a check-off reaches the partner within 2 seconds online
// with who checked it, both partners ticking the same list offline end with one consistent
// list, a stale offline uncheck never undoes a newer check, and both partners checking the
// same item off offline leave one purchase event. Runs against the real grocery tables from
// the migrations, through the engine.
import { createClient } from '@supabase/supabase-js';

import { planCheckEvent, purchaseEventId } from '@/features/grocery/purchases';
import {
  GROCERY_ITEMS,
  GROCERY_TABLES,
  PURCHASE_EVENTS,
  type GroceryItemRow,
  type PurchaseEventRow,
} from '@/features/grocery/tables';
import { SyncEngine } from '@/lib/sync/engine';
import { LocalStore } from '@/lib/sync/local-store';
import { createSupabaseRemote } from '@/lib/sync/remote';
import type { SyncRow } from '@/lib/sync/types';

import { createTestDatabase } from '../sqlite';

const env = (...names: string[]) => names.map((n) => process.env[n]).find(Boolean);
const URL = env('API_URL');
const ANON_KEY = env('ANON_KEY', 'PUBLISHABLE_KEY');
const SERVICE_KEY = env('SERVICE_ROLE_KEY', 'SECRET_KEY');

jest.setTimeout(90_000);

if (!URL || !ANON_KEY || !SERVICE_KEY) {
  throw new Error('Set API_URL, ANON_KEY and SERVICE_ROLE_KEY from `pnpm supabase status -o env`.');
}

const admin = createClient(URL, SERVICE_KEY, { auth: { persistSession: false } });
const password = crypto.randomUUID();
let householdId = '';
let listId = '';
const userIds: string[] = [];

export type ShoppingDevice = {
  userId: string;
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

async function createDevice(email: string, userId: string): Promise<ShoppingDevice> {
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
    new LocalStore(createTestDatabase(), [...GROCERY_TABLES]),
    createSupabaseRemote(client),
    householdId,
  );
  await engine.open();
  const device: ShoppingDevice = {
    userId,
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

let A: ShoppingDevice;
let B: ShoppingDevice;

beforeAll(async () => {
  const emails: string[] = [];
  for (const name of ['a', 'b']) {
    const { data, error } = await admin.auth.admin.createUser({
      email: `shopping-${name}-${crypto.randomUUID()}@example.test`,
      password,
      email_confirm: true,
    });
    if (error) throw error;
    emails.push(data.user.email!);
    userIds.push(data.user.id);
  }
  const { data: household, error } = await admin
    .from('households')
    .insert({
      name: 'Shopping harness',
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
    .insert(userIds.map((user_id) => ({ household_id: householdId, user_id, role: 'parent' })));
  if (membersError) throw membersError;
  // Fixed dates: on Premium every week stays readable, so they never leave the free history
  // window (G-08).
  const { error: tierError } = await admin
    .from('household_entitlements')
    .update({ tier: 'premium' })
    .eq('household_id', householdId);
  if (tierError) throw tierError;
  listId = crypto.randomUUID();
  const { error: listError } = await admin
    .from('grocery_lists')
    .insert({ id: listId, household_id: householdId, week_start: '2026-11-15' });
  if (listError) throw listError;

  A = await createDevice(emails[0], userIds[0]);
  B = await createDevice(emails[1], userIds[1]);
  await sleep(1500);
});

afterAll(() => {
  A?.engine.stop();
  B?.engine.stop();
});

/** A manual item added on device A and synced to B. */
async function addItem(name: string): Promise<string> {
  const id = crypto.randomUUID();
  await A.engine.insert(GROCERY_ITEMS.name, id, {
    list_id: listId,
    ingredient_id: null,
    custom_name: name,
    section_id: 'section.other',
    origin: 'manual',
    user_modified: false,
    plan_changed: false,
    checked: false,
  });
  await A.engine.sync();
  await B.engine.sync();
  if (!(await B.row(GROCERY_ITEMS.name, id))) throw new Error(`${name} didn't reach B`);
  return id;
}

async function checked(device: ShoppingDevice, id: string) {
  const row = await device.row(GROCERY_ITEMS.name, id);
  return row ? { checked: row.checked, checked_by: row.checked_by } : null;
}

it("shows a partner's check-off within 2 seconds, with who checked it (FR-LIST-8)", async () => {
  // Untimed warm-up until a change arrives over Realtime (see planner.harness.ts).
  let ready = false;
  for (let i = 0; i < 15 && !ready; i++) {
    const warmUp = await addItem(`Warm-up ${i}`);
    await A.engine.update(GROCERY_ITEMS.name, warmUp, { checked: true });
    ready =
      (await waitUntil(
        async () => (await B.row(GROCERY_ITEMS.name, warmUp))?.checked === true,
        1500,
      )) !== null;
  }
  expect(ready).toBe(true);

  const timings: number[] = [];
  for (let i = 0; i < 10; i++) {
    const id = await addItem(`Item ${i}`);
    await A.engine.update(GROCERY_ITEMS.name, id, { checked: true });
    const ms = await waitUntil(async () => (await checked(B, id))?.checked === true);
    timings.push(ms ?? Infinity);
    expect(await checked(B, id)).toEqual({ checked: true, checked_by: A.userId });
    expect((await B.row(GROCERY_ITEMS.name, id))?.updated_by).toBe(A.userId);
    await sleep(100);
  }
  timings.sort((x, y) => x - y);
  const p95 = timings[Math.floor(timings.length * 0.95)];
  console.log(`check-off to the partner: p95 ${p95.toFixed(0)} ms`);
  expect(p95).toBeLessThan(2000);
});

it('ends with one consistent list after both partners shop offline (NFR-OFF-5)', async () => {
  const eggs = await addItem('Eggs');
  const bread = await addItem('Bread');
  const milk = await addItem('Milk');
  const apples = await addItem('Apples');

  A.goOffline();
  B.goOffline();
  // Each partner picks up different things, and both pick up the milk.
  await A.engine.update(GROCERY_ITEMS.name, eggs, { checked: true });
  await B.engine.update(GROCERY_ITEMS.name, bread, { checked: true });
  await A.engine.update(GROCERY_ITEMS.name, milk, { checked: true });
  await B.engine.update(GROCERY_ITEMS.name, milk, { checked: true });
  // A ticks the apples by mistake and unticks them again.
  await A.engine.update(GROCERY_ITEMS.name, apples, { checked: true });
  await A.engine.update(GROCERY_ITEMS.name, apples, { checked: false });

  await A.goOnline();
  await B.goOnline();
  await A.engine.sync();

  for (const device of [A, B]) {
    expect(device.engine.getStatus()).toMatchObject({ pending: 0, rejected: 0 });
    expect(await checked(device, eggs)).toEqual({ checked: true, checked_by: A.userId });
    expect(await checked(device, bread)).toEqual({ checked: true, checked_by: B.userId });
    // The first check to reach the server keeps the who and when.
    expect(await checked(device, milk)).toEqual({ checked: true, checked_by: A.userId });
    expect(await checked(device, apples)).toEqual({ checked: false, checked_by: null });
  }
});

it('never lets a stale offline uncheck undo a newer check (spec 3.8)', async () => {
  const nappies = await addItem('Nappies');
  await A.engine.update(GROCERY_ITEMS.name, nappies, { checked: true });
  await A.engine.sync();
  await B.engine.sync();
  expect((await checked(B, nappies))?.checked).toBe(true);

  // A, offline, unticks the nappies. Meanwhile B unticks them and ticks them again.
  A.goOffline();
  await A.engine.update(GROCERY_ITEMS.name, nappies, { checked: false });
  await B.engine.update(GROCERY_ITEMS.name, nappies, { checked: false });
  await B.engine.sync();
  await B.engine.update(GROCERY_ITEMS.name, nappies, { checked: true });
  await B.engine.sync();

  await A.goOnline();
  await B.engine.sync();
  for (const device of [A, B]) {
    expect(device.engine.getStatus()).toMatchObject({ pending: 0, rejected: 0 });
    expect(await checked(device, nappies)).toEqual({ checked: true, checked_by: B.userId });
  }
});

/** What the app does on a check-off (useToggleItem): the check, then its purchase event. */
async function checkOff(device: ShoppingDevice, id: string) {
  await device.engine.update(GROCERY_ITEMS.name, id, { checked: true });
  const item = (await device.row(GROCERY_ITEMS.name, id)) as GroceryItemRow;
  const events = (await device.engine.store.rows(PURCHASE_EVENTS.name)) as PurchaseEventRow[];
  const event = planCheckEvent(item, events, Date.now());
  if (event) await device.engine.insert(PURCHASE_EVENTS.name, purchaseEventId(id, 0), event.values);
}

async function liveEvents(itemId: string) {
  const { data, error } = await admin
    .from('purchase_events')
    .select('id, recorded_by')
    .eq('item_id', itemId)
    .is('deleted_at', null);
  if (error) throw error;
  return data;
}

it('keeps one purchase event when both partners check an item off offline (R-MEM-1)', async () => {
  const yoghurt = await addItem('Yoghurt');
  A.goOffline();
  B.goOffline();
  await checkOff(A, yoghurt);
  await checkOff(B, yoghurt);
  await A.goOnline();
  await B.goOnline();
  await A.engine.sync();

  const events = await liveEvents(yoghurt);
  expect(events).toHaveLength(1);
  expect(events[0].recorded_by).toBe(A.userId);
  for (const device of [A, B]) {
    expect(device.engine.getStatus()).toMatchObject({ pending: 0, rejected: 0 });
    const local = (await device.engine.store.rows(PURCHASE_EVENTS.name)).filter(
      (e) => e.item_id === yoghurt,
    );
    expect(local.map((e) => e.id)).toEqual([events[0].id]);
  }
});

it('keeps one live event when the partners chose different IDs (R-MEM-1)', async () => {
  const butter = await addItem('Butter');
  A.goOffline();
  B.goOffline();
  await checkOff(A, butter);
  // B had already used the first ID (an undone purchase), so it writes under the next one.
  await B.engine.update(GROCERY_ITEMS.name, butter, { checked: true });
  const item = (await B.row(GROCERY_ITEMS.name, butter)) as GroceryItemRow;
  const event = planCheckEvent(item, [], Date.now())!;
  await B.engine.insert(PURCHASE_EVENTS.name, purchaseEventId(butter, 1), event.values);
  await A.goOnline();
  await B.goOnline();
  await A.engine.sync();

  expect(await liveEvents(butter)).toHaveLength(1);
  for (const device of [A, B]) {
    expect(device.engine.getStatus()).toMatchObject({ pending: 0, rejected: 0 });
  }
});
