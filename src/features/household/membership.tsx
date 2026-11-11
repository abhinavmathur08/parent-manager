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
import { AppState } from 'react-native';

import { useAuth } from '@/features/auth/session';
import { onSignOut } from '@/features/auth/sign-out';
import { clearHouseholdData, removalSeen } from '@/features/household/access-lost';
import { MEMBER_ROLES, type MemberRole } from '@/features/household/invitations';
import { fetchMembershipStatus } from '@/features/household/leave';
import { REGIONS } from '@/features/household/region';
import {
  setAppLocale,
  SUPPORTED_LOCALES,
  type AppLocale,
  type Region,
  type UnitSystem,
} from '@/i18n';
import { getSupabase } from '@/lib/supabase';

/** The household the signed-in user belongs to. Phase 1 allows one per account. */
export type Membership = {
  householdId: string;
  role: MemberRole;
  region: Region;
  locale: AppLocale;
  /** How quantities are shown (FR-HH-15). Stored quantities are always in base units. */
  unitSystem: UnitSystem;
  /** ISO weekday the week starts on: 1 is Monday, 7 is Sunday. */
  weekStart: 1 | 7;
};

export type HouseholdState =
  | { status: 'loading' }
  | { status: 'none' }
  | { status: 'member'; membership: Membership }
  /** Access ended: removed by a parent, or paused while the household is on Free (S-35). */
  | {
      status: 'ended';
      reason: 'removed' | 'paused';
      householdId: string;
      householdName: string;
    }
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
    // A cache from before roles were saved is ignored, so the next load fills it in.
    return owner === userId && membership.role && membership.unitSystem ? membership : null;
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

type Row = {
  household_id: string;
  role: string;
  households: {
    region: string;
    locale: string;
    unit_system: string;
    week_start: number;
  } | null;
};

/** Reads the caller's active membership. RLS returns only households they belong to. */
export async function fetchMembership(userId: string): Promise<Membership | null> {
  const { data, error } = await getSupabase()
    .from('household_members')
    .select('household_id, role, households(region, locale, unit_system, week_start)')
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
  const role = (MEMBER_ROLES as readonly string[]).includes(data.role)
    ? (data.role as MemberRole)
    : 'caregiver';
  return {
    householdId: data.household_id,
    role,
    region,
    locale,
    unitSystem: household.unit_system === 'metric' ? 'metric' : 'us_customary',
    weekStart: household.week_start === 1 ? 1 : 7,
  };
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
      const hadHousehold = readCache(userId) !== null;
      writeCache(userId, membership);
      if (membership) return { userId, state: { status: 'member', membership } };
      // Access ended on another device or by a parent: clear this device's copy (FR-HH-10).
      if (hadHousehold) await clearHouseholdData();
      // RLS hides a removed or paused membership, so ask the server why there's none.
      const status = await fetchMembershipStatus();
      if (
        status.status === 'paused' ||
        (status.status === 'removed' && !removalSeen(userId, status.householdId))
      ) {
        return {
          userId,
          state: {
            status: 'ended',
            reason: status.status,
            householdId: status.householdId,
            householdName: status.householdName,
          },
        };
      }
      return { userId, state: { status: 'none' } };
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
    const update = () =>
      load().then((result) => {
        if (active && result) setFetched(result);
      });
    update();
    // Check again whenever the app comes back, so a removed member finds out (FR-HH-10).
    const subscription = AppState.addEventListener('change', (next) => {
      if (next === 'active') update();
    });
    return () => {
      active = false;
      subscription.remove();
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
