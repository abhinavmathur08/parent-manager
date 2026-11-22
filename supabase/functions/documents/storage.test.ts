import { assertEquals } from 'jsr:@std/assert@1';

import { documentStorage } from './storage.ts';

function recorder(responses: Response[]) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const fetcher = ((url: string, init?: RequestInit) => {
    calls.push({ url, init });
    return Promise.resolve(responses.shift()!);
  }) as typeof fetch;
  return { calls, fetcher };
}

const headers = (init?: RequestInit) => init?.headers as Record<string, string>;

Deno.test('read links are signed as the caller for the given seconds (R2-DOC-2)', async () => {
  const { calls, fetcher } = recorder([
    new Response('{"signedURL":"/object/sign/documents/h/d/1.jpg?token=t"}'),
  ]);
  const storage = documentStorage('http://api', 'sb_secret_x', 'sb_publishable_y', fetcher);
  assertEquals(
    await storage.signRead('h/d/1.jpg', 60, 'user-jwt'),
    '/object/sign/documents/h/d/1.jpg?token=t',
  );
  assertEquals(calls[0].url, 'http://api/storage/v1/object/sign/documents/h/d/1.jpg');
  assertEquals(JSON.parse(calls[0].init?.body as string), { expiresIn: 60 });
  assertEquals(headers(calls[0].init).Authorization, 'Bearer user-jwt');
  assertEquals(headers(calls[0].init).apikey, 'sb_publishable_y');
});

Deno.test('a read the bucket policy refuses gives no link', async () => {
  const { fetcher } = recorder([new Response('{"error":"not_found"}', { status: 400 })]);
  const storage = documentStorage('http://api', 'sb_secret_x', 'sb_publishable_y', fetcher);
  assertEquals(await storage.signRead('h/d/1.jpg', 60, 'user-jwt'), null);
});

Deno.test('upload tokens and listings use the service key', async () => {
  const { calls, fetcher } = recorder([
    new Response('{"url":"/object/upload/sign/documents/h/d/1.jpg?token=abc"}'),
    new Response('[{"name":"1.jpg","id":"x","metadata":{"size":42}},{"name":"sub","id":null}]'),
    new Response('[]'),
  ]);
  const storage = documentStorage('http://api', 'sb_secret_x', 'sb_publishable_y', fetcher);
  assertEquals(await storage.signUpload('h/d/1.jpg'), 'abc');
  assertEquals(await storage.list('h/d'), [{ name: '1.jpg', size: 42 }]);
  await storage.remove(['h/d/1.jpg']);
  assertEquals(
    calls.map((c) => headers(c.init).apikey),
    ['sb_secret_x', 'sb_secret_x', 'sb_secret_x'],
  );
  assertEquals(calls[2].init?.method, 'DELETE');
  assertEquals(JSON.parse(calls[2].init?.body as string), { prefixes: ['h/d/1.jpg'] });
});
