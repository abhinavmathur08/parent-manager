import Storage from 'expo-sqlite/kv-store';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

import { useAuth } from '@/features/auth/session';
import { onSignOut } from '@/features/auth/sign-out';
import { REGIONS } from '@/features/household/region';
import { setAppLocale, SUPPORTED_LOCALES, type AppLocale, type Region } from '@/i18n';
import { getSupabase } from '@/lib/supabase';
import { resetSync } from '@/lib/sync';

/** The household the signed-in user belongs to. Phase 1 allows one per account. */
export type Membership = { householdId: string; region: Region; locale: AppLocale };

export type HouseholdState =
  | { status: 'loading' }
  | { status: 'none' }
  | { status: 'member'; membership: Membership }
  /** Not known yet and the server can't be reached, for example a new device offline. */
  | { status: 'error' };

type HouseholdContextValue = { state: HouseholdState; refresh: () => Promise<void> };

const HouseholdContext = createContext<HouseholdContextValue>({
  state: { status: 'loading' },
  refresh: async () => undefined,
});

// The last known membership, so a signed-in user opens straight into the app offline.
// It holds IDs and settings only, and sign-out removes it.
const CACHE_KEY = 'household.membership';

type Cached = Membership & { userId: string };

function readCache(userId: string): Membership | null {
  try {
    const stored = Storage.getItemSync(CACHE_KEY);
    if (!stored) return null;
    const { userId: owner, ...membership } = JSON.parse(stored) as Cached;
    return owner === userId ? membership : null;
  } catch {
    return null;
  }
}

function writeCache(userId: string, membership: Membership | null) {
  try {
    if (membership) Storage.setItemSync(CACHE_KEY, JSON.stringify({ ...membership, userId }));
    else Storage.removeItemSync(CACHE_KEY);
  } catch {
    // The cache only saves a round trip.
  }
}

onSignOut(() => writeCache('', null));

type Row = { household_id: string; households: { region: string; locale: string } | null };

/** Reads the caller's active membership. RLS returns only households they belong to. */
export async function fetchMembership(userId: string): Promise<Membership | null> {
  const { data, error } = await getSupabase()
    .from('household_members')
    .select('household_id, households(region, locale)')
    .eq('user_id', userId)
    .eq('status', 'active')
    .is('deleted_at', null)
    .limit(1)
    .maybeSingle<Row>();
  if (error) throw error;
  const household = data?.households;
  if (!data || !household) return null;
  const region = (REGIONS as readonly string[]).includes(household.region)
    ? (household.region as Region)
    : 'US';
  const locale = (SUPPORTED_LOCALES as readonly string[]).includes(household.locale)
    ? (household.locale as AppLocale)
    : 'en-US';
  return { householdId: data.household_id, region, locale };
}

/** Follows whether the signed-in user has a household, for the onboarding guard (FR-ONB-1). */
export function HouseholdProvider({ children }: { children: ReactNode }) {
  const auth = useAuth();
  const userId = auth.status === 'signedIn' ? auth.session.user.id : null;
  const [fetched, setFetched] = useState<{ userId: string; state: HouseholdState } | null>(null);

  const load = useCallback(async (): Promise<{ userId: string; state: HouseholdState } | null> => {
    if (!userId) return null;
    try {
      const membership = await fetchMembership(userId);
      // Removed from the household: its data leaves this device too (H-06.4).
      if (!membership && readCache(userId)) void resetSync().catch(() => undefined);
      writeCache(userId, membership);
      return { userId, state: membership ? { status: 'member', membership } : { status: 'none' } };
    } catch {
      // Offline: keep the last known membership, or say it couldn't be loaded.
      const cached = readCache(userId);
      return {
        userId,
        state: cached ? { status: 'member', membership: cached } : { status: 'error' },
      };
    }
  }, [userId]);

  const refresh = useCallback(async () => {
    const result = await load();
    if (result) setFetched(result);
  }, [load]);

  useEffect(() => {
    let active = true;
    load().then((result) => {
      if (active && result) setFetched(result);
    });
    return () => {
      active = false;
    };
  }, [load]);

  const state = useMemo<HouseholdState>(() => {
    if (!userId) return { status: 'none' };
    if (fetched?.userId === userId) return fetched.state;
    const cached = readCache(userId);
    return cached ? { status: 'member', membership: cached } : { status: 'loading' };
  }, [fetched, userId]);

  const locale = state.status === 'member' ? state.membership.locale : null;
  useEffect(() => {
    // The household's region sets the app's locale (FR-ONB-2).
    if (locale) setAppLocale(locale);
  }, [locale]);

  const value = useMemo(() => ({ state, refresh }), [state, refresh]);
  return <HouseholdContext.Provider value={value}>{children}</HouseholdContext.Provider>;
}

export function useHousehold(): HouseholdContextValue {
  return useContext(HouseholdContext);
}
