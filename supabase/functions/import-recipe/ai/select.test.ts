import { assertEquals } from 'jsr:@std/assert@1';

import { parserNotConfigured } from '../parser.ts';
import { isLocalStack, selectParser } from './select.ts';

Deno.test('no provider secret means no parser; the fake runs only against a local stack', () => {
  const env = (vars: Record<string, string>) => (name: string) => vars[name];
  assertEquals(selectParser(env({})).parser, parserNotConfigured);
  assertEquals(selectParser(env({ AI_PROVIDER: 'anthropic' })).provider, 'none');
  assertEquals(
    selectParser(env({ AI_PROVIDER: 'anthropic', ANTHROPIC_API_KEY: 'k' })).provider,
    'anthropic',
  );
  assertEquals(
    selectParser(env({ AI_PROVIDER: 'fake', SUPABASE_URL: 'http://kong:8000' })).provider,
    'fake',
  );
  assertEquals(
    selectParser(env({ AI_PROVIDER: 'fake', SUPABASE_URL: 'https://abc.supabase.co' })).provider,
    'none',
  );
  assertEquals(isLocalStack('http://127.0.0.1:54321'), true);
  assertEquals(isLocalStack(undefined), false);
});

Deno.test('fake pages answer only .test links, and never touch the network for them', async () => {
  const { withFakePages } = await import('./fake_pages.ts');
  const real: string[] = [];
  const fetchPage = withFakePages((url) => {
    real.push(url);
    return Promise.resolve({ url, html: '<p>real</p>' });
  });
  const signal = new AbortController().signal;
  const page = await fetchPage('https://recipes.example.test/lemon-chicken', signal);
  assertEquals(page.html.includes('Lemon chicken traybake'), true);
  let failed = '';
  await fetchPage('https://recipes.example.test/nope', signal).catch((e) => (failed = e.code));
  assertEquals(failed, 'import.link_unreachable');
  await fetchPage('https://example.com/r', signal);
  assertEquals(real, ['https://example.com/r']);
});
