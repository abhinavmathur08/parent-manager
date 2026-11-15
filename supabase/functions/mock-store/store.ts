// The mock store's subscription lifecycle (M-01.2, D-10 interim). Pure functions: each step
// takes a subscription and returns its next state plus the RevenueCat-style events a real
// store would send. Nothing here touches the database or charges anyone.
//
// Time: each subscription has its own clock. It never runs behind the real time, and the test
// clock moves it forward to the next renewal, trial end, billing issue, grace end or expiry,
// so testers can see every lifecycle state without waiting a month.

import type { SubscriptionEvent } from '../_shared/billing/events.ts';
import {
  addDays,
  GRACE_DAYS,
  periodEnd,
  type ProductId,
  TRIAL_DAYS,
} from '../_shared/billing/products.ts';

export interface MockSubscription {
  appUserId: string;
  householdId: string;
  productId: ProductId;
  periodType: 'NORMAL' | 'TRIAL';
  originalPurchasedAt: Date;
  periodStartedAt: Date;
  expiresAt: Date;
  willRenew: boolean;
  unsubscribedAt: Date | null;
  billingIssueAt: Date | null;
  graceEndsAt: Date | null;
  pendingProductId: ProductId | null;
  failNextRenewal: boolean;
  endedAt: Date | null;
  hadTrial: boolean;
  clockAt: Date;
}

export interface Step {
  subscription: MockSubscription;
  events: SubscriptionEvent[];
}

/** A request the store refuses, with a stable code for the app. */
export class StoreError extends Error {
  constructor(
    readonly code: string,
    readonly status = 409,
  ) {
    super(code);
    this.name = 'StoreError';
  }
}

export type ClockTarget = 'renewal' | 'trial_end' | 'billing_issue' | 'grace_end' | 'expiry';
export const CLOCK_TARGETS: readonly ClockTarget[] = [
  'renewal',
  'trial_end',
  'billing_issue',
  'grace_end',
  'expiry',
];

export type Operation = 'cancel' | 'uncancel' | 'change_product' | 'refund' | 'fix_payment';
export const OPERATIONS: readonly Operation[] = [
  'cancel',
  'uncancel',
  'change_product',
  'refund',
  'fix_payment',
];

export interface Context {
  /** The real time. */
  now: Date;
  newId: () => string;
}

function maxDate(a: Date, b: Date): Date {
  return a.getTime() >= b.getTime() ? a : b;
}

function inGrace(sub: MockSubscription): boolean {
  return sub.billingIssueAt !== null && sub.graceEndsAt !== null;
}

function event(
  ctx: Context,
  sub: MockSubscription,
  type: SubscriptionEvent['type'],
  extra: Partial<SubscriptionEvent> = {},
): SubscriptionEvent {
  return {
    id: ctx.newId(),
    type,
    source: 'mock',
    store: 'MOCK_STORE',
    household_id: sub.householdId,
    app_user_id: sub.appUserId,
    product_id: sub.productId,
    period_type: sub.periodType,
    purchased_at: sub.periodStartedAt.toISOString(),
    expiration_at: sub.expiresAt.toISOString(),
    event_at: ctx.now.toISOString(),
    ...extra,
  };
}

/** A purchase. The store account gets one free trial, ever (like an introductory offer). */
export function purchase(
  existing: MockSubscription | null,
  input: { appUserId: string; householdId: string; productId: ProductId },
  ctx: Context,
): Step {
  if (existing && !existing.endedAt) throw new StoreError('billing.already_subscribed');
  const at = existing ? maxDate(existing.clockAt, ctx.now) : ctx.now;
  const trial = !existing?.hadTrial;
  const sub: MockSubscription = {
    appUserId: input.appUserId,
    householdId: input.householdId,
    productId: input.productId,
    periodType: trial ? 'TRIAL' : 'NORMAL',
    originalPurchasedAt: at,
    periodStartedAt: at,
    expiresAt: trial ? addDays(at, TRIAL_DAYS) : periodEnd(input.productId, at),
    willRenew: true,
    unsubscribedAt: null,
    billingIssueAt: null,
    graceEndsAt: null,
    pendingProductId: null,
    failNextRenewal: false,
    endedAt: null,
    hadTrial: true,
    clockAt: at,
  };
  return { subscription: sub, events: [event(ctx, sub, 'INITIAL_PURCHASE')] };
}

/**
 * Lets the subscription's time pass up to `until` (or the real time, if later): renewals,
 * trial conversions, billing issues and expiries happen as a store's would.
 */
export function catchUp(start: MockSubscription, ctx: Context, until?: Date): Step {
  let sub = { ...start };
  const events: SubscriptionEvent[] = [];
  const t = maxDate(maxDate(sub.clockAt, ctx.now), until ?? ctx.now);

  while (!sub.endedAt) {
    if (inGrace(sub)) {
      if (sub.graceEndsAt!.getTime() > t.getTime()) break;
      sub = { ...sub, expiresAt: sub.graceEndsAt!, endedAt: sub.graceEndsAt, willRenew: false };
      events.push(event(ctx, sub, 'EXPIRATION', { expiration_reason: 'BILLING_ERROR' }));
      break;
    }
    if (sub.expiresAt.getTime() > t.getTime()) break;

    if (!sub.willRenew) {
      sub = { ...sub, endedAt: sub.expiresAt, pendingProductId: null };
      events.push(event(ctx, sub, 'EXPIRATION', { expiration_reason: 'UNSUBSCRIBE' }));
    } else if (sub.failNextRenewal) {
      sub = {
        ...sub,
        failNextRenewal: false,
        billingIssueAt: sub.expiresAt,
        graceEndsAt: addDays(sub.expiresAt, GRACE_DAYS),
      };
      events.push(
        event(ctx, sub, 'BILLING_ISSUE', {
          grace_period_expiration_at: sub.graceEndsAt!.toISOString(),
        }),
      );
    } else {
      const conversion = sub.periodType === 'TRIAL';
      sub = renew(sub, sub.expiresAt);
      events.push(event(ctx, sub, 'RENEWAL', { is_trial_conversion: conversion }));
    }
  }
  return { subscription: { ...sub, clockAt: t }, events };
}

function renew(sub: MockSubscription, at: Date): MockSubscription {
  const productId = sub.pendingProductId ?? sub.productId;
  return {
    ...sub,
    productId,
    pendingProductId: null,
    periodType: 'NORMAL',
    periodStartedAt: at,
    expiresAt: periodEnd(productId, at),
    billingIssueAt: null,
    graceEndsAt: null,
  };
}

function requireLive(sub: MockSubscription | null): MockSubscription {
  if (!sub || sub.endedAt) throw new StoreError('billing.no_active_subscription', 404);
  return sub;
}

/** The test clock: jumps to the next lifecycle moment. */
export function advance(current: MockSubscription | null, to: ClockTarget, ctx: Context): Step {
  const caught = catchUp(requireLive(current), ctx);
  const sub = requireLive(caught.subscription);
  const events = [...caught.events];
  const invalid = () => new StoreError('billing.clock_not_applicable');

  switch (to) {
    case 'renewal':
      if (inGrace(sub)) throw invalid();
      return merge(events, catchUp(sub, ctx, sub.expiresAt));
    case 'trial_end':
      if (sub.periodType !== 'TRIAL' || inGrace(sub)) throw invalid();
      return merge(events, catchUp(sub, ctx, sub.expiresAt));
    case 'billing_issue':
      if (inGrace(sub) || !sub.willRenew) throw invalid();
      return merge(events, catchUp({ ...sub, failNextRenewal: true }, ctx, sub.expiresAt));
    case 'grace_end':
      if (!inGrace(sub)) throw invalid();
      return merge(events, catchUp(sub, ctx, sub.graceEndsAt!));
    case 'expiry': {
      // Like a parent turning off auto-renew and the period running out.
      let next = sub;
      if (sub.willRenew) {
        next = { ...sub, willRenew: false, unsubscribedAt: sub.clockAt };
        events.push(event(ctx, next, 'CANCELLATION', { cancel_reason: 'UNSUBSCRIBE' }));
      }
      return merge(events, catchUp(next, ctx, inGrace(next) ? next.graceEndsAt! : next.expiresAt));
    }
  }
}

/** What a parent can do in the store's subscription settings (or support, for a refund). */
export function manage(
  current: MockSubscription | null,
  operation: Operation,
  ctx: Context,
  productId?: ProductId,
): Step {
  const caught = catchUp(requireLive(current), ctx);
  const sub = requireLive(caught.subscription);
  const events = [...caught.events];
  const invalid = () => new StoreError('billing.operation_not_applicable');

  switch (operation) {
    case 'cancel': {
      if (!sub.willRenew) throw invalid();
      const next = { ...sub, willRenew: false, unsubscribedAt: sub.clockAt };
      events.push(event(ctx, next, 'CANCELLATION', { cancel_reason: 'UNSUBSCRIBE' }));
      return { subscription: next, events };
    }
    case 'uncancel': {
      if (sub.willRenew) throw invalid();
      const next = { ...sub, willRenew: true, unsubscribedAt: null };
      events.push(event(ctx, next, 'UNCANCELLATION'));
      return { subscription: next, events };
    }
    case 'change_product': {
      if (!productId) throw new StoreError('billing.unknown_product', 400);
      const pending = productId === sub.productId ? null : productId;
      if (pending === sub.pendingProductId) throw invalid();
      const next = { ...sub, pendingProductId: pending };
      events.push(event(ctx, next, 'PRODUCT_CHANGE', { new_product_id: productId }));
      return { subscription: next, events };
    }
    case 'refund': {
      const next = { ...sub, willRenew: false, expiresAt: sub.clockAt, endedAt: sub.clockAt };
      events.push(event(ctx, next, 'CANCELLATION', { cancel_reason: 'CUSTOMER_SUPPORT' }));
      return { subscription: next, events };
    }
    case 'fix_payment': {
      if (!inGrace(sub)) throw invalid();
      const next = renew(sub, sub.clockAt);
      events.push(event(ctx, next, 'RENEWAL'));
      return { subscription: next, events };
    }
  }
}

function merge(before: SubscriptionEvent[], step: Step): Step {
  return { subscription: step.subscription, events: [...before, ...step.events] };
}

/** The subscription as the app sees it (src/lib/billing/mock-provider.ts). */
export function view(sub: MockSubscription) {
  return {
    productId: sub.productId,
    householdId: sub.householdId,
    periodType: sub.periodType,
    originalPurchasedAt: sub.originalPurchasedAt.toISOString(),
    periodStartedAt: sub.periodStartedAt.toISOString(),
    expiresAt: sub.expiresAt.toISOString(),
    willRenew: sub.willRenew,
    unsubscribedAt: sub.unsubscribedAt?.toISOString() ?? null,
    billingIssueAt: sub.billingIssueAt?.toISOString() ?? null,
    gracePeriodEndsAt: sub.graceEndsAt?.toISOString() ?? null,
    pendingProductId: sub.pendingProductId,
    isActive: sub.endedAt === null,
  };
}
