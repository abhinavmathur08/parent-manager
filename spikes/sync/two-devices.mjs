// H-06.1 spike: two "devices" sync a household list through Legend-State's Supabase plugin,
// go offline, edit, reconnect, and must end up following architecture section 5.
//
// Runs in Node against a local Supabase stack (see .github/workflows/sync-spike.yml).
// Each device has its own Supabase client, its own Legend-State observable and its own
// persisted state. "Offline" makes the device's fetch fail the way React Native's does
// (TypeError: Network request failed) and disconnects its Realtime socket.
//
// Usage: node spikes/sync/two-devices.mjs [stock|fixed]
//   stock: the plugin's default create and update
//   fixed: create and update that throw on network errors, so the plugin retries them
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

// Map-backed localStorage so the plugin's persistence (and its pending-changes queue)
// works in Node. Must exist before the persist plugin loads.
const storage = new Map();
globalThis.localStorage = {
  getItem: (k) => (storage.has(k) ? storage.get(k) : null),
  setItem: (k, v) => storage.set(k, String(v)),
  removeItem: (k) => storage.delete(k),
  clear: () => storage.clear(),
  key: (i) => [...storage.keys()][i] ?? null,
  get length() {
    return storage.size;
  },
};

const { createClient } = await import('@supabase/supabase-js');
const { observable, syncState } = await import('@legendapp/state');
const { syncedSupabase } = await import('@legendapp/state/sync-plugins/supabase');
const { ObservablePersistLocalStorage } =
  await import('@legendapp/state/persist-plugins/local-storage');

const MODE = process.argv[2] ?? 'fixed';
const URL = process.env.API_URL;
const ANON_KEY = process.env.ANON_KEY ?? process.env.PUBLISHABLE_KEY;
const SERVICE_KEY = process.env.SERVICE_ROLE_KEY ?? process.env.SECRET_KEY;
assert.ok(URL && ANON_KEY && SERVICE_KEY, 'API_URL, ANON_KEY and SERVICE_ROLE_KEY must be set');

const results = [];
function record(name, pass, detail = '') {
  results.push({ name, pass, detail });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitUntil(predicate, timeoutMs = 10000, everyMs = 20) {
  const start = performance.now();
  while (performance.now() - start < timeoutMs) {
    if (await predicate()) return performance.now() - start;
    await sleep(everyMs);
  }
  return null;
}

// ---------------------------------------------------------------------------
// Fixture: two users in one household, created with the service role.
// ---------------------------------------------------------------------------
const admin = createClient(URL, SERVICE_KEY, { auth: { persistSession: false } });
const password = randomUUID();
const users = {};
for (const name of ['a', 'b']) {
  const { data, error } = await admin.auth.admin.createUser({
    email: `spike-${name}-${randomUUID()}@example.test`,
    password,
    email_confirm: true,
  });
  if (error) throw error;
  users[name] = data.user;
}

const { data: household, error: householdError } = await admin
  .from('households')
  .insert({
    name: 'Spike',
    region: 'US',
    locale: 'en-US',
    unit_system: 'us_customary',
    timezone: 'UTC',
    week_start: 7,
  })
  .select()
  .single();
if (householdError) throw householdError;
const householdId = household.id;
{
  const { error } = await admin.from('household_members').insert([
    { household_id: householdId, user_id: users.a.id, role: 'parent' },
    { household_id: householdId, user_id: users.b.id, role: 'parent' },
  ]);
  if (error) throw error;
}

// ---------------------------------------------------------------------------
// A device: its own client, network switch and synced observable.
// ---------------------------------------------------------------------------
async function createDevice(name, user) {
  const net = { online: true };
  const client = createClient(URL, ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: {
      fetch: (...args) =>
        net.online ? fetch(...args) : Promise.reject(new TypeError('Network request failed')),
    },
  });
  const { error } = await client.auth.signInWithPassword({ email: user.email, password });
  if (error) throw error;

  // Return { data, error } as the plugin expects, but throw on any error so that the
  // plugin's retry (which only runs when the action rejects) kicks in.
  const throwing = (run) => async (input) => {
    const { data, error: e } = await run(input);
    if (e) throw new Error(e.message);
    return { data: data[0], error: null };
  };
  const fixedActions =
    MODE === 'fixed'
      ? {
          create: throwing((input) => client.from('spike_items').insert(input).select()),
          update: throwing((input) =>
            client.from('spike_items').update(input).eq('id', input.id).select(),
          ),
        }
      : {};

  const makeObservable = () =>
    observable(
      syncedSupabase({
        supabase: client,
        collection: 'spike_items',
        filter: (select) => select.eq('household_id', householdId),
        realtime: { filter: `household_id=eq.${householdId}` },
        actions: ['read', 'create', 'update'],
        changesSince: 'last-sync',
        fieldCreatedAt: 'created_at',
        fieldUpdatedAt: 'updated_at',
        fieldDeleted: 'deleted',
        persist: { plugin: ObservablePersistLocalStorage, name: `${name}_items`, retrySync: true },
        retry: { infinite: true, backoff: 'exponential', delay: 250, maxDelay: 1000 },
        ...fixedActions,
      }),
    );

  const device = {
    name,
    client,
    items$: makeObservable(),
    item: (id) => device.items$[id].peek(),
    async ready() {
      device.items$.get(); // start syncing
      await waitUntil(() => syncState(device.items$).isLoaded.get(), 10000);
    },
    async goOffline() {
      net.online = false;
      client.realtime.disconnect();
    },
    async goOnline() {
      net.online = true;
      client.realtime.connect();
      // What the app would do on regaining connectivity: pull anything missed while away.
      await syncState(device.items$).sync();
    },
    // Simulates killing the app: drop the observable and rebuild it from persisted state.
    async restart() {
      device.items$ = makeObservable();
      await device.ready();
    },
  };
  await device.ready();
  return device;
}

async function serverRow(id) {
  const { data } = await admin.from('spike_items').select().eq('id', id).single();
  return data;
}

async function seed(rows) {
  const { error } = await admin
    .from('spike_items')
    .insert(rows.map((r) => ({ household_id: householdId, ...r })));
  if (error) throw error;
}

const A = await createDevice('a', users.a);
const B = await createDevice('b', users.b);

// Lets Realtime subscriptions finish joining before measuring.
await sleep(1500);

// ---------------------------------------------------------------------------
// S0. Online: a change on one device reaches the other within 2 seconds.
// ---------------------------------------------------------------------------
{
  const id = randomUUID();
  A.items$[id].set({ id, household_id: householdId, name: 'milk', checked: false });
  const createdMs = await waitUntil(() => B.item(id)?.name === 'milk', 10000, 5);
  record(
    'online create reaches the other device',
    createdMs !== null,
    `${createdMs?.toFixed(0)} ms`,
  );

  const timings = [];
  for (let i = 0; i < 20; i++) {
    const value = `milk ${i}`;
    A.items$[id].name.set(value);
    const ms = await waitUntil(() => B.item(id)?.name === value, 10000, 5);
    timings.push(ms ?? Infinity);
    await sleep(100);
  }
  timings.sort((x, y) => x - y);
  const p50 = timings[Math.floor(timings.length * 0.5)];
  const p95 = timings[Math.floor(timings.length * 0.95)];
  record(
    'online edits reach the other device within 2 s (p95)',
    p95 < 2000,
    `p50 ${p50.toFixed(0)} ms, p95 ${p95.toFixed(0)} ms, n=20`,
  );
}

// ---------------------------------------------------------------------------
// Offline scenarios. Seed rows both devices see, then take both offline.
// ---------------------------------------------------------------------------
const ids = Object.fromEntries(
  ['different1', 'different2', 'same', 'bothCheck', 'staleUncheck', 'deleted'].map((k) => [
    k,
    randomUUID(),
  ]),
);
await seed([
  { id: ids.different1, name: 'eggs' },
  { id: ids.different2, name: 'bread' },
  { id: ids.same, name: 'apples' },
  { id: ids.bothCheck, name: 'butter' },
  { id: ids.staleUncheck, name: 'rice', checked: true },
  { id: ids.deleted, name: 'yoghurt' },
]);
const allSeen = (d) => Object.values(ids).every((id) => d.item(id));
record(
  'seeded rows reach both devices',
  (await waitUntil(() => allSeen(A) && allSeen(B), 10000)) !== null,
);

await A.goOffline();
await B.goOffline();

const newOnA = randomUUID();
const newOnB = randomUUID();

// S1. Different rows edited on each device.
A.items$[ids.different1].name.set('eggs (A)');
B.items$[ids.different2].name.set('bread (B)');
// S2. Same row, same field: last write to reach the server wins, on both devices.
A.items$[ids.same].name.set('apples (A)');
B.items$[ids.same].name.set('apples (B)');
// S3. Both tick the same item.
A.items$[ids.bothCheck].checked.set(true);
B.items$[ids.bothCheck].checked.set(true);
// S5. Both create rows offline with client-generated IDs.
A.items$[newOnA].set({ id: newOnA, household_id: householdId, name: 'pasta (A)', checked: false });
B.items$[newOnB].set({ id: newOnB, household_id: householdId, name: 'tea (B)', checked: false });
// S4. A deletes a row that B edits offline.
A.items$[ids.deleted].delete();
B.items$[ids.deleted].name.set('yoghurt (B edit after A deleted)');
// S6. B unchecks "rice" offline, from the checked state it saw (version 1).
B.items$[ids.staleUncheck].checked.set(false);

// S7. A is killed and restarted while still offline: its queued edits must survive.
await A.restart();
record(
  'queued offline edits survive a restart (A)',
  A.item(ids.different1)?.name === 'eggs (A)' && A.item(newOnA)?.name === 'pasta (A)',
);

// A comes back first. While B is still offline, A unchecks and re-checks "rice", so the
// newest server state is "checked" at a later version than the one B saw.
await A.goOnline();
await waitUntil(async () => (await serverRow(newOnA)) !== null, 15000);
A.items$[ids.staleUncheck].checked.set(false);
await waitUntil(async () => (await serverRow(ids.staleUncheck))?.checked === false, 10000);
A.items$[ids.staleUncheck].checked.set(true);
await waitUntil(async () => (await serverRow(ids.staleUncheck))?.checked === true, 10000);

await B.goOnline();

// Let both queues drain and both devices pull the result.
await waitUntil(async () => (await serverRow(newOnB)) !== null, 20000);
await sleep(3000);
await A.goOnline();
await B.goOnline();
await sleep(1000);

// ---------------------------------------------------------------------------
// Results
// ---------------------------------------------------------------------------
const server = {};
for (const [k, id] of Object.entries({ ...ids, newOnA, newOnB })) server[k] = await serverRow(id);

const both = (id, fn) => fn(A.item(id)) && fn(B.item(id));

record(
  'S1 edits to different rows both survive',
  server.different1?.name === 'eggs (A)' &&
    server.different2?.name === 'bread (B)' &&
    both(ids.different1, (r) => r?.name === 'eggs (A)') &&
    both(ids.different2, (r) => r?.name === 'bread (B)'),
  `server: ${server.different1?.name} / ${server.different2?.name}`,
);
record(
  'S2 same-field conflict converges on both devices (last write wins)',
  both(ids.same, (r) => r?.name === server.same?.name),
  `server "${server.same?.name}", A "${A.item(ids.same)?.name}", B "${B.item(ids.same)?.name}"`,
);
record(
  'S3 both ticking an item leaves it ticked',
  server.bothCheck?.checked === true && both(ids.bothCheck, (r) => r?.checked === true),
);
record(
  'S4 a deleted row does not come back',
  server.deleted?.deleted === true && both(ids.deleted, (r) => !r || r.deleted),
  `server deleted=${server.deleted?.deleted}, name "${server.deleted?.name}", A has=${!!A.item(ids.deleted)}, B has=${!!B.item(ids.deleted)}`,
);
record(
  'S5 rows created offline on both devices reach both',
  !!server.newOnA &&
    !!server.newOnB &&
    both(newOnA, (r) => r?.name === 'pasta (A)') &&
    both(newOnB, (r) => r?.name === 'tea (B)'),
);
record(
  'S6 a stale uncheck does not override a newer check',
  server.staleUncheck?.checked === true && both(ids.staleUncheck, (r) => r?.checked === true),
  `server checked=${server.staleUncheck?.checked} v${server.staleUncheck?.version}`,
);
record(
  'devices converge on every row',
  Object.values({ ...ids, newOnA, newOnB }).every(
    (id) =>
      (!A.item(id) && !B.item(id)) ||
      (A.item(id)?.name === B.item(id)?.name && A.item(id)?.checked === B.item(id)?.checked),
  ),
);

// S8. After reconnecting, Realtime still delivers within 2 seconds.
{
  const value = 'after reconnect';
  B.items$[ids.different2].name.set(value);
  const ms = await waitUntil(() => A.item(ids.different2)?.name === value, 10000, 5);
  record(
    'S8 realtime works again after reconnecting',
    ms !== null && ms < 2000,
    `${ms?.toFixed(0)} ms`,
  );
}

const failed = results.filter((r) => !r.pass);
console.log(`\nMode: ${MODE}. ${results.length - failed.length}/${results.length} passed.`);
await A.client.removeAllChannels();
await B.client.removeAllChannels();
process.exit(failed.length ? 1 : 0);
