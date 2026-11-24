/**
 * The calendar's views (S-36, FR2-CAL-1, FR2-CAL-5): each day's planned meals. Pure, so it's
 * tested without a screen and works offline from the local copy (FR2-CAL-6).
 */
import { compareEntries } from '@/features/planner/plan';
import type { PlanEntryRow, Slot } from '@/features/planner/tables';
import type { PlanDate } from '@/features/planner/week';

/** One slot's planned meals on a day, in plan order. */
export type SlotMeals = { slot: Slot; titles: string[] };

/**
 * Each date's planned meals, by slot in the plan's order (FR2-CAL-5), read only from the
 * plan. Dates with nothing planned are left out. Titles come from `titleOf`, so a deleted
 * recipe can still be named.
 */
export function mealsByDate(
  entries: readonly PlanEntryRow[],
  titleOf: (entry: PlanEntryRow) => string,
): Map<PlanDate, SlotMeals[]> {
  const byDate = new Map<PlanDate, SlotMeals[]>();
  const live = entries.filter((entry) => !entry.deleted_at).sort(compareEntries);
  for (const entry of live) {
    const day = byDate.get(entry.date) ?? [];
    if (!byDate.has(entry.date)) byDate.set(entry.date, day);
    const last = day[day.length - 1];
    if (last?.slot === entry.slot) last.titles.push(titleOf(entry));
    else day.push({ slot: entry.slot, titles: [titleOf(entry)] });
  }
  return byDate;
}
