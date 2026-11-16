// The one path that changes a household's entitlement: the database function
// public.apply_subscription_event (migration 20261119100000), which only the service role
// can call. It is idempotent on the event ID. The mock store and RevenueCat's webhook both
// use it.

import type { SubscriptionEvent } from './events.ts';

export type ApplyOutcome = 'applied' | 'duplicate' | 'stale' | 'ignored' | 'unknown_household';

export interface EventSink {
  apply(event: SubscriptionEvent): Promise<ApplyOutcome>;
}

/** The parts of a supabase-js client the sink uses. */
export interface RpcClient {
  rpc(fn: string, args: Record<string, unknown>): PromiseLike<{ data: unknown; error: unknown }>;
}

export function createEventSink(client: RpcClient): EventSink {
  return {
    async apply(event) {
      const { data, error } = await client.rpc('apply_subscription_event', { event });
      if (error) throw new Error('apply_subscription_event failed');
      return (data as { outcome: ApplyOutcome }).outcome;
    },
  };
}
