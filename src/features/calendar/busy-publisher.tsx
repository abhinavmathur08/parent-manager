import { useEffect, useMemo, useRef, useState } from 'react';
import { AppState } from 'react-native';

import { useHousehold, type Membership } from '@/features/household/membership';
import { todayIn } from '@/features/planner/week';
import { reportError } from '@/lib/crash-reporting';
import { useSyncEngine, useSyncStatus } from '@/lib/sync';

import { householdTimeZone } from './agenda';
import { useBusyRule } from './busy-rule';
import { publishBusyDays, PUBLISH_INPUT_TABLES, type PublishSource } from './publish';
import { useCalendarMembers } from './use-members';

/** How long to wait for a burst of changes (a pull, a repeat edited) to settle. */
const SETTLE_MS = 500;

/**
 * Publishes each day's busy state from a parent's device (B-01.4, D-23), so family members and
 * caregivers see markers for days made busy by events they can't see (R2-BUSY-2). It runs
 * when events, busy blocks, overrides, the thresholds, the parents or the day change, and
 * waits while the local copy is still loading or pulling, so it never works from half a
 * household. Mounted once, with the tabs; renders nothing.
 */
export function BusyDayPublisher({ userId }: { userId: string }) {
  const { state } = useHousehold();
  const membership = state.status === 'member' ? state.membership : null;
  return membership?.role === 'parent' ? (
    <Publisher userId={userId} membership={membership} />
  ) : null;
}

function Publisher({ userId, membership }: { userId: string; membership: Membership }) {
  const { householdId } = membership;
  const engine = useSyncEngine();
  const status = useSyncStatus();
  const rule = useBusyRule();
  const members = useCalendarMembers(householdId);
  const today = useToday(householdTimeZone(membership.timezone));
  const [changed, setChanged] = useState(0);

  const parentKey = members
    .filter((member) => member.role === 'parent')
    .map((member) => member.userId)
    .sort()
    .join(',');
  const ready =
    engine !== null &&
    !status.firstLoad &&
    (status.state === 'idle' || status.state === 'offline') &&
    // Without the member list, other parents' busy blocks would be left out.
    parentKey.split(',').includes(userId);

  const source = useMemo<PublishSource | null>(
    () =>
      ready
        ? {
            householdId,
            today,
            timeZone: householdTimeZone(membership.timezone),
            weekStart: membership.weekStart,
            parentIds: new Set(parentKey.split(',')),
            rule,
          }
        : null,
    [ready, membership, householdId, today, parentKey, rule],
  );

  useEffect(
    () =>
      engine?.store.subscribe((change) => {
        if ([...change.tables].some((table) => PUBLISH_INPUT_TABLES.has(table))) {
          setChanged((n) => n + 1);
        }
      }),
    [engine],
  );

  const queue = useRef<Promise<unknown>>(Promise.resolve());
  useEffect(() => {
    if (!engine || !source) return;
    const timer = setTimeout(() => {
      queue.current = queue.current.then(() => publishBusyDays(engine, source)).catch(reportError);
    }, SETTLE_MS);
    return () => clearTimeout(timer);
  }, [engine, source, changed]);

  return null;
}

/** Today in the household's timezone, checked again when the app comes back. */
function useToday(timeZone: string) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (next) => {
      if (next === 'active') setNow(Date.now());
    });
    return () => subscription.remove();
  }, []);
  return useMemo(() => todayIn(timeZone, new Date(now)), [timeZone, now]);
}
