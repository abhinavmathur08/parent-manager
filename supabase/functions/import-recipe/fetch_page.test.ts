import { assertEquals, assertRejects } from 'jsr:@std/assert@1';

import { checkLinkShape, type FetchPageDeps, FetchPageError, fetchPage } from './fetch_page.ts';

const PUBLIC = '93.184.215.14';

/** A fake web: each URL maps to a response factory. Records every URL fetched. */
function web(
  pages: Record<string, () => Response>,
  dns: Record<string, string[]> = {},
): { deps: FetchPageDeps; fetched: string[] } {
  const fetched: string[] = [];
  const deps: FetchPageDeps = {
    fetch: ((input: URL | string) => {
      const url = String(input);
      fetched.push(url);
      const page = pages[url];
      return page ? Promise.resolve(page()) : Promise.reject(new TypeError('connection refused'));
    }) as typeof fetch,
    resolve: (host) => Promise.resolve(dns[host] ?? [PUBLIC]),
  };
  return { deps, fetched };
}

const html =
  (body: string, headers: Record<string, string> = {}) =>
  () =>
    new Response(body, { headers: { 'Content-Type': 'text/html; charset=utf-8', ...headers } });

const redirect = (location: string) => () =>
  new Response(null, { status: 302, headers: { Location: location } });

async function codeOf(promise: Promise<unknown>): Promise<string> {
  const error = await assertRejects(() => promise, FetchPageError);
  return (error as FetchPageError).code;
}

Deno.test('link shape: only http(s) on default ports, no credentials, dotted public hosts', () => {
  for (const url of [
    'https://www.example.com/recipes/soup',
    'http://example.co.uk/a?b=c',
    `http://${PUBLIC}/`,
  ]) {
    assertEquals(checkLinkShape(url) !== null, true, url);
  }
  for (const url of [
    'file:///etc/passwd',
    'data:text/html,<p>x</p>',
    'gopher://example.com/',
    'https://user:pass@example.com/',
    'https://example.com:444/',
    'http://intranet/',
    'http://printer.local/',
    'http://db.internal/',
    'http://0x7f000001/',
    'http://2130706433/',
    'http://[::ffff:127.0.0.1]/',
    'not a url',
    `https://example.com/${'a'.repeat(2048)}`,
  ]) {
    assertEquals(checkLinkShape(url), null, url);
  }
});

Deno.test('reads an HTML page', async () => {
  const { deps } = web({ 'https://example.com/soup': html('<p>Soup</p>') });
  assertEquals(await fetchPage('https://example.com/soup', deps), {
    url: 'https://example.com/soup',
    html: '<p>Soup</p>',
  });
});

Deno.test('a host that resolves to a private address is refused without a request', async () => {
  const { deps, fetched } = web(
    { 'https://evil.example.com/': html('x') },
    { 'evil.example.com': ['10.0.0.1'] },
  );
  assertEquals(await codeOf(fetchPage('https://evil.example.com/', deps)), 'import.link_refused');
  assertEquals(fetched, []);
});

Deno.test('a host with any private record is refused', async () => {
  const { deps } = web({}, { 'mixed.example.com': [PUBLIC, '127.0.0.1'] });
  assertEquals(await codeOf(fetchPage('https://mixed.example.com/', deps)), 'import.link_refused');
});

Deno.test('a host that does not resolve is refused', async () => {
  const { deps } = web({}, { 'nowhere.example.com': [] });
  assertEquals(
    await codeOf(fetchPage('https://nowhere.example.com/', deps)),
    'import.link_refused',
  );
});

Deno.test('redirects are followed and each hop is checked', async () => {
  const { deps, fetched } = web({
    'https://short.example.com/x': redirect('https://example.com/soup'),
    'https://example.com/soup': html('<p>Soup</p>'),
  });
  const page = await fetchPage('https://short.example.com/x', deps);
  assertEquals(page.url, 'https://example.com/soup');
  assertEquals(fetched, ['https://short.example.com/x', 'https://example.com/soup']);
});

Deno.test('a redirect to a private address or another scheme is refused', async () => {
  for (const target of [
    'http://169.254.169.254/latest/meta-data/',
    'http://127.0.0.1:8080/',
    'file:///etc/passwd',
  ]) {
    const { deps, fetched } = web({ 'https://example.com/r': redirect(target) });
    assertEquals(await codeOf(fetchPage('https://example.com/r', deps)), 'import.link_refused');
    assertEquals(fetched, ['https://example.com/r']);
  }
});

Deno.test('a redirect to a host that resolves privately is refused', async () => {
  const { deps, fetched } = web(
    { 'https://example.com/r': redirect('https://rebind.example.com/') },
    { 'rebind.example.com': ['192.168.0.10'] },
  );
  assertEquals(await codeOf(fetchPage('https://example.com/r', deps)), 'import.link_refused');
  assertEquals(fetched, ['https://example.com/r']);
});

Deno.test('too many redirects fail', async () => {
  const { deps } = web({
    'https://example.com/1': redirect('/2'),
    'https://example.com/2': redirect('/3'),
    'https://example.com/3': redirect('/4'),
    'https://example.com/4': redirect('/5'),
  });
  assertEquals(await codeOf(fetchPage('https://example.com/1', deps)), 'import.link_unreachable');
});

Deno.test('error statuses, non-HTML and unreachable sites fail', async () => {
  const { deps } = web({
    'https://example.com/missing': () => new Response('no', { status: 404 }),
    'https://example.com/file.pdf': () =>
      new Response('%PDF', { headers: { 'Content-Type': 'application/pdf' } }),
  });
  assertEquals(
    await codeOf(fetchPage('https://example.com/missing', deps)),
    'import.link_unreachable',
  );
  assertEquals(
    await codeOf(fetchPage('https://example.com/file.pdf', deps)),
    'import.link_unsupported',
  );
  assertEquals(
    await codeOf(fetchPage('https://example.com/down', deps)),
    'import.link_unreachable',
  );
});

Deno.test('pages over the size cap are refused, declared or streamed', async () => {
  const big = 'x'.repeat(2_000);
  const { deps } = web({
    'https://example.com/declared': html('x', { 'Content-Length': '5000' }),
    'https://example.com/streamed': html(big),
  });
  const small = { ...deps, maxBytes: 1_000 };
  assertEquals(
    await codeOf(fetchPage('https://example.com/declared', small)),
    'import.link_too_large',
  );
  assertEquals(
    await codeOf(fetchPage('https://example.com/streamed', small)),
    'import.link_too_large',
  );
});

Deno.test('a slow site times out', async () => {
  const deps: FetchPageDeps = {
    fetch: ((_: unknown, init?: RequestInit) =>
      new Promise((_, reject) => {
        init?.signal?.addEventListener('abort', () => reject(init.signal?.reason));
      })) as typeof fetch,
    resolve: () => Promise.resolve([PUBLIC]),
    timeoutMs: 10,
  };
  assertEquals(
    await codeOf(fetchPage('https://example.com/slow', deps)),
    'import.link_unreachable',
  );
});
