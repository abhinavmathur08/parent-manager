// Edge Function `notify` (N-01.3): sends due pushes through Expo. See handler.ts.
//
// Secrets, added by the product owner (never committed):
// - `NOTIFY_CRON_SECRET`: shared with pg_cron, which reads it from Vault (`notify_cron_secret`)
//   with the function's URL (`notify_function_url`).
// - `EXPO_ACCESS_TOKEN` (optional): only if the Expo project turns on enhanced push security.

import { createClient } from 'jsr:@supabase/supabase-js@2';

import { sendToExpo } from './expo.ts';
import { createHandler } from './handler.ts';
import type { ClaimedPush } from './messages.ts';

/** The service key: the new secret key if the project has one, otherwise the legacy one. */
function serviceKey(): string {
  const keys = Deno.env.get('SUPABASE_SECRET_KEYS');
  if (keys) {
    const parsed = JSON.parse(keys) as Record<string, string>;
    const key = parsed.default ?? Object.values(parsed)[0];
    if (key) return key;
  }
  const legacy = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!legacy) throw new Error('No service key in the environment');
  return legacy;
}

const admin = createClient(Deno.env.get('SUPABASE_URL')!, serviceKey(), {
  auth: { persistSession: false, autoRefreshToken: false },
});

async function call<T>(fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await admin.rpc(fn, args);
  if (error) throw new Error(`${fn} failed`);
  return data as T;
}

Deno.serve(
  createHandler({
    secret: Deno.env.get('NOTIFY_CRON_SECRET'),
    claim: (batch) => call<ClaimedPush[]>('claim_pushes', { batch }),
    release: (ids) => call<void>('release_pushes', { ids }),
    dropTokens: (dead) => call<void>('drop_push_tokens', { dead }),
    send: (messages) => sendToExpo(messages, fetch, Deno.env.get('EXPO_ACCESS_TOKEN')),
  }),
);
