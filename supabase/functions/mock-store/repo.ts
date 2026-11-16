// The mock store's storage (public.mock_store_subscriptions) and the household checks it
// needs, through the service-role client. Clients can't reach any of it.

import type { AdminClient } from '../_shared/admin.ts';
import type { SubscriptionEvent } from '../_shared/billing/events.ts';
import { isProductId, type ProductId } from '../_shared/billing/products.ts';
import type { MockSubscription } from './store.ts';

/** An event held back to imitate a delayed webhook, and when it may go out. */
export interface HeldEvent {
  event: SubscriptionEvent;
  releaseAt: string;
}

export interface Stored {
  subscription: MockSubscription;
  held: HeldEvent[];
  lastEvent: SubscriptionEvent | null;
}

export interface StoreRepo {
  /** The store account's subscription (one per account), or null. */
  forUser(appUserId: string): Promise<Stored | null>;
  /** The household's live subscription, or its latest one. */
  forHousehold(householdId: string): Promise<Stored | null>;
  /** Saves; throws `LiveSubscriptionExists` if the household already has a live one. */
  save(stored: Stored): Promise<void>;
  /** Whether the user is an active parent of the household (only parents buy, FR-PAY-4). */
  isParent(userId: string, householdId: string): Promise<boolean>;
  /** The household's tier from household_entitlements. */
  tier(householdId: string): Promise<'free' | 'premium' | null>;
}

export class LiveSubscriptionExists extends Error {}

type Row = {
  app_user_id: string;
  household_id: string;
  product_id: string;
  period_type: 'NORMAL' | 'TRIAL';
  original_purchased_at: string;
  period_started_at: string;
  expires_at: string;
  will_renew: boolean;
  unsubscribed_at: string | null;
  billing_issue_at: string | null;
  grace_ends_at: string | null;
  pending_product_id: string | null;
  fail_next_renewal: boolean;
  ended_at: string | null;
  had_trial: boolean;
  clock_at: string;
  pending_events: HeldEvent[];
  last_event: SubscriptionEvent | null;
};

const date = (value: string | null) => (value === null ? null : new Date(value));
const product = (value: string | null): ProductId | null => (isProductId(value) ? value : null);

export function fromRow(row: Row): Stored {
  return {
    subscription: {
      appUserId: row.app_user_id,
      householdId: row.household_id,
      productId: product(row.product_id) ?? 'pm_premium_monthly',
      periodType: row.period_type,
      originalPurchasedAt: new Date(row.original_purchased_at),
      periodStartedAt: new Date(row.period_started_at),
      expiresAt: new Date(row.expires_at),
      willRenew: row.will_renew,
      unsubscribedAt: date(row.unsubscribed_at),
      billingIssueAt: date(row.billing_issue_at),
      graceEndsAt: date(row.grace_ends_at),
      pendingProductId: product(row.pending_product_id),
      failNextRenewal: row.fail_next_renewal,
      endedAt: date(row.ended_at),
      hadTrial: row.had_trial,
      clockAt: new Date(row.clock_at),
    },
    held: row.pending_events ?? [],
    lastEvent: row.last_event,
  };
}

export function toRow({ subscription: s, held, lastEvent }: Stored): Row {
  const iso = (value: Date | null) => value?.toISOString() ?? null;
  return {
    app_user_id: s.appUserId,
    household_id: s.householdId,
    product_id: s.productId,
    period_type: s.periodType,
    original_purchased_at: s.originalPurchasedAt.toISOString(),
    period_started_at: s.periodStartedAt.toISOString(),
    expires_at: s.expiresAt.toISOString(),
    will_renew: s.willRenew,
    unsubscribed_at: iso(s.unsubscribedAt),
    billing_issue_at: iso(s.billingIssueAt),
    grace_ends_at: iso(s.graceEndsAt),
    pending_product_id: s.pendingProductId,
    fail_next_renewal: s.failNextRenewal,
    ended_at: iso(s.endedAt),
    had_trial: s.hadTrial,
    clock_at: s.clockAt.toISOString(),
    pending_events: held,
    last_event: lastEvent,
  };
}

const TABLE = 'mock_store_subscriptions';

export function createStoreRepo(admin: AdminClient): StoreRepo {
  async function rows(query: Record<string, string>): Promise<Row[]> {
    const { data, error } = await admin.select<Row>(TABLE, { select: '*', ...query });
    if (error) throw new Error('mock store read failed');
    return data ?? [];
  }
  return {
    async forUser(appUserId) {
      const [row] = await rows({ app_user_id: `eq.${appUserId}` });
      return row ? fromRow(row) : null;
    },
    async forHousehold(householdId) {
      const [row] = await rows({
        household_id: `eq.${householdId}`,
        order: 'ended_at.desc.nullsfirst,updated_at.desc',
        limit: '1',
      });
      return row ? fromRow(row) : null;
    },
    async save(stored) {
      const { error } = await admin.upsert(TABLE, toRow(stored));
      if (error) {
        if (error.code === '23505') throw new LiveSubscriptionExists();
        throw new Error('mock store write failed');
      }
    },
    async isParent(userId, householdId) {
      const { data, error } = await admin.select<{ role: string }>('household_members', {
        select: 'role',
        household_id: `eq.${householdId}`,
        user_id: `eq.${userId}`,
        status: 'eq.active',
        deleted_at: 'is.null',
      });
      if (error) throw new Error('membership read failed');
      return data?.[0]?.role === 'parent';
    },
    async tier(householdId) {
      const { data, error } = await admin.select<{ tier: 'free' | 'premium' }>(
        'household_entitlements',
        { select: 'tier', household_id: `eq.${householdId}` },
      );
      if (error) throw new Error('entitlement read failed');
      return data?.[0]?.tier ?? null;
    },
  };
}
