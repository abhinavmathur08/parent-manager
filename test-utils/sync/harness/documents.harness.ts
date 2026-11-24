/**
 * @jest-environment node
 */
// The document vault on two devices, against the real tables from the migrations (V-02.1,
// R2-ACC-1, R2-ACC-2, NFR2-OFF-2): a document shared with a caregiver reaches their device with
// its attachment, and unsharing it removes both within 60 seconds of reconnecting, while the
// shared event stays.
import { createClient } from '@supabase/supabase-js';

import { CALENDAR_TABLES } from '@/features/calendar/tables';
import {
  DOCUMENT_SHARES,
  DOCUMENT_TABLES,
  DOCUMENTS,
  EVENT_DOCUMENTS,
} from '@/features/documents/tables';
import { applyShareChanges } from '@/features/documents/shares';
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
    new LocalStore(createTestDatabase(), [...CALENDAR_TABLES, ...DOCUMENT_TABLES]),
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
/** A caregiver, who sees only documents shared with them while the household has Premium (D-16). */
let C: Device;
let caregiverId = '';

beforeAll(async () => {
  const emails: string[] = [];
  const ids: string[] = [];
  for (const name of ['a', 'c']) {
    const { data, error } = await admin.auth.admin.createUser({
      email: `documents-${name}-${crypto.randomUUID()}@example.test`,
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
      name: 'Documents harness',
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
  // A caregiver seat and sharing need Premium (FR-HH-1, V4).
  const { error: tierError } = await admin
    .from('household_entitlements')
    .update({ tier: 'premium' })
    .eq('household_id', householdId);
  if (tierError) throw tierError;
  caregiverId = ids[1];
  const { error: membersError } = await admin.from('household_members').insert([
    { household_id: householdId, user_id: ids[0], role: 'parent' },
    { household_id: householdId, user_id: caregiverId, role: 'caregiver' },
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

it('removes an unshared document and its attachment from a caregiver (R2-ACC-1, R2-ACC-2)', async () => {
  // The documents function (V-02.2) creates documents with the service role.
  const documentId = crypto.randomUUID();
  const { error } = await admin.from('documents').insert({
    id: documentId,
    household_id: householdId,
    title: 'Insurance card',
    category: 'doc.insurance',
    mime: 'image/jpeg',
    page_count: 1,
    size_bytes: 1000,
    status: 'ready',
  });
  expect(error).toBeNull();

  const eventId = crypto.randomUUID();
  await A.engine.insert('events', eventId, {
    kind: 'kind.appointment',
    title: 'Pediatrician',
    all_day: false,
    starts_at: '2026-12-02T14:00:00.000Z',
    ends_at: '2026-12-02T15:00:00.000Z',
    start_date: null,
    end_date: null,
    place: null,
    notes: null,
    taking_user_id: null,
    shared: true,
    repeat: null,
    created_by: null,
    updated_by: null,
  });
  const attachmentId = crypto.randomUUID();
  await A.engine.insert(EVENT_DOCUMENTS.name, attachmentId, {
    event_id: eventId,
    document_id: documentId,
  });
  await A.engine.sync();

  // Attached but not shared: the caregiver sees the event only.
  await C.engine.sync();
  await C.engine.checkVisibility();
  expect(await C.row('events', eventId)).not.toBeNull();
  expect(await C.row(DOCUMENTS.name, documentId)).toBeNull();
  expect(await C.row(EVENT_DOCUMENTS.name, attachmentId)).toBeNull();

  // Shared: the document and its attachment arrive.
  const shareId = crypto.randomUUID();
  await A.engine.insert(DOCUMENT_SHARES.name, shareId, {
    document_id: documentId,
    user_id: caregiverId,
    shared_by: null,
  });
  await A.engine.sync();
  expect(A.engine.getStatus()).toMatchObject({ pending: 0, rejected: 0 });
  await C.engine.sync();
  await C.engine.checkVisibility();
  expect(await C.row(DOCUMENTS.name, documentId)).not.toBeNull();
  expect(await C.row(EVENT_DOCUMENTS.name, attachmentId)).not.toBeNull();

  // Unshared while the caregiver is offline.
  C.goOffline();
  await A.engine.remove(DOCUMENT_SHARES.name, shareId);
  await A.engine.sync();

  const reconnected = performance.now();
  await C.goOnline();
  const ms = await waitUntil(
    async () => (await C.row(DOCUMENTS.name, documentId)) === null,
    60_000,
  );
  console.log(
    `unshared document left the caregiver's device ${ms?.toFixed(0)} ms after reconnecting`,
  );
  expect(ms).not.toBeNull();
  expect(performance.now() - reconnected).toBeLessThan(60_000);
  expect(await C.row(EVENT_DOCUMENTS.name, attachmentId)).toBeNull();
  expect(await C.row('events', eventId)).not.toBeNull();
  // The parent keeps it.
  expect(await A.row(DOCUMENTS.name, documentId)).not.toBeNull();
});

it("shares and unshares through the app's writes, dropping the document from the caregiver's copy (FR2-DOC-6)", async () => {
  const documentId = crypto.randomUUID();
  const { error } = await admin.from('documents').insert({
    id: documentId,
    household_id: householdId,
    title: 'School form',
    category: 'doc.childcare_school',
    mime: 'application/pdf',
    page_count: 1,
    size_bytes: 1000,
    status: 'ready',
  });
  expect(error).toBeNull();
  await A.engine.sync();

  const shares = async () =>
    (await A.engine.store.rows(DOCUMENT_SHARES.name)) as unknown as Parameters<
      typeof applyShareChanges
    >[2];
  const newId = () => crypto.randomUUID();

  // The parent ticks the caregiver on S-42.
  expect(
    await applyShareChanges(
      A.engine,
      documentId,
      await shares(),
      new Map([[caregiverId, true]]),
      newId,
    ),
  ).toEqual({ shared: 1, unshared: 0 });
  await A.engine.sync();
  expect(A.engine.getStatus()).toMatchObject({ pending: 0, rejected: 0 });
  await C.engine.sync();
  await C.engine.checkVisibility();
  expect(await C.row(DOCUMENTS.name, documentId)).not.toBeNull();

  // And unticks them: gone from the caregiver's device on its next sync.
  expect(
    await applyShareChanges(
      A.engine,
      documentId,
      await shares(),
      new Map([[caregiverId, false]]),
      newId,
    ),
  ).toEqual({ shared: 0, unshared: 1 });
  await A.engine.sync();
  await C.engine.sync();
  await C.engine.checkVisibility();
  expect(await C.row(DOCUMENTS.name, documentId)).toBeNull();
  expect(await A.row(DOCUMENTS.name, documentId)).not.toBeNull();
});
