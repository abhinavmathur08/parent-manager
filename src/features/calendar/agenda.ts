/**
 * The agenda (S-36, FR2-CAL-1): the household's events as a list of days from today, built
 * from the local copy (FR2-CAL-6). Repeats are expanded here for the range on screen and
 * never stored (R2-CAL-1).
 */
import { addDays, daysBetween, type PlanDate, type WeekStart } from '@/features/planner/week';

import { expandOccurrences, wallTime, zonedInstant, type Occurrence } from './repeat';
import type { EventExceptionRow, EventRow } from './tables';

/** How many days the agenda shows at first, and how many "show later" adds (PROPOSED). */
export const AGENDA_DAYS = 28;

export type AgendaItem = {
  /** Unique in the agenda: the event and the occurrence's original date. */
  key: string;
  event: EventRow;
  occurrence: Occurrence;
};

export type AgendaDay = { date: PlanDate; items: AgendaItem[] };

export type AgendaOptions = {
  /** The household's IANA timezone. */
  timeZone: string;
  weekStart: WeekStart;
  /** The first day shown, normally today in the household's timezone. */
  from: PlanDate;
  days: number;
};

/** Midnight at the start of a date in a timezone, as an instant. */
export function startOfDay(date: PlanDate, timeZone: string): number {
  return zonedInstant({ date, hour: 0, minute: 0, second: 0, ms: 0 }, timeZone);
}

/**
 * The days in the range that have something on, in order, plus `from` itself, always, so
 * the agenda opens on today. All-day items come first in a day, then timed ones by start.
 * A timed event that began before the range shows on its first day; an all-day event that
 * spans several days shows on each.
 */
export function agendaDays(
  events: readonly EventRow[],
  exceptions: readonly EventExceptionRow[],
  { timeZone, weekStart, from, days }: AgendaOptions,
): AgendaDay[] {
  const last = addDays(from, days - 1);
  const range = {
    timeZone,
    weekStart,
    from: new Date(startOfDay(from, timeZone)),
    to: new Date(startOfDay(addDays(from, days), timeZone)),
    exceptions,
  };
  const byDate = new Map<PlanDate, AgendaItem[]>([[from, []]]);
  const put = (date: PlanDate, item: AgendaItem) => {
    const list = byDate.get(date);
    if (list) list.push(item);
    else byDate.set(date, [item]);
  };

  for (const event of events) {
    if (event.deleted_at) continue;
    for (const occurrence of expandOccurrences(event, range)) {
      const item = { key: `${event.id}:${occurrence.originalDate}`, event, occurrence };
      if (occurrence.allDay) {
        const start = occurrence.startDate! < from ? from : occurrence.startDate!;
        const end = occurrence.endDate! > last ? last : occurrence.endDate!;
        for (let i = 0; i <= daysBetween(start, end); i++) put(addDays(start, i), item);
      } else {
        const date = wallTime(Date.parse(occurrence.startsAt!), timeZone).date;
        put(date < from ? from : date, item);
      }
    }
  }

  return [...byDate.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, items]) => ({ date, items: items.sort(byStart) }));
}

function byStart(a: AgendaItem, b: AgendaItem): number {
  const x = a.occurrence;
  const y = b.occurrence;
  if (x.allDay !== y.allDay) return x.allDay ? -1 : 1;
  const time = x.allDay ? 0 : Date.parse(x.startsAt ?? '') - Date.parse(y.startsAt ?? '');
  // Stable across devices: never by display text.
  return time || a.key.localeCompare(b.key);
}

/** The device's timezone, for a household cached before its timezone was saved. */
export function householdTimeZone(timezone: string | null | undefined): string {
  if (timezone) {
    try {
      new Intl.DateTimeFormat('en-US', { timeZone: timezone });
      return timezone;
    } catch {
      // An unknown zone falls back to the device's, so the calendar still opens.
    }
  }
  return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
}
