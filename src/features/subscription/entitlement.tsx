import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { AppState } from 'react-native';

import { useAuth } from '@/features/auth/session';
import { useHousehold } from '@/features/household/membership';
import { getBilling } from '@/lib/billing';
import { getSupabase } from '@/lib/supabase';

/**
 * The household's entitlement (M-01.2, FR-PAY-1). The tier always comes from
 * `household_entitlements` on the server, never from the store on this device, so every
 * member sees the same tier. A change reaches every member's device within 60 seconds
 * (FR-PAY-8): Realtime delivers it at once, and the app checks again when it comes to the
 * foreground and every minute while it's open, in case Realtime is down.
 */
export type EntitlementStatus =
  'none' | 'trialing' | 'active' | 'grace_period' | 'expired' | 'refunded';

export type Entitlement = {
  tier: 'free' | 'premium';
  status: EntitlementStatus;
  source: 'mock' | 'revenuecat' | null;
  productId: string | null;
  pendingProductId: string | null;
  periodEndsAt: string | null;
  trialEndsAt: string | null;
  graceEndsAt: string | null;
  willRenew: boolean;
  purchaserUserId: string | null;
};

type Row = {
  tier: Entitlement['tier'];
  status: EntitlementStatus;
  source: Entitlement['source'];
  product_id: string | null;
  pending_product_id: string | null;
  period_ends_at: string | null;
  trial_ends_at: string | null;
  grace_ends_at: string | null;
  will_renew: boolean;
  purchaser_user_id: string | null;
};

const COLUMNS =
  'tier, status, source, product_id, pending_product_id, period_ends_at, trial_ends_at, grace_ends_at, will_renew, purchaser_user_id';

/** How often an open app checks the tier when Realtime is quiet (FR-PAY-8: 60 seconds). */
export const ENTITLEMENT_POLL_MS = 60_000;

export function toEntitlement(row: Row): Entitlement {
  return {
    tier: row.tier,
    status: row.status,
    source: row.source,
    productId: row.product_id,
    pendingProductId: row.pending_product_id,
    periodEndsAt: row.period_ends_at,
    trialEndsAt: row.trial_ends_at,
    graceEndsAt: row.grace_ends_at,
    willRenew: row.will_renew,
    purchaserUserId: row.purchaser_user_id,
  };
}

export async function fetchEntitlement(householdId: string): Promise<Entitlement | null> {
  const { data, error } = await getSupabase()
    .from('household_entitlements')
    .select(COLUMNS)
    .eq('household_id', householdId)
    .maybeSingle<Row>();
  if (error) throw error;
  return data ? toEntitlement(data) : null;
}

type EntitlementContextValue = {
  /** Null until loaded. Offline, the last value loaded stays. */
  entitlement: Entitlement | null;
  isPremium: boolean;
  refresh: () => Promise<Entitlement | null>;
};

const EntitlementContext = createContext<EntitlementContextValue>({
  entitlement: null,
  isPremium: false,
  refresh: async () => null,
});

export function EntitlementProvider({ children }: { children: ReactNode }) {
  const auth = useAuth();
  const { state } = useHousehold();
  const userId = auth.status === 'signedIn' ? auth.session.user.id : null;
  const householdId = state.status === 'member' ? state.membership.householdId : null;
  const [loaded, setLoaded] = useState<{ householdId: string; value: Entitlement | null } | null>(
    null,
  );

  // The store account is the Supabase user, buying for the household (architecture 8).
  useEffect(() => {
    const billing = getBilling();
    if (!userId) {
      void billing.logOut();
      return;
    }
    void billing.logIn(userId);
    if (householdId) void billing.setAttributes({ household_id: householdId });
  }, [userId, householdId]);

  const refresh = useCallback(async () => {
    if (!householdId) return null;
    try {
      const value = await fetchEntitlement(householdId);
      setLoaded({ householdId, value });
      return value;
    } catch {
      return null; // Offline: keep the last known tier.
    }
  }, [householdId]);

  useEffect(() => {
    if (!householdId) return;
    let active = true;
    fetchEntitlement(householdId).then(
      (value) => {
        if (active) setLoaded({ householdId, value });
      },
      () => undefined, // Offline: keep the last known tier.
    );

    // Realtime delivers a change at once. Without a configured backend there is none.
    let unsubscribe = () => {};
    try {
      const client = getSupabase();
      const channel = client
        .channel(`entitlement:${householdId}`)
        .on(
          'postgres_changes',
          {
            event: '*',
            schema: 'public',
            table: 'household_entitlements',
            filter: `household_id=eq.${householdId}`,
          },
          (payload) => {
            if (payload.eventType !== 'DELETE') {
              setLoaded({ householdId, value: toEntitlement(payload.new as Row) });
            }
          },
        )
        .subscribe();
      unsubscribe = () => void client.removeChannel(channel);
    } catch {
      // Not configured (tests, or a build without Supabase): the timer still checks.
    }

    let timer: ReturnType<typeof setInterval> | null = setInterval(refresh, ENTITLEMENT_POLL_MS);
    const appState = AppState.addEventListener('change', (next) => {
      if (next === 'active') {
        void refresh();
        timer ??= setInterval(refresh, ENTITLEMENT_POLL_MS);
      } else if (timer) {
        clearInterval(timer);
        timer = null;
      }
    });

    return () => {
      active = false;
      if (timer) clearInterval(timer);
      appState.remove();
      unsubscribe();
    };
  }, [householdId, refresh]);

  const entitlement = loaded && loaded.householdId === householdId ? loaded.value : null;
  const value = useMemo(
    () => ({ entitlement, isPremium: entitlement?.tier === 'premium', refresh }),
    [entitlement, refresh],
  );
  return <EntitlementContext.Provider value={value}>{children}</EntitlementContext.Provider>;
}

export function useEntitlement(): EntitlementContextValue {
  return useContext(EntitlementContext);
}
