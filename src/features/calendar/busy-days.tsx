import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';

import type { MemberRole } from '@/features/household/invitations';
import type { Membership } from '@/features/household/membership';
import { addDays, type PlanDate, type WeekStart } from '@/features/planner/week';
import { track } from '@/lib/analytics';
import { reportError } from '@/lib/crash-reporting';
import { useSyncWriter } from '@/lib/sync';

import { householdTimeZone, startOfDay } from './agenda';
import { busyDays } from './busy';
import { BusyMarkSheet } from './busy-mark-sheet';
import { useBusyRule } from './busy-rule';
import { useBusyRows, useCalendarRows } from './data';
import { publishedBusyDays, type ShownBusyDay } from './publish';
import { expandOccurrences } from './repeat';
import { BUSY_DAY_OVERRIDES, overrideId } from './tables';
import { useCalendarMembers } from './use-members';

export type BusyViewer = {
  householdId: string;
  userId: string;
  role: MemberRole;
  timeZone: string;
  weekStart: WeekStart;
};

type BusyDaysValue = {
  /** A day's busy state, worked out from the local copy, so it reads offline. */
  dayFor: (date: PlanDate) => ShownBusyDay;
  /** Parents and family members mark days; caregivers only see (FR2-BUSY-4, C8). */
  canMark: boolean;
  /** Marks a day busy (true), not busy (false), or clears the mark (null). */
  mark: (date: PlanDate, busy: boolean | null) => Promise<void>;
  /** Opens the sheet to mark a day (parents and family members only). */
  openMark: (date: PlanDate) => void;
};

export function busyViewer(membership: Membership, userId: string): BusyViewer {
  return {
    householdId: membership.householdId,
    userId,
    role: membership.role,
    timeZone: householdTimeZone(membership.timezone),
    weekStart: membership.weekStart === 1 ? 1 : 7,
  };
}

const BusyDaysContext = createContext<BusyDaysValue | null>(null);

/** The busy days in reach of the screens below it, or null outside a provider. */
export function useBusyDaysContext(): BusyDaysValue | null {
  return useContext(BusyDaysContext);
}

/**
 * Busy days for the Plan and Calendar tabs (FR2-BUSY-1, FR2-BUSY-4, R2-BUSY-2). A parent's
 * device runs the busy-day engine on every event and parents' busy blocks; family members and
 * caregivers see what parents' devices publish (D-23), with marks applied at once. Free for
 * every household (D-15).
 */
export function BusyDaysProvider({
  viewer,
  children,
}: {
  viewer: BusyViewer;
  children: ReactNode;
}) {
  const { householdId, userId, role, timeZone, weekStart } = viewer;
  const isParent = role === 'parent';
  const { events, exceptions } = useCalendarRows();
  const { blocks, overrides, published } = useBusyRows();
  const rule = useBusyRule();
  const members = useCalendarMembers(householdId);
  const writer = useSyncWriter();

  const parentKey = members
    .filter((member) => member.role === 'parent')
    .map((member) => member.userId)
    .concat(isParent ? [userId] : [])
    .sort()
    .join(',');

  const dayFor = useMemo(() => {
    const parentIds = new Set(parentKey.split(','));
    return (date: PlanDate): ShownBusyDay => {
      if (!isParent) return publishedBusyDays([date], published, overrides)[0];
      const range = {
        timeZone,
        weekStart,
        from: new Date(startOfDay(date, timeZone)),
        to: new Date(startOfDay(addDays(date, 1), timeZone)),
        exceptions,
      };
      const occurrences = events.flatMap((event) => expandOccurrences(event, range));
      return busyDays({
        dates: [date],
        occurrences,
        busyBlocks: blocks,
        parentIds,
        overrides,
        timeZone,
        rule,
      })[0];
    };
  }, [
    isParent,
    parentKey,
    published,
    overrides,
    events,
    exceptions,
    blocks,
    timeZone,
    weekStart,
    rule,
  ]);

  const [marking, setMarking] = useState<PlanDate | null>(null);

  const mark = useCallback(
    async (date: PlanDate, busy: boolean | null) => {
      const id = overrideId(householdId, date);
      // One row per day for life: change it if this device has it, otherwise create it. Two
      // devices creating the same day offline write one row (FR2-BUSY-4).
      if (overrides.some((row) => row.id === id)) {
        await writer.update(BUSY_DAY_OVERRIDES.name, id, { busy });
      } else {
        await writer.insert(BUSY_DAY_OVERRIDES.name, id, { date, busy, set_by: null });
      }
      if (busy !== null) track('busy_day_overridden', { busy });
    },
    [householdId, overrides, writer],
  );

  const canMark = role === 'parent' || role === 'family';
  const value = useMemo<BusyDaysValue>(
    () => ({ dayFor, canMark, mark, openMark: setMarking }),
    [dayFor, canMark, mark],
  );
  return (
    <BusyDaysContext.Provider value={value}>
      {children}
      {canMark ? (
        <BusyMarkSheet
          date={marking}
          current={marking ? (overrides.find((row) => row.date === marking)?.busy ?? null) : null}
          onChoose={(busy) => {
            const date = marking;
            setMarking(null);
            if (date) void mark(date, busy).catch(reportError);
          }}
          onClose={() => setMarking(null)}
        />
      ) : null}
    </BusyDaysContext.Provider>
  );
}

/** Busy days for the signed-in member's household; children render alone until signed in. */
export function HouseholdBusyDays({
  membership,
  userId,
  children,
}: {
  membership: Membership;
  userId: string | null;
  children: ReactNode;
}) {
  return userId ? (
    <BusyDaysProvider viewer={busyViewer(membership, userId)}>{children}</BusyDaysProvider>
  ) : (
    <>{children}</>
  );
}
