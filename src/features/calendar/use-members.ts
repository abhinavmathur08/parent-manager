import { useEffect, useState } from 'react';

import { onSignOut } from '@/features/auth/sign-out';
import { fetchMembers, type Member } from '@/features/household/members';

// The last list fetched this session, so the calendar opened offline after one online load
// still names who's taking. Memory only, cleared on sign-out. Members aren't synced.
let cache: { householdId: string; members: Member[] } | null = null;

/**
 * The household's members, for "taking" (FR2-CAL-2, FR2-CAL-7). Empty until loaded, and
 * while offline with nothing cached: "me" and "nobody yet" still work without it.
 */
export function useCalendarMembers(householdId: string): Member[] {
  const [members, setMembers] = useState<Member[]>(() =>
    cache?.householdId === householdId ? cache.members : [],
  );
  useEffect(() => {
    let active = true;
    fetchMembers(householdId).then(
      (list) => {
        cache = { householdId, members: list };
        if (active) setMembers(list);
      },
      () => undefined,
    );
    return () => {
      active = false;
    };
  }, [householdId]);
  return members;
}

onSignOut(() => {
  cache = null;
});
