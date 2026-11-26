import { assertEquals, assertRejects } from 'jsr:@std/assert@1';

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

Deno.test(
  'read links are signed with the service key for the given seconds (R2-DOC-2)',
  async () => {
    const { calls, fetcher } = recorder([
      new Response('{"signedURL":"/object/sign/documents/h/d/1.jpg?token=t"}'),
    ]);
    const storage = documentStorage('http://api', 'sb_secret_x', fetcher);
    assertEquals(
      await storage.signRead('h/d/1.jpg', 60),
      '/object/sign/documents/h/d/1.jpg?token=t',
    );
    assertEquals(calls[0].url, 'http://api/storage/v1/object/sign/documents/h/d/1.jpg');
    assertEquals(JSON.parse(calls[0].init?.body as string), { expiresIn: 60 });
    assertEquals(headers(calls[0].init).apikey, 'sb_secret_x');
  },
);

Deno.test('a missing file gives no link', async () => {
  const { fetcher } = recorder([new Response('{"error":"not_found"}', { status: 400 })]);
  const storage = documentStorage('http://api', 'sb_secret_x', fetcher);
  assertEquals(await storage.signRead('h/d/1.jpg', 60), null);
});

Deno.test('upload tokens and listings use the service key', async () => {
  const { calls, fetcher } = recorder([
    new Response('{"url":"/object/upload/sign/documents/h/d/1.jpg?token=abc"}'),
    new Response('[{"name":"1.jpg","id":"x","metadata":{"size":42}},{"name":"sub","id":null}]'),
    new Response('[]'),
  ]);
  const storage = documentStorage('http://api', 'sb_secret_x', fetcher);
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

Deno.test('listings page through a large folder and tell files from folders', async () => {
  const page = Array.from({ length: 100 }, (_, i) => ({ name: `d${i}`, id: null }));
  const { calls, fetcher } = recorder([
    new Response(JSON.stringify(page)),
    new Response('[{"name":"d100","id":null},{"name":"stray.jpg","id":"x"}]'),
  ]);
  const storage = documentStorage('http://api', 'sb_secret_x', fetcher);
  const folders = await storage.folders('h');
  assertEquals(folders.length, 101);
  assertEquals(folders.at(-1), 'd100');
  assertEquals(
    calls.map((c) => JSON.parse(c.init?.body as string).offset),
    [0, 100],
  );
});

Deno.test('head reads only the first bytes of a file, as the service role (SR2-L3)', async () => {
  const { calls, fetcher } = recorder([
    new Response(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]), {
      status: 200,
    }),
    new Response(new Uint8Array([1, 2]), { status: 206 }),
    new Response('{"error":"not_found"}', { status: 400 }),
    new Response('oops', { status: 500 }),
  ]);
  const storage = documentStorage('http://api', 'sb_secret_x', fetcher);
  // A server that ignores the range still yields only the bytes asked for.
  assertEquals(await storage.head('h/d/1.pdf', 8), new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]));
  assertEquals(calls[0].url, 'http://api/storage/v1/object/authenticated/documents/h/d/1.pdf');
  assertEquals(headers(calls[0].init).Range, 'bytes=0-7');
  assertEquals(headers(calls[0].init).apikey, 'sb_secret_x');
  assertEquals(await storage.head('h/d/1.pdf', 8), new Uint8Array([1, 2]));
  assertEquals(await storage.head('h/d/1.pdf', 8), null);
  await assertRejects(() => storage.head('h/d/1.pdf', 8));
});
