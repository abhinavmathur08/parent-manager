// Edge Function `import-recipe` (R-05.1 to R-07): turns pasted text, links and images into a
// draft recipe. See handler.ts for the pipeline and architecture section 6.
//
// It talks to the database through the fetch-only admin client in _shared/admin.ts rather
// than supabase-js, so a cold worker boots within the local runtime's CPU limit (E2E).

import { adminClient } from '../_shared/admin.ts';
import { withFakePages } from './ai/fake_pages.ts';
import { selectParser } from './ai/select.ts';
import { fetchPage, resolveWithDns } from './fetch_page.ts';
import { createHandler } from './handler.ts';
import { createJobStore } from './jobs.ts';

const { parser, provider } = selectParser((name) => Deno.env.get(name));
const admin = adminClient();
const fetchFromWeb = (url: string, signal: AbortSignal) =>
  fetchPage(url, { fetch, resolve: resolveWithDns }, signal);

Deno.serve(
  createHandler({
    authenticate: (accessToken) => admin.userId(accessToken),
    jobs: createJobStore(admin),
    // With the fake provider (local stacks only), `.test` links get canned pages for E2E.
    fetchPage: provider === 'fake' ? withFakePages(fetchFromWeb) : fetchFromWeb,
    // Chosen by the AI_PROVIDER secret (decision D-7, ai/select.ts).
    parser,
  }),
);
