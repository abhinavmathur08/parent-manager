// Edge Function `mock-store` (M-01.2). See handler.ts. Off unless BILLING_MOCK_ENABLED=true.

import { adminClient } from '../_shared/admin.ts';
import { createEventSink } from '../_shared/billing/apply.ts';
import { createHandler } from './handler.ts';
import { createStoreRepo } from './repo.ts';

const enabled = Deno.env.get('BILLING_MOCK_ENABLED') === 'true';
const admin = adminClient();

Deno.serve(
  createHandler({
    enabled,
    authenticate: (accessToken) => admin.userId(accessToken),
    repo: createStoreRepo(admin),
    sink: createEventSink(admin),
  }),
);
