/**
 * @jest-environment node
 */
// What a caregiver's device keeps (T-01.2, R3-ACC-1, R3-ACC-3, NFR3-OFF-3): unsharing,
// reassigning away, taking them out of a rotation and a lapse each remove the task, and its
// occurrences, from the caregiver's device within 60 seconds of reconnecting. Parents keep it.
import { createClient } from '@supabase/supabase-js';

import { occurrenceId, TASK_OCCURRENCES, TASK_TABLES, TASKS } from '@/features/tasks/tables';
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
const userIds: string[] = [];

type Device = {
  engine: SyncEngine;
  row(table: string, id: string): Promise<SyncRow | null>;
  goOffline(): void;
  goOnline(): Promise<void>;
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

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
    new LocalStore(createTestDatabase(), [...TASK_TABLES]),
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
let C: Device;

async function setTier(tier: 'free' | 'premium') {
  const { error } = await admin
    .from('household_entitlements')
    .update({ tier })
    .eq('household_id', householdId);
  if (error) throw error;
}

beforeAll(async () => {
  const emails: string[] = [];
  for (const name of ['a', 'c']) {
    const { data, error } = await admin.auth.admin.createUser({
      email: `task-helpers-${name}-${crypto.randomUUID()}@example.test`,
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
      name: 'Task helpers harness',
      region: 'GB',
      locale: 'en-GB',
      unit_system: 'metric',
      timezone: 'Europe/London',
      week_start: 1,
    })
    .select()
    .single();
  if (error) throw error;
  householdId = household.id;
  // A caregiver seat needs Premium (FR-HH-1).
  await setTier('premium');
  const { error: membersError } = await admin.from('household_members').insert([
    { household_id: householdId, user_id: userIds[0], role: 'parent' },
    { household_id: householdId, user_id: userIds[1], role: 'caregiver' },
  ]);
  if (membersError) throw membersError;

  A = await createDevice(emails[0]);
  C = await createDevice(emails[1]);
  await sleep(1500);
});

afterAll(() => {
  A?.engine.stop();
  C?.engine.stop();
});

const task = (title: string, extra: Record<string, unknown> = {}) => ({
  title,
  template_item_id: null,
  notes: null,
  due_date: '2026-12-04',
  due_at: null,
  assignee_user_id: null,
  shared: false,
  reminder: null,
  repeat: null,
  after_done_days: null,
  rotation_user_ids: null,
  source_kind: null,
  source_id: null,
  done: false,
  done_at: null,
  done_by: null,
  created_by: null,
  updated_by: null,
  ...extra,
});

/** Adds a task on the parent's device and waits for it on the caregiver's. */
async function addVisible(values: ReturnType<typeof task>) {
  const id = crypto.randomUUID();
  await A.engine.insert(TASKS.name, id, values);
  await A.engine.sync();
  await C.engine.sync();
  await C.engine.checkVisibility();
  expect(await C.row(TASKS.name, id)).not.toBeNull();
  return id;
}

/** Takes the caregiver offline, makes the change, and times the task leaving their device. */
async function expectGoneAfter(id: string, change: () => Promise<void>, label: string) {
  C.goOffline();
  await change();
  const reconnected = performance.now();
  await C.goOnline();
  const ms = await waitUntil(async () => (await C.row(TASKS.name, id)) === null, 60_000);
  console.log(
    `${label}: the task left the caregiver's device ${ms?.toFixed(0)} ms after reconnecting`,
  );
  expect(ms).not.toBeNull();
  expect(performance.now() - reconnected).toBeLessThan(60_000);
  await A.engine.sync();
  expect(await A.row(TASKS.name, id)).not.toBeNull();
}

it('removes an unshared task (R3-ACC-3)', async () => {
  const id = await addVisible(task('Pick up the prescription', { shared: true }));
  await expectGoneAfter(
    id,
    async () => {
      await A.engine.update(TASKS.name, id, { shared: false });
      await A.engine.sync();
    },
    'unshared',
  );
});

it('removes a task reassigned away from the caregiver', async () => {
  const id = await addVisible(task('Wash the bottles', { assignee_user_id: userIds[1] }));
  await expectGoneAfter(
    id,
    async () => {
      await A.engine.update(TASKS.name, id, { assignee_user_id: userIds[0] });
      await A.engine.sync();
    },
    'reassigned',
  );
});

it('removes a chore and its occurrences when the caregiver leaves its rotation', async () => {
  const id = await addVisible(
    task('Bath time', {
      repeat: { freq: 'daily' },
      rotation_user_ids: [userIds[0], userIds[1]],
    }),
  );
  const occurrence = occurrenceId(id, '2026-12-04');
  await C.engine.insert(TASK_OCCURRENCES.name, occurrence, {
    task_id: id,
    original_date: '2026-12-04',
    assignee_user_id: userIds[1],
    skipped: false,
    done: true,
    done_at: null,
    done_by: null,
  });
  await C.engine.sync();
  expect(C.engine.getStatus()).toMatchObject({ pending: 0, rejected: 0 });
  await expectGoneAfter(
    id,
    async () => {
      await A.engine.update(TASKS.name, id, { rotation_user_ids: null });
      await A.engine.sync();
    },
    'out of the rotation',
  );
  expect(await C.row(TASK_OCCURRENCES.name, occurrence)).toBeNull();
});

it('removes every task from the caregiver on a lapse, and brings them back with Premium', async () => {
  const id = await addVisible(task('Buy wipes', { shared: true }));
  await expectGoneAfter(id, () => setTier('free'), 'lapse');
  expect(await C.engine.store.liveIds(TASKS.name)).toEqual([]);
  await setTier('premium');
  await C.engine.checkVisibility();
  expect(await C.row(TASKS.name, id)).not.toBeNull();
});
