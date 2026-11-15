import { assertEquals } from 'jsr:@std/assert@1';

import type { SubscriptionEvent } from '../_shared/billing/events.ts';
import { createHandler } from './handler.ts';

function sink() {
  const applied: SubscriptionEvent[] = [];
  return {
    applied,
    apply: (event: SubscriptionEvent) => {
      const duplicate = applied.some((e) => e.id === event.id);
      applied.push(event);
      return Promise.resolve(duplicate ? ('duplicate' as const) : ('applied' as const));
    },
  };
}

const HOUSEHOLD = '00000000-0000-0000-0000-00000000000a';
const USER = 'aaaaaaaa-0000-0000-0000-000000000001';

const body = {
  api_version: '1.0',
  event: {
    id: 'rc-1',
    type: 'INITIAL_PURCHASE',
    app_user_id: USER,
    product_id: 'pm_premium_monthly',
    period_type: 'TRIAL',
    store: 'APP_STORE',
    purchased_at_ms: Date.UTC(2026, 10, 15),
    expiration_at_ms: Date.UTC(2026, 10, 29),
    event_timestamp_ms: Date.UTC(2026, 10, 15, 0, 0, 1),
    subscriber_attributes: { household_id: { value: HOUSEHOLD }, $email: { value: 'x@y.z' } },
  },
};

function post(payload: unknown, auth = 'Bearer whsec') {
  return new Request('http://x/subscription-events', {
    method: 'POST',
    headers: { Authorization: auth },
    body: JSON.stringify(payload),
  });
}

const quiet = () => {};

Deno.test('refuses everything until the webhook secret is set', async () => {
  const s = sink();
  const res = await createHandler({ authorization: null, sink: s, log: quiet })(post(body));
  assertEquals(res.status, 503);
  assertEquals(s.applied.length, 0);
});

Deno.test('refuses a wrong authorization header', async () => {
  const s = sink();
  const handler = createHandler({ authorization: 'Bearer whsec', sink: s, log: quiet });
  assertEquals((await handler(post(body, 'Bearer nope'))).status, 401);
  assertEquals(s.applied.length, 0);
});

Deno.test(
  'applies a RevenueCat event as a revenuecat-sourced event, keeping only IDs',
  async () => {
    const s = sink();
    const handler = createHandler({ authorization: 'Bearer whsec', sink: s, log: quiet });
    const res = await handler(post(body));
    assertEquals(res.status, 200);
    assertEquals(await res.json(), { outcome: 'applied' });
    const event = s.applied[0];
    assertEquals(event.source, 'revenuecat');
    assertEquals(event.store, 'APP_STORE');
    assertEquals(event.household_id, HOUSEHOLD);
    assertEquals(event.period_type, 'TRIAL');
    assertEquals(event.expiration_at, '2026-11-29T00:00:00.000Z');
    assertEquals(JSON.stringify(event).includes('x@y.z'), false);
  },
);

Deno.test('a replayed webhook succeeds without applying twice', async () => {
  const s = sink();
  const handler = createHandler({ authorization: 'Bearer whsec', sink: s, log: quiet });
  await handler(post(body));
  const res = await handler(post(body));
  assertEquals(res.status, 200);
  assertEquals(await res.json(), { outcome: 'duplicate' });
});

Deno.test('refuses a body that is not a RevenueCat event', async () => {
  const handler = createHandler({ authorization: 'Bearer whsec', sink: sink(), log: quiet });
  assertEquals((await handler(post({ event: { type: 'RENEWAL' } }))).status, 400);
});
