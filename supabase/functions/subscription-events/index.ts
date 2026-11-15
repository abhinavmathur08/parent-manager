// Edge Function `subscription-events` (M-01.2). See handler.ts. Refuses everything until the
// BILLING_WEBHOOK_AUTH secret exists (D-10, set by the product owner).

import { adminClient } from '../_shared/admin.ts';
import { createEventSink } from '../_shared/billing/apply.ts';
import { createHandler } from './handler.ts';

const authorization = Deno.env.get('BILLING_WEBHOOK_AUTH')?.trim() || null;

Deno.serve(createHandler({ authorization, sink: createEventSink(adminClient()) }));
