// Subscription events, normalized from RevenueCat's webhook event types (architecture
// section 8). The mock store creates them directly; RevenueCat's webhook payloads are
// converted with `fromRevenueCat`. Both reach the database through `apply.ts`.
//
// Events hold IDs, product codes and dates only: never names, emails or prices.

export type EventType =
  | 'INITIAL_PURCHASE'
  | 'RENEWAL'
  | 'CANCELLATION'
  | 'UNCANCELLATION'
  | 'BILLING_ISSUE'
  | 'EXPIRATION'
  | 'PRODUCT_CHANGE';

export type EventSource = 'mock' | 'revenuecat';
export type EventStore = 'MOCK_STORE' | 'APP_STORE' | 'PLAY_STORE';

export interface SubscriptionEvent {
  id: string;
  type: EventType | string;
  source: EventSource;
  store: EventStore | null;
  household_id: string | null;
  app_user_id: string | null;
  product_id: string | null;
  new_product_id?: string | null;
  period_type: 'NORMAL' | 'TRIAL';
  purchased_at: string | null;
  expiration_at: string | null;
  event_at: string;
  grace_period_expiration_at?: string | null;
  /** UNSUBSCRIBE, BILLING_ERROR, or CUSTOMER_SUPPORT for a refund. */
  cancel_reason?: string | null;
  expiration_reason?: string | null;
  is_trial_conversion?: boolean;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function iso(ms: unknown): string | null {
  return typeof ms === 'number' && Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 && value.length <= 200 ? value : null;
}

const STORES: Record<string, EventStore> = { APP_STORE: 'APP_STORE', PLAY_STORE: 'PLAY_STORE' };

/**
 * Converts a RevenueCat webhook body (`{ api_version, event }`) into a normalized event, or
 * null if it isn't one. The household comes from the `household_id` subscriber attribute the
 * app sets at purchase (architecture section 8). Only the fields listed above are kept.
 */
export function fromRevenueCat(body: unknown): SubscriptionEvent | null {
  const event = (body as { event?: Record<string, unknown> } | null)?.event;
  if (!event || typeof event !== 'object') return null;
  const id = text(event.id);
  const type = text(event.type);
  const eventAt = iso(event.event_timestamp_ms);
  if (!id || !type || !eventAt) return null;

  const attributes = event.subscriber_attributes as
    Record<string, { value?: unknown } | undefined> | undefined;
  const household = text(attributes?.household_id?.value);
  const appUser = text(event.app_user_id);

  return {
    id,
    type,
    source: 'revenuecat',
    store: STORES[String(event.store)] ?? null,
    household_id: household && UUID.test(household) ? household : null,
    app_user_id: appUser && UUID.test(appUser) ? appUser : null,
    product_id: text(event.product_id),
    new_product_id: text(event.new_product_id),
    period_type: event.period_type === 'TRIAL' ? 'TRIAL' : 'NORMAL',
    purchased_at: iso(event.purchased_at_ms),
    expiration_at: iso(event.expiration_at_ms),
    event_at: eventAt,
    grace_period_expiration_at: iso(event.grace_period_expiration_at_ms),
    cancel_reason: text(event.cancel_reason),
    expiration_reason: text(event.expiration_reason),
    is_trial_conversion: event.is_trial_conversion === true,
  };
}
