/**
 * @jest-environment node
 */
// The calendar on two devices (C-01.2 acceptance, FR2-CAL-4, R2-CAL-2): two parents changing
// the same occurrence of a repeating event offline write one exception row, and both devices
// end up with the same one. Runs against the real calendar tables from the migrations.
import { createClient } from '@supabase/supabase-js';

import { CALENDAR_TABLES, EVENT_EXCEPTIONS, EVENTS, exceptionId } from '@/features/calendar/tables';
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
    new LocalStore(createTestDatabase(), [...CALENDAR_TABLES]),
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
      email: `calendar-${name}-${crypto.randomUUID()}@example.test`,
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
      name: 'Calendar harness',
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
    .insert(ids.map((user_id) => ({ household_id: householdId, user_id, role: 'parent' })));
  if (membersError) throw membersError;

  A = await createDevice(emails[0]);
  B = await createDevice(emails[1]);
  await sleep(1500);
});

afterAll(() => {
  A?.engine.stop();
  B?.engine.stop();
});

it('writes one exception when two parents change the same occurrence offline (R2-CAL-2)', async () => {
  // A weekly Monday daycare pickup at 17:00 New York time.
  const event = crypto.randomUUID();
  await A.engine.insert(EVENTS.name, event, {
    kind: 'kind.childcare',
    title: 'Daycare pickup',
    all_day: false,
    starts_at: '2026-11-30T22:00:00.000Z',
    ends_at: '2026-11-30T22:30:00.000Z',
    start_date: null,
    end_date: null,
    place: null,
    notes: null,
    taking_user_id: null,
    shared: false,
    repeat: { freq: 'weekly', weekdays: [1] },
    created_by: null,
    updated_by: null,
  });
  await A.engine.sync();
  await B.engine.sync();
  expect(await B.row(EVENTS.name, event)).not.toBeNull();

  // Both go offline. A moves next Monday's pickup to 17:30; B skips it.
  A.goOffline();
  B.goOffline();
  const occurrence = exceptionId(event, '2026-12-07');
  const exception = (status: string, startsAt: string | null, endsAt: string | null) => ({
    event_id: event,
    original_date: '2026-12-07',
    status,
    starts_at: startsAt,
    ends_at: endsAt,
    start_date: null,
    end_date: null,
    taking_user_id: null,
  });
  await A.engine.insert(
    EVENT_EXCEPTIONS.name,
    occurrence,
    exception('moved', '2026-12-07T22:30:00.000Z', '2026-12-07T23:00:00.000Z'),
  );
  await B.engine.insert(EVENT_EXCEPTIONS.name, occurrence, exception('skipped', null, null));
  await A.goOnline();
  await B.goOnline();
  await A.engine.sync();

  const { data, error } = await admin
    .from('event_exceptions')
    .select('id, status')
    .eq('event_id', event);
  expect(error).toBeNull();
  expect(data).toEqual([{ id: occurrence, status: 'moved' }]);
  for (const device of [A, B]) {
    expect(device.engine.getStatus()).toMatchObject({ pending: 0, rejected: 0 });
    expect((await device.row(EVENT_EXCEPTIONS.name, occurrence))?.status).toBe('moved');
  }
});
