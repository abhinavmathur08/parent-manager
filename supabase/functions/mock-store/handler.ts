// Edge Function `mock-store` (M-01.2, D-10 interim): plays the app store for the mock billing
// provider, without charging anyone. It keeps each subscription's real state, sends the
// RevenueCat-style events a store would, and applies them through the same idempotent path
// RevenueCat's webhook will use (_shared/billing/apply.ts).
//
// It is OFF unless the project sets the Edge Function secret BILLING_MOCK_ENABLED=true, so it
// can never grant Premium in production. Logs carry only codes, never user data.
//
// Requests: POST with the user's session, JSON `{ action, ... }`:
//   status                                  -> { enabled: true }
//   subscription                            -> the caller's store subscription
//   purchase { productId, householdId, delayWebhook? }
//   restore                                 -> sends held and latest events again
//   manage { operation, productId? }        -> cancel, uncancel, change_product, refund, fix_payment
//   advance { householdId, to }             -> the test clock

import type { EventSink } from '../_shared/billing/apply.ts';
import type { SubscriptionEvent } from '../_shared/billing/events.ts';
import { isProductId } from '../_shared/billing/products.ts';
import { bearerToken } from '../_shared/admin.ts';
import { errorResponse, jsonResponse } from '../_shared/http.ts';
import { type HeldEvent, LiveSubscriptionExists, type Stored, type StoreRepo } from './repo.ts';
import {
  advance,
  catchUp,
  CLOCK_TARGETS,
  type ClockTarget,
  type Context,
  manage,
  type Operation,
  OPERATIONS,
  purchase,
  type Step,
  StoreError,
  view,
} from './store.ts';

/** How long a "delayed webhook" is held before any request delivers it. */
export const WEBHOOK_HOLD_MS = 90_000;

export interface HandlerDeps {
  /** BILLING_MOCK_ENABLED === 'true' on this project. */
  enabled: boolean;
  authenticate(accessToken: string): Promise<string | null>;
  repo: StoreRepo;
  sink: EventSink;
  now?: () => Date;
  newId?: () => string;
  log?: (event: string, fields: Record<string, string>) => void;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function createHandler(deps: HandlerDeps): (req: Request) => Promise<Response> {
  const log = deps.log ?? ((event, fields) => console.log(JSON.stringify({ event, ...fields })));

  return async (req) => {
    // Checked first, so a project without the setting reveals nothing else.
    if (!deps.enabled) return errorResponse('billing.mock_disabled', 404);
    if (req.method !== 'POST') return errorResponse('billing.method_not_allowed', 405);

    const token = bearerToken(req);
    const userId = token ? await deps.authenticate(token) : null;
    if (!userId) return errorResponse('billing.unauthenticated', 401);

    let body: Record<string, unknown>;
    try {
      body = (await req.json()) as Record<string, unknown>;
      if (!body || typeof body !== 'object') throw new Error();
    } catch {
      return errorResponse('billing.invalid_request', 400);
    }

    const ctx: Context = {
      now: deps.now?.() ?? new Date(),
      newId: deps.newId ?? (() => crypto.randomUUID()),
    };

    try {
      switch (body.action) {
        case 'status':
          return jsonResponse({ enabled: true });
        case 'subscription': {
          const stored = await deps.repo.forUser(userId);
          return respond(stored ? await refresh(deps, ctx, stored) : null);
        }
        case 'purchase':
          return await buy(deps, ctx, userId, body);
        case 'restore':
          return await restore(deps, ctx, userId);
        case 'manage': {
          const operation = body.operation as Operation;
          if (!OPERATIONS.includes(operation)) return errorResponse('billing.invalid_request', 400);
          const productId = isProductId(body.productId) ? body.productId : undefined;
          const stored = await deps.repo.forUser(userId);
          const step = manage(stored?.subscription ?? null, operation, ctx, productId);
          return await respond(await commit(deps, ctx, stored, step, false));
        }
        case 'advance': {
          const to = body.to as ClockTarget;
          const householdId = String(body.householdId ?? '');
          if (!CLOCK_TARGETS.includes(to) || !UUID.test(householdId)) {
            return errorResponse('billing.invalid_request', 400);
          }
          if (!(await deps.repo.isParent(userId, householdId))) {
            return errorResponse('billing.not_a_parent', 403);
          }
          const stored = await deps.repo.forHousehold(householdId);
          const step = advance(stored?.subscription ?? null, to, ctx);
          return await respond(await commit(deps, ctx, stored, step, false));
        }
        default:
          return errorResponse('billing.invalid_request', 400);
      }
    } catch (error) {
      if (error instanceof StoreError) return errorResponse(error.code, error.status);
      if (error instanceof LiveSubscriptionExists) {
        return errorResponse('billing.already_premium', 409);
      }
      log('billing.mock_store_failed', { action: String(body.action ?? '') });
      return errorResponse('billing.failed', 500);
    }
  };
}

async function buy(deps: HandlerDeps, ctx: Context, userId: string, body: Record<string, unknown>) {
  const householdId = String(body.householdId ?? '');
  if (!isProductId(body.productId)) return errorResponse('billing.unknown_product', 400);
  if (!UUID.test(householdId)) return errorResponse('billing.invalid_request', 400);
  // Only parents can buy (FR-PAY-4).
  if (!(await deps.repo.isParent(userId, householdId))) {
    return errorResponse('billing.not_a_parent', 403);
  }

  let stored = await deps.repo.forUser(userId);
  if (stored) stored = await refresh(deps, ctx, stored);
  if (stored && !stored.subscription.endedAt) {
    return errorResponse('billing.already_subscribed', 409);
  }
  // A second parent can't buy while the household is Premium (spec 3.13, PROPOSED).
  if ((await deps.repo.tier(householdId)) === 'premium') {
    return errorResponse('billing.already_premium', 409);
  }

  const step = purchase(
    stored?.subscription ?? null,
    { appUserId: userId, householdId, productId: body.productId },
    ctx,
  );
  return respond(await commit(deps, ctx, stored, step, body.delayWebhook === true));
}

async function restore(deps: HandlerDeps, ctx: Context, userId: string) {
  const stored = await deps.repo.forUser(userId);
  if (!stored) return jsonResponse({ subscription: null });
  // Deliver anything held back, then send the latest event again: a replay is harmless.
  const released = await deliver(
    deps,
    stored.held.map((h) => h.event),
  );
  const latest = await refresh(deps, ctx, { ...stored, held: [] });
  if (latest.lastEvent && latest.lastEvent.id !== released.at(-1)?.id) {
    await deps.sink.apply(latest.lastEvent);
  }
  await deps.repo.save(latest);
  return respond(latest);
}

/** Lets time pass on a stored subscription and delivers what's due. */
async function refresh(deps: HandlerDeps, ctx: Context, stored: Stored): Promise<Stored> {
  const step = catchUp(stored.subscription, ctx);
  const due = stored.held.filter((h) => new Date(h.releaseAt).getTime() <= ctx.now.getTime());
  if (step.events.length === 0 && due.length === 0) return stored;
  return commit(deps, ctx, stored, step, false);
}

/**
 * Saves the new state and sends its events. While earlier events are held back, new ones
 * queue behind them, as a delayed webhook's would.
 */
async function commit(
  deps: HandlerDeps,
  ctx: Context,
  stored: Stored | null,
  step: Step,
  delay: boolean,
): Promise<Stored> {
  let held: HeldEvent[] = stored?.held ?? [];
  const due = held.filter((h) => new Date(h.releaseAt).getTime() <= ctx.now.getTime());
  held = held.filter((h) => !due.includes(h));

  let send: SubscriptionEvent[] = due.map((h) => h.event);
  if (delay || held.length > 0) {
    const releaseAt = new Date(ctx.now.getTime() + WEBHOOK_HOLD_MS).toISOString();
    held = [...held, ...step.events.map((event) => ({ event, releaseAt }))];
  } else {
    send = [...send, ...step.events];
  }

  const next: Stored = {
    subscription: step.subscription,
    held,
    lastEvent: step.events.at(-1) ?? stored?.lastEvent ?? null,
  };
  // Save before sending, so the one-live-subscription-per-household rule is checked first.
  await deps.repo.save(next);
  await deliver(deps, send);
  return next;
}

async function deliver(deps: HandlerDeps, events: SubscriptionEvent[]) {
  for (const event of events) await deps.sink.apply(event);
  return events;
}

function respond(stored: Stored | null): Response {
  return jsonResponse({ subscription: stored ? view(stored.subscription) : null });
}
