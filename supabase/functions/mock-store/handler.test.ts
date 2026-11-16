import { assertEquals } from 'jsr:@std/assert@1';

import type { SubscriptionEvent } from '../_shared/billing/events.ts';
import { createHandler, WEBHOOK_HOLD_MS } from './handler.ts';
import { LiveSubscriptionExists, type Stored, type StoreRepo } from './repo.ts';

const H = '00000000-0000-0000-0000-00000000000a';
const PARENT = 'aaaaaaaa-0000-0000-0000-000000000001';
const PARENT_2 = 'aaaaaaaa-0000-0000-0000-000000000002';
const CAREGIVER = 'aaaaaaaa-0000-0000-0000-000000000003';

/** An in-memory store and an event sink that keeps the tier, like the database does. */
function world() {
  const rows = new Map<string, Stored>();
  const applied: SubscriptionEvent[] = [];
  const seen = new Set<string>();
  let tier: 'free' | 'premium' = 'free';
  let now = new Date('2026-11-15T12:00:00Z');
  let id = 0;
  const repo: StoreRepo = {
    forUser: (u) => Promise.resolve(rows.get(u) ?? null),
    forHousehold: (h) =>
      Promise.resolve([...rows.values()].find((r) => r.subscription.householdId === h) ?? null),
    save: (stored) => {
      const clash = [...rows.values()].some(
        (r) =>
          r.subscription.appUserId !== stored.subscription.appUserId &&
          r.subscription.householdId === stored.subscription.householdId &&
          !r.subscription.endedAt &&
          !stored.subscription.endedAt,
      );
      if (clash) return Promise.reject(new LiveSubscriptionExists());
      rows.set(stored.subscription.appUserId, structuredClone(stored));
      return Promise.resolve();
    },
    isParent: (u) => Promise.resolve(u === PARENT || u === PARENT_2),
    tier: () => Promise.resolve(tier),
  };
  const sink = {
    apply(event: SubscriptionEvent) {
      if (seen.has(event.id)) return Promise.resolve('duplicate' as const);
      seen.add(event.id);
      applied.push(event);
      if (['INITIAL_PURCHASE', 'RENEWAL'].includes(event.type)) tier = 'premium';
      if (event.type === 'EXPIRATION' || event.cancel_reason === 'CUSTOMER_SUPPORT') tier = 'free';
      return Promise.resolve('applied' as const);
    },
  };
  return {
    applied,
    tier: () => tier,
    tick: (ms: number) => (now = new Date(now.getTime() + ms)),
    handler: (enabled = true) =>
      createHandler({
        enabled,
        repo,
        sink,
        authenticate: (token) => Promise.resolve(token),
        now: () => now,
        newId: () => `evt-${++id}`,
        log: () => {},
      }),
  };
}

function post(user: string | null, body: unknown) {
  return new Request('http://x/mock-store', {
    method: 'POST',
    headers: user ? { Authorization: `Bearer ${user}` } : {},
    body: JSON.stringify(body),
  });
}

const buy = (extra: Record<string, unknown> = {}) => ({
  action: 'purchase',
  productId: 'pm_premium_monthly',
  householdId: H,
  ...extra,
});

Deno.test('is off unless BILLING_MOCK_ENABLED, before anything else', async () => {
  const w = world();
  const res = await w.handler(false)(post(PARENT, buy()));
  assertEquals(res.status, 404);
  assertEquals((await res.json()).error.code, 'billing.mock_disabled');
  assertEquals(w.applied.length, 0);
  assertEquals((await w.handler(false)(post(null, { action: 'status' }))).status, 404);
});

Deno.test('needs a session', async () => {
  assertEquals((await world().handler()(post(null, { action: 'status' }))).status, 401);
});

Deno.test('a parent starts a trial, applied as a mock event', async () => {
  const w = world();
  const res = await w.handler()(post(PARENT, buy()));
  assertEquals(res.status, 200);
  const { subscription } = await res.json();
  assertEquals(subscription.periodType, 'TRIAL');
  assertEquals(subscription.isActive, true);
  assertEquals(
    w.applied.map((e) => [e.type, e.source, e.household_id]),
    [['INITIAL_PURCHASE', 'mock', H]],
  );
  assertEquals(w.tier(), 'premium');
});

Deno.test('only parents can buy (FR-PAY-4)', async () => {
  const res = await world().handler()(post(CAREGIVER, buy()));
  assertEquals(res.status, 403);
  assertEquals((await res.json()).error.code, 'billing.not_a_parent');
});

Deno.test('a second parent cannot buy while the household is Premium', async () => {
  const w = world();
  await w.handler()(post(PARENT, buy()));
  const res = await w.handler()(post(PARENT_2, buy()));
  assertEquals(res.status, 409);
  assertEquals((await res.json()).error.code, 'billing.already_premium');
  assertEquals(w.applied.length, 1);
});

Deno.test('a delayed webhook holds the event until restore', async () => {
  const w = world();
  await w.handler()(post(PARENT, buy({ delayWebhook: true })));
  assertEquals(w.tier(), 'free');
  const res = await w.handler()(post(PARENT, { action: 'restore' }));
  assertEquals((await res.json()).subscription.isActive, true);
  assertEquals(w.tier(), 'premium');
  // Restoring again replays the latest event, which changes nothing.
  await w.handler()(post(PARENT, { action: 'restore' }));
  assertEquals(w.applied.length, 1);
});

Deno.test('a held event goes out by itself after the hold', async () => {
  const w = world();
  await w.handler()(post(PARENT, buy({ delayWebhook: true })));
  w.tick(WEBHOOK_HOLD_MS + 1);
  await w.handler()(post(PARENT, { action: 'subscription' }));
  assertEquals(w.tier(), 'premium');
});

Deno.test('restore with no purchase finds nothing', async () => {
  const res = await world().handler()(post(PARENT_2, { action: 'restore' }));
  assertEquals(await res.json(), { subscription: null });
});

Deno.test('the test clock runs the whole lifecycle to a lapse', async () => {
  const w = world();
  const h = w.handler();
  await h(post(PARENT, buy()));
  await h(post(PARENT, { action: 'advance', householdId: H, to: 'trial_end' }));
  await h(post(PARENT, { action: 'advance', householdId: H, to: 'billing_issue' }));
  assertEquals(w.tier(), 'premium');
  const res = await h(post(PARENT_2, { action: 'advance', householdId: H, to: 'grace_end' }));
  assertEquals((await res.json()).subscription.isActive, false);
  assertEquals(
    w.applied.map((e) => e.type),
    ['INITIAL_PURCHASE', 'RENEWAL', 'BILLING_ISSUE', 'EXPIRATION'],
  );
  assertEquals(w.tier(), 'free');
});

Deno.test('the test clock refuses a moment that does not apply', async () => {
  const w = world();
  await w.handler()(post(PARENT, buy()));
  const res = await w.handler()(
    post(PARENT, { action: 'advance', householdId: H, to: 'grace_end' }),
  );
  assertEquals(res.status, 409);
  assertEquals((await res.json()).error.code, 'billing.clock_not_applicable');
});

Deno.test("the test clock is for the household's parents only", async () => {
  const res = await world().handler()(
    post(CAREGIVER, { action: 'advance', householdId: H, to: 'renewal' }),
  );
  assertEquals(res.status, 403);
});

Deno.test('manage: cancel, refund', async () => {
  const w = world();
  const h = w.handler();
  await h(post(PARENT, buy()));
  const cancelled = await (await h(post(PARENT, { action: 'manage', operation: 'cancel' }))).json();
  assertEquals(cancelled.subscription.willRenew, false);
  assertEquals(w.tier(), 'premium');
  await h(post(PARENT, { action: 'manage', operation: 'refund' }));
  assertEquals(w.tier(), 'free');
  const none = await h(post(PARENT, { action: 'manage', operation: 'cancel' }));
  assertEquals(none.status, 404);
});

Deno.test('rejects unknown actions and products', async () => {
  const h = world().handler();
  assertEquals((await h(post(PARENT, { action: 'hack' }))).status, 400);
  assertEquals((await h(post(PARENT, buy({ productId: 'pm_free_forever' })))).status, 400);
});
