/**
 * Repeating events (C-01.2, FR2-CAL-4, R2-CAL-1, R2-CAL-2).
 *
 * A series is one event row with a simple rule: daily, weekly on chosen weekdays, every 2 weeks,
 * or monthly on the same date, ending never, on a date (`until`, inclusive) or after a number of
 * occurrences (`count`). Occurrences are worked out here, on the device, for the range on
 * screen, and never stored. Changed occurrences are `event_exceptions` rows.
 *
 * Times follow the household's timezone: a 10:00 weekly event stays at 10:00 local time across
 * daylight-saving changes, so its instant moves by an hour. A wall time that doesn't exist on a
 * day (the spring-forward gap) moves forward by the gap, and one that happens twice (fall back)
 * is the first, as in RFC 5545.
 *
 * An occurrence is named by its original date in the household's timezone: a series has at most
 * one occurrence a day. The server checks the same rule shape (`private.valid_repeat`).
 */
import {
  addDays,
  daysBetween,
  isPlanDate,
  isoWeekday,
  startOfWeek,
  type WeekStart,
} from '@/features/planner/week';

import type { EventExceptionRow, EventRow } from './tables';

export type RepeatRule = {
  freq: 'daily' | 'weekly' | 'monthly';
  /** 2 is "every 2 weeks", for weekly rules only. */
  interval?: 1 | 2;
  /** ISO weekdays, 1 Monday to 7 Sunday. Weekly rules only, and required for them. */
  weekdays?: number[];
  /** The last date an occurrence may start on, in the household's timezone. */
  until?: string;
  /** How many occurrences the series has, counting skipped ones. */
  count?: number;
};

export const REPEAT_LIMITS = { maxCount: 730 } as const;

const RULE_KEYS = new Set(['freq', 'interval', 'weekdays', 'until', 'count']);

/** The rule stored on an event, or null for a single event or a rule this version can't read. */
export function parseRepeat(value: unknown): RepeatRule | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const raw = Object.fromEntries(
    Object.entries(value as Record<string, unknown>).filter(([, v]) => v !== null),
  );
  if (Object.keys(raw).some((key) => !RULE_KEYS.has(key))) return null;
  const { freq, interval, weekdays, until, count } = raw;
  if (freq !== 'daily' && freq !== 'weekly' && freq !== 'monthly') return null;
  if (interval !== undefined && interval !== 1 && !(interval === 2 && freq === 'weekly')) {
    return null;
  }
  if (freq === 'weekly') {
    if (
      !Array.isArray(weekdays) ||
      weekdays.length === 0 ||
      new Set(weekdays).size !== weekdays.length ||
      !weekdays.every((day) => Number.isInteger(day) && day >= 1 && day <= 7)
    ) {
      return null;
    }
  } else if (weekdays !== undefined) {
    return null;
  }
  if (until !== undefined && !isPlanDate(until)) return null;
  if (
    count !== undefined &&
    (!Number.isInteger(count) ||
      (count as number) < 1 ||
      (count as number) > REPEAT_LIMITS.maxCount)
  ) {
    return null;
  }
  if (until !== undefined && count !== undefined) return null;
  return raw as RepeatRule;
}

// ---------------------------------------------------------------------------
// Wall time in a timezone, through Intl (no timezone library needed)
// ---------------------------------------------------------------------------
type WallTime = { date: string; hour: number; minute: number; second: number; ms: number };

const DAY_MS = 24 * 60 * 60 * 1000;
const formatters = new Map<string, Intl.DateTimeFormat>();

function formatter(timeZone: string): Intl.DateTimeFormat {
  let format = formatters.get(timeZone);
  if (!format) {
    format = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    formatters.set(timeZone, format);
  }
  return format;
}

/** The date and time on a clock in `timeZone` at an instant. */
export function wallTime(instant: number, timeZone: string): WallTime {
  const parts = formatter(timeZone).formatToParts(new Date(instant));
  const part = (type: string) => parts.find((p) => p.type === type)?.value ?? '0';
  return {
    date: `${part('year')}-${part('month')}-${part('day')}`,
    hour: Number(part('hour')) % 24,
    minute: Number(part('minute')),
    second: Number(part('second')),
    ms: ((instant % 1000) + 1000) % 1000,
  };
}

/** How far the clock in `timeZone` is ahead of UTC at an instant, in milliseconds. */
function offsetAt(instant: number, timeZone: string): number {
  const wall = wallTime(instant, timeZone);
  return wallAsUtc(wall) - instant;
}

function wallAsUtc({ date, hour, minute, second, ms }: WallTime): number {
  return Date.parse(`${date}T00:00:00Z`) + ((hour * 60 + minute) * 60 + second) * 1000 + ms;
}

/** The instant a clock in `timeZone` shows a wall time (gap: moved forward; overlap: first). */
export function zonedInstant(wall: WallTime, timeZone: string): number {
  const local = wallAsUtc(wall);
  // A day holds at most one clock change, so the offsets a day either side cover both sides.
  const before = offsetAt(local - DAY_MS, timeZone);
  const after = offsetAt(local + DAY_MS, timeZone);
  const valid = [local - before, local - after].filter((t) => offsetAt(t, timeZone) === local - t);
  // In a spring-forward gap neither is valid: use the offset from before the change.
  return valid.length ? Math.min(...valid) : local - before;
}

// ---------------------------------------------------------------------------
// Expansion
// ---------------------------------------------------------------------------
export type SeriesEvent = Pick<
  EventRow,
  | 'id'
  | 'all_day'
  | 'starts_at'
  | 'ends_at'
  | 'start_date'
  | 'end_date'
  | 'repeat'
  | 'taking_user_id'
>;

export type Occurrence = {
  eventId: string;
  /** Names the occurrence: its original date in the household's timezone (R2-CAL-2). */
  originalDate: string;
  allDay: boolean;
  /** ISO instants for a timed event. */
  startsAt: string | null;
  endsAt: string | null;
  /** Inclusive dates for an all-day event. */
  startDate: string | null;
  endDate: string | null;
  takingUserId: string | null;
  /** True when "this event" was changed (a `moved` exception). */
  moved: boolean;
};

export type ExpandOptions = {
  /** The household's IANA timezone. */
  timeZone: string;
  /** The range on screen: occurrences overlapping [from, to) are returned. */
  from: Date;
  to: Date;
  /** The household's week start, which sets the weeks of an "every 2 weeks" rule. */
  weekStart?: WeekStart;
  /** The event's exceptions; other events' rows and tombstones are ignored. */
  exceptions?: readonly EventExceptionRow[];
};

/** Stops a malformed series from looping for ever (10 years of days is far more than needed). */
const MAX_STEPS = 3660;

/** The occurrences of one event (single or repeating) in a range, in start order. */
export function expandOccurrences(event: SeriesEvent, options: ExpandOptions): Occurrence[] {
  const { timeZone, weekStart = 1 } = options;
  const fromMs = options.from.getTime();
  const toMs = options.to.getTime();
  if (toMs <= fromMs) return [];
  const fromDate = wallTime(fromMs, timeZone).date;
  const toDate = wallTime(toMs - 1, timeZone).date;

  const allDay = event.all_day;
  const startMs = allDay ? 0 : Date.parse(event.starts_at ?? '');
  const durationMs = allDay ? 0 : Date.parse(event.ends_at ?? '') - startMs;
  const startWall = allDay ? null : wallTime(startMs, timeZone);
  const firstDate = allDay ? event.start_date : startWall?.date;
  if (!firstDate || (!allDay && !(durationMs >= 0))) return [];
  const spanDays = allDay ? daysBetween(firstDate, event.end_date ?? firstDate) : 0;
  // How many days before the range a timed occurrence can start and still overlap it.
  const leadDays = allDay ? spanDays : Math.ceil(durationMs / DAY_MS) + 1;

  const rule = parseRepeat(event.repeat);
  const exceptions = new Map<string, EventExceptionRow>();
  if (rule) {
    for (const row of options.exceptions ?? []) {
      if (row.event_id === event.id && !row.deleted_at) exceptions.set(row.original_date, row);
    }
  }

  const occurrences: Occurrence[] = [];
  const add = (date: string) => {
    const exception = exceptions.get(date);
    if (exception?.status === 'skipped') return;
    const moved = exception?.status === 'moved';
    const taking = (moved ? exception.taking_user_id : null) ?? event.taking_user_id;
    const base = { eventId: event.id, originalDate: date, allDay, takingUserId: taking, moved };
    if (allDay) {
      const startDate = moved ? exception.start_date : date;
      const endDate = moved ? exception.end_date : addDays(date, spanDays);
      if (!startDate || !endDate || startDate > toDate || endDate < fromDate) return;
      occurrences.push({ ...base, startsAt: null, endsAt: null, startDate, endDate });
      return;
    }
    const start = moved
      ? Date.parse(exception.starts_at ?? '')
      : zonedInstant({ ...startWall!, date }, timeZone);
    const end = moved ? Date.parse(exception.ends_at ?? '') : start + durationMs;
    // Overlaps [from, to); a zero-length event counts at its start.
    if (!(start < toMs && (end > fromMs || (end === start && start >= fromMs)))) return;
    occurrences.push({
      ...base,
      startsAt: new Date(start).toISOString(),
      endsAt: new Date(end).toISOString(),
      startDate: null,
      endDate: null,
    });
  };

  if (!rule) {
    add(firstDate);
    return occurrences;
  }

  // A moved occurrence can come into the range from a date outside it.
  const movedDates = [...exceptions.values()]
    .filter((row) => row.status === 'moved')
    .map((row) => row.original_date);
  let lastDate = addDays(toDate, 1);
  for (const date of movedDates) if (date > lastDate) lastDate = date;
  if (rule.until && rule.until < lastDate) lastDate = rule.until;
  const windowStart = addDays(fromDate, -leadDays);
  const moved = new Set(movedDates);

  // Without a count, nothing before the range matters except a moved occurrence, so the
  // series can start there; with a count, every occurrence from the first is counted.
  let skipTo = windowStart;
  for (const date of movedDates) if (date < skipTo) skipTo = date;
  if (rule.count !== undefined || skipTo < firstDate) skipTo = firstDate;

  let produced = 0;
  for (const date of candidates(rule, firstDate, weekStart, skipTo)) {
    if (date > lastDate || (rule.count !== undefined && produced >= rule.count)) break;
    produced += 1;
    if (date >= windowStart || moved.has(date)) add(date);
  }

  return occurrences.sort((a, b) =>
    allDay
      ? (a.startDate ?? '').localeCompare(b.startDate ?? '')
      : Date.parse(a.startsAt ?? '') - Date.parse(b.startsAt ?? ''),
  );
}

/** The dates a rule produces, in order, from the series' first date or later from `skipTo`. */
function* candidates(
  rule: RepeatRule,
  first: string,
  weekStart: WeekStart,
  skipTo: string,
): Generator<string> {
  const skipDays = daysBetween(first, skipTo);
  if (rule.freq === 'daily') {
    for (let i = skipDays; i < skipDays + MAX_STEPS; i++) yield addDays(first, i);
    return;
  }
  if (rule.freq === 'weekly') {
    const days = new Set(rule.weekdays);
    const interval = rule.interval ?? 1;
    const firstWeek = startOfWeek(first, weekStart);
    // Whole cycles only, so the "every 2 weeks" parity is kept.
    const skip = Math.max(0, Math.floor(skipDays / (7 * interval)) - 1) * 7 * interval;
    for (let i = skip; i < skip + MAX_STEPS * interval; i++) {
      const date = addDays(first, i);
      const week = Math.floor(daysBetween(firstWeek, date) / 7);
      if (week % interval === 0 && days.has(isoWeekday(date))) yield date;
    }
    return;
  }
  // Monthly on the same date; months without it (the 31st in June) are skipped.
  const [year, month, day] = first.split('-').map(Number);
  const skip = Math.max(0, Math.floor(skipDays / 31) - 1);
  for (let i = skip; i < skip + MAX_STEPS / 10; i++) {
    const date = new Date(Date.UTC(year, month - 1 + i, day));
    if (date.getUTCDate() === day) yield date.toISOString().slice(0, 10);
  }
}
