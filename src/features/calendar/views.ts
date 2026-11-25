/**
 * The day and week views (S-36, FR2-CAL-1, FR2-CAL-5): which items fall on each day, how
 * overlapping times sit side by side, and each day's planned meals. Pure, so it's tested
 * without a screen and works offline from the local copy (FR2-CAL-6).
 */
import { compareEntries } from '@/features/planner/plan';
import type { PlanEntryRow, Slot } from '@/features/planner/tables';
import { addDays, type PlanDate } from '@/features/planner/week';

import { agendaDays, type AgendaDay, type AgendaItem, type AgendaOptions } from './agenda';
import type { EventExceptionRow, EventRow } from './tables';

export const CALENDAR_VIEWS = ['agenda', 'day', 'week'] as const;
export type CalendarView = (typeof CALENDAR_VIEWS)[number];

/**
 * Every day in the range, in order, each with its items, including days with nothing on, so
 * the day and week views keep their shape. Items are placed and ordered as in the agenda.
 */
export function calendarDays(
  events: readonly EventRow[],
  exceptions: readonly EventExceptionRow[],
  options: AgendaOptions,
): AgendaDay[] {
  const byDate = new Map(agendaDays(events, exceptions, options).map((d) => [d.date, d.items]));
  return Array.from({ length: options.days }, (_, i) => {
    const date = addDays(options.from, i);
    return { date, items: byDate.get(date) ?? [] };
  });
}

/** Timed items that overlap, directly or through each other, as side-by-side columns. */
export type OverlapGroup = { columns: AgendaItem[][] };

export type DayLayout = {
  /** All-day items, first in the day. */
  allDay: AgendaItem[];
  /** Timed items in start order; a group of one item has one column. */
  groups: OverlapGroup[];
};

const startOf = (item: AgendaItem) => Date.parse(item.occurrence.startsAt ?? '');
const endOf = (item: AgendaItem) => Date.parse(item.occurrence.endsAt ?? '');

/**
 * Lays out one day's items (from `calendarDays`) for the day view: overlaps are allowed and
 * shown side by side (spec 3.1 edge cases). Each item takes the first column that's free at
 * its start, so a group is as narrow as it can be. Times compare as instants, so a
 * daylight-saving change never makes two events overlap or part.
 */
export function dayLayout(items: readonly AgendaItem[]): DayLayout {
  const allDay = items.filter((item) => item.occurrence.allDay);
  const timed = items
    .filter((item) => !item.occurrence.allDay)
    .sort((a, b) => startOf(a) - startOf(b) || endOf(b) - endOf(a) || a.key.localeCompare(b.key));

  const groups: OverlapGroup[] = [];
  let columns: { items: AgendaItem[]; until: number }[] = [];
  let groupEnd = -Infinity;
  for (const item of timed) {
    const start = startOf(item);
    // An event with no length still takes a moment, so it sits beside one starting with it.
    const until = Math.max(endOf(item), start + 1);
    // An item starting when the group ends doesn't overlap it.
    if (start >= groupEnd && columns.length > 0) {
      groups.push({ columns: columns.map((c) => c.items) });
      columns = [];
    }
    const free = columns.find((column) => column.until <= start);
    if (free) {
      free.items.push(item);
      free.until = until;
    } else {
      columns.push({ items: [item], until });
    }
    groupEnd = Math.max(groupEnd, until);
  }
  if (columns.length > 0) groups.push({ columns: columns.map((c) => c.items) });
  return { allDay, groups };
}

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
