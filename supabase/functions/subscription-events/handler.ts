// Edge Function `subscription-events` (M-01.2): the RevenueCat webhook endpoint. It checks the
// shared authorization header, converts RevenueCat's event to the normalized shape and applies
// it through the same idempotent path the mock store uses (_shared/billing/apply.ts).
//
// It does nothing until RevenueCat exists: without the BILLING_WEBHOOK_AUTH secret (set by
// the product owner with RevenueCat, D-10) every request is refused. It never accepts mock
// events, so the mock store stays the only way a mock entitlement is made.

import type { EventSink } from '../_shared/billing/apply.ts';
import { fromRevenueCat } from '../_shared/billing/events.ts';
import { errorResponse, jsonResponse } from '../_shared/http.ts';

export interface HandlerDeps {
  /** The shared Authorization header value configured in RevenueCat, or null if unset. */
  authorization: string | null;
  sink: EventSink;
  log?: (event: string, fields: Record<string, string>) => void;
}

/** Compares without leaking the position of the first difference. */
function sameSecret(a: string, b: string): boolean {
  const left = new TextEncoder().encode(a);
  const right = new TextEncoder().encode(b);
  let diff = left.length ^ right.length;
  for (let i = 0; i < Math.max(left.length, right.length); i++) {
    diff |= (left[i] ?? 0) ^ (right[i] ?? 0);
  }
  return diff === 0;
}

export function createHandler(deps: HandlerDeps): (req: Request) => Promise<Response> {
  const log = deps.log ?? ((event, fields) => console.log(JSON.stringify({ event, ...fields })));

  return async (req) => {
    if (!deps.authorization) return errorResponse('billing.webhook_not_configured', 503);
    if (req.method !== 'POST') return errorResponse('billing.method_not_allowed', 405);
    if (!sameSecret(req.headers.get('Authorization') ?? '', deps.authorization)) {
      return errorResponse('billing.unauthorized', 401);
    }

    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return errorResponse('billing.invalid_request', 400);
    }
    const event = fromRevenueCat(body);
    if (!event) return errorResponse('billing.invalid_request', 400);

    try {
      const outcome = await deps.sink.apply(event);
      log('billing.event', { type: event.type, outcome });
      // RevenueCat retries anything but a 2xx, so every handled outcome is a success.
      return jsonResponse({ outcome });
    } catch {
      log('billing.event_failed', { type: event.type });
      return errorResponse('billing.failed', 500);
    }
  };
}
