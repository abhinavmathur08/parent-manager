// Edge Function `import-recipe` (R-05.1): turns pasted text, and later links and images,
// into a draft recipe. See handler.ts for the pipeline and architecture section 6.

import { createClient } from 'jsr:@supabase/supabase-js@2';

import { createHandler } from './handler.ts';
import { createJobStore } from './jobs.ts';
import { parserNotConfigured } from './parser.ts';

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

Deno.serve(
  createHandler({
    async authenticate(accessToken) {
      const { data, error } = await admin.auth.getUser(accessToken);
      return error ? null : (data.user?.id ?? null);
    },
    jobs: createJobStore(admin),
    // R-05.3 replaces this with the chosen provider's parser (decision D-7).
    parser: parserNotConfigured,
  }),
);
