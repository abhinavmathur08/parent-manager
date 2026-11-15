import { assertEquals } from 'jsr:@std/assert@1';

import { adminClient } from './admin.ts';

function recorder(responses: Response[]) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const fetcher = ((url: string, init?: RequestInit) => {
    calls.push({ url, init });
    return Promise.resolve(responses.shift()!);
  }) as typeof fetch;
  return { calls, fetcher };
}

Deno.test('a new secret key goes in apikey only', async () => {
  const { calls, fetcher } = recorder([new Response('{"outcome":"applied"}')]);
  const admin = adminClient('http://db', 'sb_secret_x', fetcher);
  const { data } = await admin.rpc('apply_subscription_event', { event: {} });
  assertEquals(data, { outcome: 'applied' });
  const headers = calls[0].init?.headers as Record<string, string>;
  assertEquals(calls[0].url, 'http://db/rest/v1/rpc/apply_subscription_event');
  assertEquals(headers.apikey, 'sb_secret_x');
  assertEquals(headers.Authorization, undefined);
});

Deno.test('a legacy JWT key also goes in Authorization', async () => {
  const { calls, fetcher } = recorder([new Response('[]')]);
  await adminClient('http://db', 'eyJlegacy', fetcher).select('t', { a: 'eq.1' });
  assertEquals(
    (calls[0].init?.headers as Record<string, string>).Authorization,
    'Bearer eyJlegacy',
  );
  assertEquals(calls[0].url, 'http://db/rest/v1/t?a=eq.1');
});

Deno.test('errors carry the Postgres code', async () => {
  const { fetcher } = recorder([
    new Response('{"code":"23505","message":"duplicate"}', { status: 409 }),
  ]);
  const { error } = await adminClient('http://db', 'k', fetcher).upsert('t', { id: 1 });
  assertEquals(error?.code, '23505');
});

Deno.test('userId reads the user for a valid token, null otherwise', async () => {
  const { fetcher } = recorder([
    new Response('{"id":"u1"}'),
    new Response('{"msg":"bad jwt"}', { status: 401 }),
  ]);
  const admin = adminClient('http://db', 'k', fetcher);
  assertEquals(await admin.userId('good'), 'u1');
  assertEquals(await admin.userId('bad'), null);
});
