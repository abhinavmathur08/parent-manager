/**
 * Event reminders (C-04.1, FR2-REM-2, FR2-REM-6): local notifications worked out on the device
 * from the synced calendar, so they fire offline. The device only holds events the member can
 * see (C-01.3), so nothing here checks visibility again.
 */
import { addDays, type WeekStart } from '@/features/planner/week';
import { expandOccurrences, wallTime, zonedInstant } from '@/features/calendar/repeat';
import type {
  EventExceptionRow,
  EventKind,
  EventReminderRow,
  EventRow,
} from '@/features/calendar/tables';

import { outsideQuietHours } from './defrost';

/** Local notification IDs start with this, so the app can find and replace its own. */
export const EVENT_REMINDER_ID_PREFIX = 'event.';

/** How far ahead occurrences are looked at; the 2-day reminder of the last one still fits. */
export const EVENT_REMINDER_DAYS_AHEAD = 14;

/** An all-day event's reminders count back from 09:00 on its first day (PROPOSED). */
export const ALL_DAY_REMINDER_MINUTE = 9 * 60;

const MINUTE_MS = 60_000;
const DAY_MS = 24 * 60 * MINUTE_MS;

export type EventReminder = {
  /** The local notification's identifier: one per occurrence and offset. */
  id: string;
  eventId: string;
  /** Names the occurrence (R2-CAL-2), for opening its detail. */
  originalDate: string;
  offsetMinutes: number;
  fireAt: Date;
  /** When the occurrence starts: its instant, or 09:00 household time on an all-day one's day. */
  startsAt: Date;
  allDay: boolean;
  kind: EventKind;
  takingUserId: string | null;
  /** Shown only when the member turned event details on (FR2-REM-3). */
  title: string;
  place: string | null;
};

/**
 * Each event's first reminder: the one set first, by `created_at` and then ID so every device
 * agrees. On a lapse it's the only one that keeps working (FR2-REM-6); the others are kept.
 */
export function firstReminderIds(reminders: readonly EventReminderRow[]): Set<string> {
  const first = new Map<string, EventReminderRow>();
  for (const row of reminders) {
    if (row.deleted_at) continue;
    const current = first.get(row.event_id);
    if (!current || compareCreated(row, current) < 0) first.set(row.event_id, row);
  }
  return new Set([...first.values()].map((row) => row.id));
}

function compareCreated(a: EventReminderRow, b: EventReminderRow): number {
  // A reminder added offline has no server time yet: it was set last.
  const x = a.created_at ?? '￿';
  const y = b.created_at ?? '￿';
  return x < y ? -1 : x > y ? 1 : a.id.localeCompare(b.id);
}

/**
 * When a reminder due at `at` may go (FR2-REM-2): then, or the end of quiet hours in the
 * household's timezone when it falls inside them.
 */
export function afterQuietHours(
  at: number,
  timeZone: string,
  quietStartMinute: number,
  quietEndMinute: number,
): number {
  const wall = wallTime(at, timeZone);
  const minute = wall.hour * 60 + wall.minute;
  if (outsideQuietHours(minute, quietStartMinute, quietEndMinute) === minute) return at;
  const end = (date: string) =>
    zonedInstant(
      {
        date,
        hour: Math.floor(quietEndMinute / 60),
        minute: quietEndMinute % 60,
        second: 0,
        ms: 0,
      },
      timeZone,
    );
  const sameDay = end(wall.date);
  return sameDay > at ? sameDay : end(addDays(wall.date, 1));
}

export type EventReminderInput = {
  events: readonly EventRow[];
  exceptions: readonly EventExceptionRow[];
  reminders: readonly EventReminderRow[];
  /** The household's IANA timezone and week start. */
  timeZone: string;
  weekStart: WeekStart;
  now: Date;
  /** Premium keeps every reminder; otherwise only each event's first works (FR2-REM-6). */
  premium: boolean;
  quietStartMinute: number;
  quietEndMinute: number;
};

/**
 * The reminders this device should have, nearest first: one per live reminder row and
 * upcoming occurrence in the next two weeks, still in the future. Reminders other than "at
 * the time" that fall in quiet hours move to their end, and are dropped if that's after the
 * start. Two reminders of one occurrence that land on the same minute become one.
 */
export function eventReminderSchedule(input: EventReminderInput): EventReminder[] {
  const { timeZone, weekStart, now, premium, quietStartMinute, quietEndMinute } = input;
  const nowMs = now.getTime();
  const working = premium ? null : firstReminderIds(input.reminders);
  const offsets = new Map<string, number[]>();
  for (const row of input.reminders) {
    if (row.deleted_at || (working && !working.has(row.id))) continue;
    offsets.set(row.event_id, [...(offsets.get(row.event_id) ?? []), row.offset_minutes]);
  }

  const range = {
    timeZone,
    weekStart,
    from: now,
    to: new Date(nowMs + EVENT_REMINDER_DAYS_AHEAD * DAY_MS),
    exceptions: input.exceptions,
  };
  const result: EventReminder[] = [];
  for (const event of input.events) {
    const eventOffsets = offsets.get(event.id);
    if (event.deleted_at || !eventOffsets) continue;
    for (const occurrence of expandOccurrences(event, range)) {
      const start = occurrence.allDay
        ? zonedInstant(
            {
              date: occurrence.startDate!,
              hour: Math.floor(ALL_DAY_REMINDER_MINUTE / 60),
              minute: ALL_DAY_REMINDER_MINUTE % 60,
              second: 0,
              ms: 0,
            },
            timeZone,
          )
        : Date.parse(occurrence.startsAt!);
      if (!(start > nowMs)) continue;
      const seen = new Set<number>();
      for (const offset of [...eventOffsets].sort((a, b) => b - a)) {
        let fireAt = start - offset * MINUTE_MS;
        if (offset !== 0) {
          fireAt = afterQuietHours(fireAt, timeZone, quietStartMinute, quietEndMinute);
          if (fireAt >= start) continue;
        }
        if (fireAt <= nowMs || seen.has(fireAt)) continue;
        seen.add(fireAt);
        result.push({
          id: `${EVENT_REMINDER_ID_PREFIX}${event.id}.${occurrence.originalDate}.${offset}`,
          eventId: event.id,
          originalDate: occurrence.originalDate,
          offsetMinutes: offset,
          fireAt: new Date(fireAt),
          startsAt: new Date(start),
          allDay: occurrence.allDay,
          kind: event.kind,
          takingUserId: occurrence.takingUserId,
          title: event.title,
          place: event.place,
        });
      }
    }
  }
  return result.sort((a, b) => a.fireAt.getTime() - b.fireAt.getTime() || a.id.localeCompare(b.id));
}
