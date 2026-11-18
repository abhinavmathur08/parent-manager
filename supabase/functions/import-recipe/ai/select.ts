// Picks the parser from the function's secrets (decision D-7). With no provider configured,
// imports fail cleanly with import.parser_unavailable and nothing is counted.
//
//   AI_PROVIDER=fake                                                  -> the fake, local only
//
// See docs/decisions-needed.md (D-7) for turning real parsing on.

import { parserNotConfigured, type RecipeParser } from '../parser.ts';
import { createAiParser } from './ai_parser.ts';
import { createFakeProvider } from './fake.ts';

export type Env = (name: string) => string | undefined;

/** The fake answers with made-up drafts, so it only runs against a local stack. */
export function isLocalStack(supabaseUrl: string | undefined): boolean {
  if (!supabaseUrl) return false;
  try {
    const host = new URL(supabaseUrl).hostname;
    return ['localhost', '127.0.0.1', 'kong', 'host.docker.internal'].includes(host);
  } catch {
    return false;
  }
}

export function selectParser(env: Env): { parser: RecipeParser; provider: string } {
  const provider = env('AI_PROVIDER')?.trim().toLowerCase();
  if (provider === 'fake' && isLocalStack(env('SUPABASE_URL'))) {
    return { parser: createAiParser(createFakeProvider()), provider: 'fake' };
  }
  return { parser: parserNotConfigured, provider: 'none' };
}
