/**
 * @jest-environment node
 */
// Published busy days on several devices (B-01.4, D-22, R2-BUSY-2), against the real tables:
// a parent's private event that makes a day busy shows as busy on a caregiver's device within
// 60 seconds, without the event reaching that device, and two parents publishing the same
// window write one row a day with nothing refused.
import { createClient } from '@supabase/supabase-js';

import { DEFAULT_BUSY_RULE } from '@/features/calendar/busy';
import { publishBusyDays, publishWindow, type PublishSource } from '@/features/calendar/publish';
import { zonedInstant } from '@/features/calendar/repeat';
import {
  BUSY_DAYS,
  BUSY_TABLES,
  busyDayId,
  CALENDAR_TABLES,
  EVENTS,
} from '@/features/calendar/tables';
import { addDays, todayIn } from '@/features/planner/week';
import { SyncEngine } from '@/lib/sync/engine';
import { LocalStore } from '@/lib/sync/local-store';
import { createSupabaseRemote } from '@/lib/sync/remote';

import { createTestDatabase } from '../sqlite';

const env = (...names: string[]) => names.map((n) => process.env[n]).find(Boolean);
const URL = env('API_URL');
const ANON_KEY = env('ANON_KEY', 'PUBLISHABLE_KEY');
const SERVICE_KEY = env('SERVICE_ROLE_KEY', 'SECRET_KEY');

jest.setTimeout(90_000);

if (!URL || !ANON_KEY || !SERVICE_KEY) {
  throw new Error('Set API_URL, ANON_KEY and SERVICE_ROLE_KEY from `pnpm supabase status -o env`.');
}

const TZ = 'America/New_York';
const admin = createClient(URL, SERVICE_KEY, { auth: { persistSession: false } });
const password = crypto.randomUUID();
let householdId = '';
const engines: SyncEngine[] = [];

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitUntil(predicate: () => Promise<boolean>, timeoutMs: number) {
  const start = performance.now();
  while (performance.now() - start < timeoutMs) {
    if (await predicate()) return performance.now() - start;
    await sleep(50);
  }
  return null;
}

async function createDevice(email: string) {
  const client = createClient(URL!, ANON_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { error } = await client.auth.signInWithPassword({ email, password });
  if (error) throw error;
  const engine = new SyncEngine(
    new LocalStore(createTestDatabase(), [...CALENDAR_TABLES, ...BUSY_TABLES]),
    createSupabaseRemote(client),
    householdId,
  );
  await engine.open();
  engine.startRealtime();
  await engine.sync();
  await waitUntil(async () => engine.getStatus().realtime === 'connected', 10_000);
  engines.push(engine);
  return engine;
}

let A: SyncEngine;
let B: SyncEngine;
let C: SyncEngine;
let source: PublishSource;

beforeAll(async () => {
  const emails: string[] = [];
  const ids: string[] = [];
  for (const name of ['a', 'b', 'c']) {
    const { data, error } = await admin.auth.admin.createUser({
      email: `busy-${name}-${crypto.randomUUID()}@example.test`,
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
      name: 'Busy days harness',
      region: 'US',
      locale: 'en-US',
      unit_system: 'us_customary',
      timezone: TZ,
      week_start: 7,
    })
    .select()
    .single();
  if (error) throw error;
  householdId = household.id;
  // A caregiver seat needs Premium (FR-HH-1).
  const { error: tierError } = await admin
    .from('household_entitlements')
    .update({ tier: 'premium' })
    .eq('household_id', householdId);
  if (tierError) throw tierError;
  const { error: membersError } = await admin.from('household_members').insert(
    ids.map((user_id, i) => ({
      household_id: householdId,
      user_id,
      role: i < 2 ? 'parent' : 'caregiver',
    })),
  );
  if (membersError) throw membersError;

  source = {
    householdId,
    today: todayIn(TZ),
    timeZone: TZ,
    weekStart: 7,
    parentIds: new Set(ids.slice(0, 2)),
    rule: DEFAULT_BUSY_RULE,
  };
  A = await createDevice(emails[0]);
  B = await createDevice(emails[1]);
  C = await createDevice(emails[2]);
  await sleep(1500);
});

afterAll(() => {
  for (const engine of engines) engine.stop();
});

it("shows a parent's private busy day on a caregiver's device within 60 seconds, without the event", async () => {
  const date = addDays(source.today, 2);
  const at = (hour: number, minute: number) =>
    new Date(zonedInstant({ date, hour, minute, second: 0, ms: 0 }, TZ)).toISOString();
  const event = crypto.randomUUID();
  await A.insert(EVENTS.name, event, {
    kind: 'kind.appointment',
    title: 'Private appointment',
    all_day: false,
    starts_at: at(16, 30),
    ends_at: at(17, 30),
    start_date: null,
    end_date: null,
    place: null,
    notes: null,
    taking_user_id: null,
    shared: false,
    repeat: null,
    created_by: null,
    updated_by: null,
  });
  // The parent's device publishes, as BusyDayPublisher does after the change.
  expect(await publishBusyDays(A, source)).toBe(14);
  const start = performance.now();
  await A.sync();

  const id = busyDayId(householdId, date);
  const elapsed = await waitUntil(async () => {
    const row = await C.store.row(BUSY_DAYS.name, id);
    return row?.busy === true;
  }, 60_000);
  expect(elapsed).not.toBeNull();
  expect(performance.now() - start).toBeLessThan(60_000);
  expect(await C.store.row(BUSY_DAYS.name, id)).toMatchObject({
    date,
    busy: true,
    reason: 'dinner',
  });
  // The event never reaches the caregiver.
  await C.sync();
  await C.checkVisibility();
  expect(await C.store.row(EVENTS.name, event)).toBeNull();
  expect(await C.store.liveIds(EVENTS.name)).toEqual([]);
});

it('writes one row a day when both parents publish the same window, with nothing refused', async () => {
  await B.sync();
  // B has the event and A's rows now: its result agrees, so it writes nothing.
  expect(await publishBusyDays(B, source)).toBe(0);

  // Both parents publish a new window at once: the same IDs and values, so the second insert
  // of each day finds the row there (23505) and completes.
  const later = { ...source, today: addDays(source.today, 14) };
  await Promise.all([publishBusyDays(A, later), publishBusyDays(B, later)]);
  await Promise.all([A.sync(), B.sync()]);
  await Promise.all([A.sync(), B.sync()]);

  const { data, error } = await admin
    .from('busy_days')
    .select('date')
    .eq('household_id', householdId);
  expect(error).toBeNull();
  expect(data).toHaveLength(28);
  expect(new Set(data!.map((row) => row.date)).size).toBe(28);
  for (const engine of [A, B]) {
    expect(engine.getStatus()).toMatchObject({ pending: 0, rejected: 0 });
  }
  expect(publishWindow(later.today)).toHaveLength(14);
});

it('refuses a caregiver who tries to publish', async () => {
  const date = addDays(source.today, 3);
  await C.sync();
  await C.update(BUSY_DAYS.name, busyDayId(householdId, date), {
    date,
    busy: true,
    reason: 'marked',
  });
  await C.sync();
  expect(C.getStatus().rejected).toBe(1);
  const { data } = await admin
    .from('busy_days')
    .select('busy')
    .eq('id', busyDayId(householdId, date))
    .single();
  expect(data?.busy).toBe(false);
});
