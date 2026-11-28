/**
 * @jest-environment node
 */
// Tasks on two parents' devices, against the real tasks tables from the migrations (T-01.1,
// FR3-TASK-4, FR3-TASK-6, R3-TASK-1, R3-CHORE-2, NFR3-OFF-2):
// - both completing one task offline end with one completion, by whoever reached the server
//   first, and a stale reopen from a device that hadn't seen it doesn't undo it;
// - both completing the same chore occurrence offline write one row.
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
let B: Device;

beforeAll(async () => {
  const emails: string[] = [];
  for (const name of ['a', 'b']) {
    const { data, error } = await admin.auth.admin.createUser({
      email: `tasks-${name}-${crypto.randomUUID()}@example.test`,
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
      name: 'Tasks harness',
      region: 'US',
      locale: 'en-US',
      unit_system: 'us_customary',
      timezone: 'America/New_York',
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

  A = await createDevice(emails[0]);
  B = await createDevice(emails[1]);
  await sleep(1500);
});

afterAll(() => {
  A?.engine.stop();
  B?.engine.stop();
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

it("shows a partner's new task within 2 seconds (FR3-TASK-6)", async () => {
  const id = crypto.randomUUID();
  await A.engine.insert(
    TASKS.name,
    id,
    task('Book the car service', { assignee_user_id: userIds[1] }),
  );
  await A.engine.sync();
  const ms = await waitUntil(async () => (await B.row(TASKS.name, id)) !== null, 2_000);
  console.log(`a new task reached the partner in ${ms?.toFixed(0)} ms`);
  expect(ms).not.toBeNull();
});

it('ends with one completion when both complete a task offline (NFR3-OFF-2)', async () => {
  const id = crypto.randomUUID();
  await A.engine.insert(TASKS.name, id, task('Return the library books'));
  await A.engine.sync();
  await B.engine.sync();
  expect(await B.row(TASKS.name, id)).not.toBeNull();

  A.goOffline();
  B.goOffline();
  await A.engine.update(TASKS.name, id, { done: true });
  await B.engine.update(TASKS.name, id, { done: true });
  await A.goOnline();
  await B.goOnline();
  await A.engine.sync();

  const { data, error } = await admin.from('tasks').select('done, done_by').eq('id', id).single();
  expect(error).toBeNull();
  // The completion that reached the server first stands.
  expect(data).toEqual({ done: true, done_by: userIds[0] });
  for (const device of [A, B]) {
    expect(device.engine.getStatus()).toMatchObject({ pending: 0, rejected: 0 });
    expect(await device.row(TASKS.name, id)).toMatchObject({ done: true, done_by: userIds[0] });
  }
});

it("doesn't let a stale reopen undo a completion (R3-TASK-1)", async () => {
  const id = crypto.randomUUID();
  await A.engine.insert(TASKS.name, id, task('Renew the car seat base', { done: true }));
  await A.engine.sync();
  await B.engine.sync();
  expect((await B.row(TASKS.name, id))?.done).toBe(true);

  // B reopens offline; meanwhile A reopens and completes it again, so B's reopen is stale.
  B.goOffline();
  await B.engine.update(TASKS.name, id, { done: false });
  await A.engine.update(TASKS.name, id, { done: false });
  await A.engine.sync();
  await A.engine.update(TASKS.name, id, { done: true });
  await A.engine.sync();
  await B.goOnline();
  await A.engine.sync();

  const { data } = await admin.from('tasks').select('done').eq('id', id).single();
  expect(data?.done).toBe(true);
  for (const device of [A, B]) {
    expect(device.engine.getStatus()).toMatchObject({ pending: 0, rejected: 0 });
    expect((await device.row(TASKS.name, id))?.done).toBe(true);
  }
});

it('writes one occurrence when both complete the same chore occurrence offline (R3-CHORE-2)', async () => {
  const chore = crypto.randomUUID();
  await A.engine.insert(
    TASKS.name,
    chore,
    task('Take out the bins', {
      due_date: '2026-12-01',
      repeat: { freq: 'weekly', weekdays: [2] },
    }),
  );
  await A.engine.sync();
  await B.engine.sync();

  A.goOffline();
  B.goOffline();
  const id = occurrenceId(chore, '2026-12-08');
  const occurrence = {
    task_id: chore,
    original_date: '2026-12-08',
    assignee_user_id: null,
    skipped: false,
    done: true,
    done_at: null,
    done_by: null,
  };
  await A.engine.insert(TASK_OCCURRENCES.name, id, occurrence);
  await B.engine.insert(TASK_OCCURRENCES.name, id, occurrence);
  await B.goOnline();
  await A.goOnline();
  await B.engine.sync();

  const { data, error } = await admin
    .from('task_occurrences')
    .select('id, done, done_by')
    .eq('task_id', chore);
  expect(error).toBeNull();
  expect(data).toEqual([{ id, done: true, done_by: userIds[1] }]);
  for (const device of [A, B]) {
    expect(device.engine.getStatus()).toMatchObject({ pending: 0, rejected: 0 });
    expect((await device.row(TASK_OCCURRENCES.name, id))?.done).toBe(true);
  }
});

it("shows the partner's assignment and completion within 2 seconds (FR3-TASK-4, FR3-TASK-5)", async () => {
  const id = crypto.randomUUID();
  await A.engine.insert(TASKS.name, id, task('Order the car seat'));
  await A.engine.sync();
  expect(await waitUntil(async () => (await B.row(TASKS.name, id)) !== null, 2_000)).not.toBeNull();

  // A assigns it to B from the chip; B sees it as theirs.
  await A.engine.update(TASKS.name, id, { assignee_user_id: userIds[1] });
  await A.engine.sync();
  const assigned = await waitUntil(
    async () => (await B.row(TASKS.name, id))?.assignee_user_id === userIds[1],
    2_000,
  );
  console.log(`an assignment reached the partner in ${assigned?.toFixed(0)} ms`);
  expect(assigned).not.toBeNull();

  // B completes it; A sees it done, by B.
  await B.engine.update(TASKS.name, id, { done: true });
  await B.engine.sync();
  const done = await waitUntil(async () => (await A.row(TASKS.name, id))?.done === true, 2_000);
  console.log(`a completion reached the partner in ${done?.toFixed(0)} ms`);
  expect(done).not.toBeNull();
  expect(await A.row(TASKS.name, id)).toMatchObject({ done: true, done_by: userIds[1] });
});
