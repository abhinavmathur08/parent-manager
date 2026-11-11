import { useCallback, useEffect, useState } from 'react';

import type { MemberRole } from '@/features/household/invitations';
import { getSupabase } from '@/lib/supabase';

/** Two parents per household (FR-HH-1). Family and caregiver seats need Premium. */
export const MAX_PARENTS = 2;

export type Seats = { parents: number; premium: boolean };

/** Which roles a parent can invite now, and why not (FR-HH-1). The server checks again. */
export function roleAvailability(
  seats: Seats,
  role: MemberRole,
): 'available' | 'seat_limit' | 'premium_required' {
  if (role === 'parent') return seats.parents >= MAX_PARENTS ? 'seat_limit' : 'available';
  return seats.premium ? 'available' : 'premium_required';
}

export async function fetchSeats(householdId: string): Promise<Seats> {
  const supabase = getSupabase();
  const [members, entitlement] = await Promise.all([
    supabase
      .from('household_members')
      .select('role')
      .eq('household_id', householdId)
      .eq('status', 'active')
      .is('deleted_at', null),
    supabase
      .from('household_entitlements')
      .select('tier')
      .eq('household_id', householdId)
      .maybeSingle<{ tier: string }>(),
  ]);
  if (members.error) throw members.error;
  if (entitlement.error) throw entitlement.error;
  const rows = (members.data ?? []) as { role: string }[];
  return {
    parents: rows.filter((row) => row.role === 'parent').length,
    premium: entitlement.data?.tier === 'premium',
  };
}

/** Loads the household's seats while `active`, for example while a sheet is open. */
export function useSeats(householdId: string | null, active: boolean) {
  const [result, setResult] = useState<{ seats: Seats | null; failed: boolean }>({
    seats: null,
    failed: false,
  });

  const load = useCallback(async () => {
    if (!householdId) return null;
    try {
      return { seats: await fetchSeats(householdId), failed: false };
    } catch {
      return { seats: null, failed: true };
    }
  }, [householdId]);

  useEffect(() => {
    if (!active) return;
    let current = true;
    load().then((next) => {
      if (current && next) setResult(next);
    });
    return () => {
      current = false;
    };
  }, [active, load]);

  return result;
}
