import Storage from 'expo-sqlite/kv-store';
import { useCallback, useEffect, useRef } from 'react';

import { track } from '@/lib/analytics';

import type { PlanEntryRow } from './tables';
import { daysBetween, weekDates, type PlanDate } from './week';

/** FR-PLAN-12 (PROPOSED): a week is planned with 5 or more dinners. */
export const WEEK_PLANNED_DINNERS = 5;

/** How long after this device's own change a crossing counts as this device's doing. */
const OWN_CHANGE_MS = 5000;

/**
 * Dinners planned in the week starting on `start`: the days with at least one live dinner
 * entry, so a main and a side count once and "6 of 7" never passes 7.
 */
export function dinnersPlanned(entries: readonly PlanEntryRow[], start: PlanDate): number {
  const days = new Set(weekDates(start));
  const planned = new Set(
    entries
      .filter((e) => !e.deleted_at && e.slot === 'dinner' && days.has(e.date))
      .map((e) => e.date),
  );
  return planned.size;
}

const key = (householdId: string, start: PlanDate) =>
  `planner.week_planned.${householdId}.${start}`;

function alreadyRecorded(householdId: string, start: PlanDate): boolean {
  try {
    return Storage.getItemSync(key(householdId, start)) !== null;
  } catch {
    return false;
  }
}

function markRecorded(householdId: string, start: PlanDate): void {
  try {
    Storage.setItemSync(key(householdId, start), '1');
  } catch {
    // Without storage the event may repeat; it never blocks planning.
  }
}

/**
 * Records `week_planned` once per week (FR-PLAN-12, spec 3.6), when this device's own change
 * takes the week from under 5 dinners to 5 or more. A partner's change arriving by sync
 * doesn't count here, so the event comes from the device that planned it. The weeks already
 * recorded are kept on the device (IDs and dates only).
 *
 * Returns `noteChange`, which the screen calls whenever it writes to the plan.
 */
export function useWeekPlannedEvent(
  householdId: string,
  start: PlanDate,
  today: PlanDate,
  dinners: number,
): () => void {
  const changedAt = useRef(0);
  const last = useRef<{ start: PlanDate; dinners: number } | null>(null);

  useEffect(() => {
    const before = last.current;
    last.current = { start, dinners };
    if (!before || before.start !== start) return;
    const crossed = before.dinners < WEEK_PLANNED_DINNERS && dinners >= WEEK_PLANNED_DINNERS;
    if (!crossed || Date.now() - changedAt.current > OWN_CHANGE_MS) return;
    if (alreadyRecorded(householdId, start)) return;
    markRecorded(householdId, start);
    track('week_planned', {
      dinners_count: dinners,
      days_until_week_start: Math.max(0, daysBetween(today, start)),
    });
  }, [householdId, start, today, dinners]);

  return useCallback(() => {
    changedAt.current = Date.now();
  }, []);
}
