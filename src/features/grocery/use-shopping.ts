import { useEffect, useRef, useState } from 'react';

import { fetchMembers, type Member } from '@/features/household/members';
import { useOnline } from '@/hooks/use-online';

import { listSnapshot, PARTNER_ACTIVITY_MS, partnerChangeAt, type ListSnapshot } from './shopping';
import type { GroceryItemRow } from './tables';

/**
 * The household's members, for "checked by <member>" (FR-LIST-9). Fetched when online and
 * kept in memory only: names aren't stored on the device beyond the encrypted local copy.
 * Offline before the first fetch, the list shows check-offs without names.
 */
export function useListMembers(householdId: string): readonly Member[] | null {
  const online = useOnline();
  const [members, setMembers] = useState<readonly Member[] | null>(null);
  useEffect(() => {
    if (!online) return;
    let active = true;
    fetchMembers(householdId).then(
      (rows) => active && setMembers(rows),
      () => undefined,
    );
    return () => {
      active = false;
    };
  }, [householdId, online]);
  return members;
}

/**
 * Whether another member changed the list in the last minute, for the "someone else is
 * updating the list" banner (FR-LIST-9). The banner goes a minute after the last change.
 */
export function usePartnerActivity(
  listId: string | null,
  items: readonly GroceryItemRow[],
  me: string | null,
): boolean {
  const previous = useRef<{ listId: string; snapshot: ListSnapshot } | null>(null);
  const [until, setUntil] = useState(0);

  useEffect(() => {
    if (!listId) return;
    const now = Date.now();
    const last = previous.current?.listId === listId ? previous.current.snapshot : null;
    const at = partnerChangeAt({ previous: last, items, listId, me, now });
    previous.current = { listId, snapshot: listSnapshot(items, listId) };
    if (at !== null) setUntil((current) => Math.max(current, at + PARTNER_ACTIVITY_MS));
  }, [listId, items, me]);

  // The clock moves on only when the banner is due to go, so the screen doesn't re-render
  // every second.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const left = until - Date.now();
    if (left <= 0) return;
    const timer = setTimeout(() => setNow(Date.now()), left);
    return () => clearTimeout(timer);
  }, [until]);

  return until > now;
}
