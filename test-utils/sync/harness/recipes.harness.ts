/**
 * @jest-environment node
 */
// Recipes on two devices (R-02.1 acceptance, FR-REC-12): a recipe, its lines and steps sync
// between partners, and an edit made offline appears on the partner's device after both
// reconnect. Runs against the real recipe tables from the migrations, through the engine.
import { createClient } from '@supabase/supabase-js';

import {
  RECIPE_INGREDIENTS,
  RECIPE_STEPS,
  RECIPE_TABLES,
  RECIPES,
} from '@/features/recipes/tables';
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
  net: { online: boolean };
  row(table: string, id: string): Promise<SyncRow | null>;
  goOffline(): void;
  goOnline(): Promise<void>;
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitFor(predicate: () => Promise<boolean>, timeoutMs = 10_000) {
  const start = performance.now();
  while (performance.now() - start < timeoutMs) {
    if (await predicate()) return;
    await sleep(10);
  }
  throw new Error('Timed out');
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
    new LocalStore(createTestDatabase(), [...RECIPE_TABLES]),
    createSupabaseRemote(client),
    householdId,
  );
  await engine.open();
  const device: Device = {
    engine,
    net,
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
      await waitFor(async () => engine.getStatus().realtime === 'connected');
    },
  };
  await device.goOnline();
  return device;
}

let A: Device;
let B: Device;
const recipeId = crypto.randomUUID();
const milkLine = crypto.randomUUID();
const onionLine = crypto.randomUUID();
const firstStep = crypto.randomUUID();
const stepOnB = crypto.randomUUID();

beforeAll(async () => {
  const emails: string[] = [];
  const ids: string[] = [];
  for (const name of ['a', 'b']) {
    const { data, error } = await admin.auth.admin.createUser({
      email: `recipes-${name}-${crypto.randomUUID()}@example.test`,
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
      name: 'Recipe harness',
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

  A = await createDevice(emails[0]);
  B = await createDevice(emails[1]);
  await sleep(1500);
});

afterAll(() => {
  A?.engine.stop();
  B?.engine.stop();
});

it('delivers a new recipe with its lines and steps to the partner', async () => {
  await A.engine.insert(RECIPES.name, recipeId, {
    title: 'Overnight oats',
    servings: 2,
    tags: ['tag.no_cook'],
    source_type: 'manual',
    content_locale: 'en-US',
  });
  await A.engine.insert(RECIPE_INGREDIENTS.name, milkLine, {
    recipe_id: recipeId,
    position: 0,
    ingredient_id: 'ingredient.milk',
    quantity: 1,
    unit_id: 'unit.cup_us',
    optional: false,
  });
  await A.engine.insert(RECIPE_INGREDIENTS.name, onionLine, {
    recipe_id: recipeId,
    position: 1,
    ingredient_id: 'ingredient.onion',
    quantity: 2,
    unit_id: null,
    optional: false,
  });
  await A.engine.insert(RECIPE_STEPS.name, firstStep, {
    recipe_id: recipeId,
    position: 0,
    text: 'Stir.',
  });
  await A.engine.sync();
  // Delivery speed is the two-device harness's job (S0); here B pulls, as it does on start
  // and on reconnecting, so the check doesn't depend on Realtime timing.
  await B.engine.sync();

  await waitFor(async () => (await B.row(RECIPE_STEPS.name, firstStep)) !== null);
  expect((await B.row(RECIPES.name, recipeId))?.tags).toEqual(['tag.no_cook']);
  // The server worked out the base quantities (R-ING-3).
  expect((await B.row(RECIPE_INGREDIENTS.name, milkLine))?.quantity_base).toBeCloseTo(236.588, 3);
  expect((await B.row(RECIPE_INGREDIENTS.name, onionLine))?.quantity_base).toBe(2);
});

it('shows edits made offline on the partner after both reconnect (FR-REC-12)', async () => {
  A.goOffline();
  B.goOffline();

  await A.engine.update(RECIPES.name, recipeId, { title: 'Overnight oats with berries' });
  await A.engine.update(RECIPE_INGREDIENTS.name, milkLine, { quantity: 1.5 });
  await B.engine.insert(RECIPE_STEPS.name, stepOnB, {
    recipe_id: recipeId,
    position: 1,
    text: 'Chill overnight.',
  });
  await B.engine.update(RECIPE_INGREDIENTS.name, onionLine, { note: 'finely chopped' });

  await A.goOnline();
  await B.goOnline();
  await A.engine.sync();

  for (const device of [A, B]) {
    expect(device.engine.getStatus()).toMatchObject({ pending: 0, rejected: 0 });
    expect((await device.row(RECIPES.name, recipeId))?.title).toBe('Overnight oats with berries');
    expect((await device.row(RECIPE_INGREDIENTS.name, milkLine))?.quantity_base).toBeCloseTo(
      354.882,
      3,
    );
    expect((await device.row(RECIPE_INGREDIENTS.name, onionLine))?.note).toBe('finely chopped');
    expect((await device.row(RECIPE_STEPS.name, stepOnB))?.text).toBe('Chill overnight.');
  }
});

it('deletes the lines and steps with the recipe on both devices', async () => {
  await A.engine.remove(RECIPES.name, recipeId);
  await A.engine.sync();
  // The server tombstones the lines and steps; both devices pull them.
  await A.engine.sync();
  await B.engine.sync();
  await waitFor(async () => (await B.row(RECIPE_STEPS.name, stepOnB)) === null);
  for (const device of [A, B]) {
    expect(await device.row(RECIPES.name, recipeId)).toBeNull();
    expect(await device.row(RECIPE_INGREDIENTS.name, milkLine)).toBeNull();
    expect(await device.row(RECIPE_STEPS.name, firstStep)).toBeNull();
  }
});
