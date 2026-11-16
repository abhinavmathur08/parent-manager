import { assertEquals } from 'jsr:@std/assert@1';

import { parserNotConfigured } from '../parser.ts';
import { isLocalStack, selectParser } from './select.ts';

Deno.test('no provider secret means no parser; the fake runs only against a local stack', () => {
  const env = (vars: Record<string, string>) => (name: string) => vars[name];
  assertEquals(selectParser(env({})).parser, parserNotConfigured);
  assertEquals(selectParser(env({ AI_PROVIDER: 'other' })).provider, 'none');
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
