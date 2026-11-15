import { assertEquals, assertThrows } from 'jsr:@std/assert@1';

import { addMonths } from '../_shared/billing/products.ts';
import {
  advance,
  catchUp,
  type Context,
  manage,
  type MockSubscription,
  purchase,
  StoreError,
} from './store.ts';

let n = 0;
function ctx(now = '2026-11-15T12:00:00Z'): Context {
  return { now: new Date(now), newId: () => `e${++n}` };
}

const buyer = { appUserId: 'u1', householdId: 'h1', productId: 'pm_premium_monthly' as const };

function trial(): MockSubscription {
  return purchase(null, buyer, ctx()).subscription;
}

Deno.test('the first purchase starts the 14-day trial', () => {
  const step = purchase(null, buyer, ctx());
  assertEquals(
    step.events.map((e) => e.type),
    ['INITIAL_PURCHASE'],
  );
  assertEquals(step.events[0].period_type, 'TRIAL');
  assertEquals(step.events[0].source, 'mock');
  assertEquals(step.subscription.expiresAt.toISOString(), '2026-11-29T12:00:00.000Z');
  assertEquals(step.subscription.willRenew, true);
});

Deno.test('a store account gets one trial, and cannot buy twice while subscribed', () => {
  const sub = trial();
  assertThrows(() => purchase(sub, buyer, ctx()), StoreError, 'billing.already_subscribed');
  const ended = { ...sub, endedAt: sub.expiresAt };
  const again = purchase(ended, buyer, ctx());
  assertEquals(again.subscription.periodType, 'NORMAL');
});

Deno.test('the test clock converts the trial at its end', () => {
  const step = advance(trial(), 'trial_end', ctx());
  assertEquals(
    step.events.map((e) => e.type),
    ['RENEWAL'],
  );
  assertEquals(step.events[0].is_trial_conversion, true);
  assertEquals(step.subscription.periodType, 'NORMAL');
  assertEquals(step.subscription.expiresAt.toISOString(), '2026-12-29T12:00:00.000Z');
});

Deno.test('renewal uses a pending plan switch', () => {
  let sub = advance(trial(), 'trial_end', ctx()).subscription;
  const change = manage(sub, 'change_product', ctx(), 'pm_premium_annual');
  assertEquals(change.events[0].type, 'PRODUCT_CHANGE');
  assertEquals(change.events[0].new_product_id, 'pm_premium_annual');
  sub = change.subscription;
  const renewal = advance(sub, 'renewal', ctx());
  assertEquals(renewal.subscription.productId, 'pm_premium_annual');
  assertEquals(renewal.events[0].is_trial_conversion, false);
  assertEquals(
    renewal.subscription.expiresAt.toISOString(),
    addMonths(sub.expiresAt, 12).toISOString(),
  );
});

Deno.test('cancel keeps the subscription until period end, then it expires', () => {
  const cancel = manage(trial(), 'cancel', ctx());
  assertEquals(cancel.events[0].type, 'CANCELLATION');
  assertEquals(cancel.events[0].cancel_reason, 'UNSUBSCRIBE');
  assertEquals(cancel.subscription.endedAt, null);
  assertThrows(() => manage(cancel.subscription, 'cancel', ctx()), StoreError);
  const uncancel = manage(cancel.subscription, 'uncancel', ctx());
  assertEquals(uncancel.events[0].type, 'UNCANCELLATION');
  assertEquals(uncancel.subscription.willRenew, true);
  const expired = advance(cancel.subscription, 'renewal', ctx());
  assertEquals(
    expired.events.map((e) => e.type),
    ['EXPIRATION'],
  );
  assertEquals(expired.subscription.endedAt !== null, true);
});

Deno.test('a billing issue starts a 16-day grace period, then expiry', () => {
  const issue = advance(trial(), 'billing_issue', ctx());
  assertEquals(
    issue.events.map((e) => e.type),
    ['BILLING_ISSUE'],
  );
  assertEquals(issue.events[0].grace_period_expiration_at, '2026-12-15T12:00:00.000Z');
  assertEquals(issue.subscription.endedAt, null);
  assertThrows(() => advance(issue.subscription, 'renewal', ctx()), StoreError);
  const end = advance(issue.subscription, 'grace_end', ctx());
  assertEquals(
    end.events.map((e) => e.type),
    ['EXPIRATION'],
  );
  assertEquals(end.events[0].expiration_reason, 'BILLING_ERROR');
});

Deno.test('fixing the payment during grace renews', () => {
  const issue = advance(trial(), 'billing_issue', ctx()).subscription;
  const fixed = manage(issue, 'fix_payment', ctx());
  assertEquals(
    fixed.events.map((e) => e.type),
    ['RENEWAL'],
  );
  assertEquals(fixed.subscription.billingIssueAt, null);
});

Deno.test('the expiry target cancels first if needed, then expires', () => {
  const step = advance(trial(), 'expiry', ctx());
  assertEquals(
    step.events.map((e) => e.type),
    ['CANCELLATION', 'EXPIRATION'],
  );
  assertThrows(
    () => advance(step.subscription, 'renewal', ctx()),
    StoreError,
    'billing.no_active_subscription',
  );
});

Deno.test('a refund ends the subscription at once', () => {
  const step = manage(trial(), 'refund', ctx());
  assertEquals(step.events[0].cancel_reason, 'CUSTOMER_SUPPORT');
  assertEquals(step.subscription.endedAt !== null, true);
});

Deno.test('real time passing renews as a store would', () => {
  const sub = advance(trial(), 'trial_end', ctx()).subscription; // ends 2026-12-29
  const later = catchUp(sub, ctx('2027-02-01T00:00:00Z'));
  assertEquals(
    later.events.map((e) => e.type),
    ['RENEWAL', 'RENEWAL'],
  );
  assertEquals(later.subscription.expiresAt.toISOString(), '2027-02-28T12:00:00.000Z');
});

Deno.test('month arithmetic clamps to the last day', () => {
  assertEquals(
    addMonths(new Date('2027-01-31T00:00:00Z'), 1).toISOString(),
    '2027-02-28T00:00:00.000Z',
  );
});
