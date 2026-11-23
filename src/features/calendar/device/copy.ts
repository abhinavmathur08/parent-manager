/**
 * "Copy to my calendar" (C-05.2, FR2-DEV-2, FR2-DEV-3, D-14): what to write to the phone's
 * calendar, and how to bring earlier copies up to date. Each occurrence in the window is its
 * own device event, never a device repeat, so exceptions need no mapping. Copies are only
 * written, never read back: edits made in another calendar app are overwritten.
 */
import { addDays, type PlanDate, type WeekStart } from '@/features/planner/week';
import type { PlanEntryRow } from '@/features/planner/tables';
import type { CopyDetails } from '@/lib/device-calendar/calendars';

import { startOfDay } from '../agenda';
import { expandOccurrences } from '../repeat';
import type { EventExceptionRow, EventRow } from '../tables';

/** Days copied around today (PROPOSED, architecture section 3.5). */
export const COPY_WINDOW = { pastDays: 30, futureDays: 180 } as const;

export type CopyItem = { key: string; details: CopyDetails };

export type CopySource = {
  events: readonly EventRow[];
  exceptions: readonly EventExceptionRow[];
  timeZone: string;
  weekStart: WeekStart;
  today: PlanDate;
  /** The kind's translated name: a copy carries it instead of the notes (FR2-DEV-3). */
  kindName: (kind: string) => string;
  /** A link back to the occurrence in the app. */
  eventLink: (eventId: string, date: PlanDate) => string;
  /** Planned dinners by date, only when "include meals" is on. */
  dinners: ReadonlyMap<PlanDate, readonly string[]> | null;
  mealTitle: (titles: readonly string[]) => string;
  mealNotes: string;
  mealLink: (date: PlanDate) => string;
};

/**
 * The copies that should exist now, keyed by event and original date (R2-CAL-2), or by
 * date for a day's dinners. A copy holds the title, time, place and kind's name, and never
 * the notes, people or attachments (FR2-DEV-3).
 */
export function copyItems(source: CopySource): CopyItem[] {
  const { timeZone, today } = source;
  const first = addDays(today, -COPY_WINDOW.pastDays);
  const last = addDays(today, COPY_WINDOW.futureDays);
  const range = {
    timeZone,
    weekStart: source.weekStart,
    from: new Date(startOfDay(first, timeZone)),
    to: new Date(startOfDay(addDays(last, 1), timeZone)),
    exceptions: source.exceptions,
  };
  const items: CopyItem[] = [];
  for (const event of source.events) {
    if (event.deleted_at) continue;
    for (const occurrence of expandOccurrences(event, range)) {
      const common = {
        title: event.title,
        location: event.place || null,
        notes: source.kindName(event.kind),
        url: source.eventLink(event.id, occurrence.originalDate),
      };
      items.push({
        key: `${event.id}:${occurrence.originalDate}`,
        details: occurrence.allDay
          ? {
              ...common,
              allDay: true,
              startDate: occurrence.startDate!,
              endDate: occurrence.endDate!,
            }
          : {
              ...common,
              allDay: false,
              startsAt: occurrence.startsAt!,
              endsAt: occurrence.endsAt!,
              timeZone,
            },
      });
    }
  }
  for (const [date, titles] of source.dinners ?? []) {
    if (date < first || date > last || titles.length === 0) continue;
    items.push({
      key: `meal:${date}`,
      details: {
        allDay: true,
        title: source.mealTitle(titles),
        location: null,
        notes: source.mealNotes,
        url: source.mealLink(date),
        startDate: date,
        endDate: date,
      },
    });
  }
  return items;
}

/** Each date's dinner titles, in plan order (FR2-DEV-3). */
export function dinnersByDate(
  entries: readonly PlanEntryRow[],
  titleOf: (entry: PlanEntryRow) => string,
): Map<PlanDate, string[]> {
  const byDate = new Map<PlanDate, PlanEntryRow[]>();
  for (const entry of entries) {
    if (entry.deleted_at || entry.slot !== 'dinner') continue;
    byDate.set(entry.date, [...(byDate.get(entry.date) ?? []), entry]);
  }
  return new Map(
    [...byDate].map(([date, list]) => [
      date,
      list.sort((a, b) => a.position - b.position || a.id.localeCompare(b.id)).map(titleOf),
    ]),
  );
}

/** One copy on this device: its device event and what was last written to it. */
export type CopyRecord = { id: string; hash: string };

/** What this device has copied, kept on the device only. */
export type CopyState = {
  householdId: string;
  calendarId: string;
  /** True when the calendar is our own "Parent Manager" one, deleted with the copies. */
  own: boolean;
  copies: Record<string, CopyRecord>;
};

export type CopyPlan = {
  put: { key: string; existingId: string | null; details: CopyDetails; hash: string }[];
  remove: { key: string; id: string }[];
};

/** Writes only what changed: new and changed copies, and copies of events now gone. */
export function planCopies(
  items: readonly CopyItem[],
  copies: Readonly<Record<string, CopyRecord>>,
): CopyPlan {
  const plan: CopyPlan = { put: [], remove: [] };
  const wanted = new Set<string>();
  for (const { key, details } of items) {
    wanted.add(key);
    const hash = JSON.stringify(details);
    const record = copies[key];
    if (record?.hash !== hash) {
      plan.put.push({ key, existingId: record?.id ?? null, details, hash });
    }
  }
  for (const [key, record] of Object.entries(copies)) {
    if (!wanted.has(key)) plan.remove.push({ key, id: record.id });
  }
  return plan;
}
