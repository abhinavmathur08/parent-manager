/**
 * Busy days (B-01.1, D-18, R2-BUSY-1, FR2-BUSY-4, NFR2-PERF-3).
 *
 * A day is busy, in the household's timezone, when a timed event or a parent's busy block
 * overlaps the dinner window (16:00 to 19:00), or when the union of them between 07:00 and 21:00
 * covers 3 hours or more. All-day events never count. A member's mark ("busy" or "not busy")
 * overrides the rule for that day. The numbers are server settings (`app_config`
 * `calendar.busy_rule`, R2-PAY-1); `parseBusyRule` falls back to these defaults.
 *
 * Pure and synchronous, on the synced copy, so busy days work offline and for any week.
 * Detection is free (D-15): nothing here reads the entitlement.
 */
import { addDays } from '@/features/planner/week';

import { zonedInstant, type Occurrence } from './repeat';
import type { BusyBlockRow, BusyDayOverrideRow } from './tables';

/** Times are minutes after midnight on the household's clock; 1440 is the next midnight. */
export type BusyRule = {
  dinnerStart: number;
  dinnerEnd: number;
  dayStart: number;
  dayEnd: number;
  /** Booked minutes inside the day window that make a day busy. */
  bookedMinutes: number;
};

export const DEFAULT_BUSY_RULE: BusyRule = {
  dinnerStart: 16 * 60,
  dinnerEnd: 19 * 60,
  dayStart: 7 * 60,
  dayEnd: 21 * 60,
  bookedMinutes: 180,
};

export const BUSY_RULE_KEY = 'calendar.busy_rule';

const minuteOfDay = (value: unknown): value is number =>
  Number.isInteger(value) && (value as number) >= 0 && (value as number) <= 1440;

/** The rule from `app_config`, or the default for a missing or malformed value. */
export function parseBusyRule(value: unknown): BusyRule {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return DEFAULT_BUSY_RULE;
  const raw = value as Record<string, unknown>;
  const rule = {
    dinnerStart: raw.dinner_start,
    dinnerEnd: raw.dinner_end,
    dayStart: raw.day_start,
    dayEnd: raw.day_end,
    bookedMinutes: raw.booked_minutes,
  };
  const valid =
    minuteOfDay(rule.dinnerStart) &&
    minuteOfDay(rule.dinnerEnd) &&
    minuteOfDay(rule.dayStart) &&
    minuteOfDay(rule.dayEnd) &&
    minuteOfDay(rule.bookedMinutes) &&
    rule.dinnerStart < rule.dinnerEnd &&
    rule.dayStart < rule.dayEnd &&
    rule.bookedMinutes > 0;
  return valid ? (rule as BusyRule) : DEFAULT_BUSY_RULE;
}

/**
 * Why a day is busy, for the marker's text (FR2-BUSY-1): `dinner` "appointments after 4pm",
 * `booked` "6 hours booked", `marked` "marked busy". When both rule parts hold, `dinner` wins,
 * since it's the one that touches dinner.
 */
export type BusyReason = 'dinner' | 'booked' | 'marked';

export type BusyDay = {
  date: string;
  busy: boolean;
  /** Null when the day isn't busy. */
  reason: BusyReason | null;
  /** A member's mark decided the day (busy or not busy). */
  overridden: boolean;
  /** Booked minutes in the day window, events and blocks overlapping counted once. */
  bookedMinutes: number;
};

export type BusyInput = {
  /** The days to evaluate, `YYYY-MM-DD` in the household's timezone (usually a plan week). */
  dates: readonly string[];
  /** Expanded occurrences overlapping those days (`expandOccurrences`); all-day ones are ignored. */
  occurrences: readonly Occurrence[];
  /** Synced busy blocks; only parents' blocks count (R2-BUSY-1). */
  busyBlocks: readonly BusyBlockRow[];
  /** The household's parents' user IDs. */
  parentIds: ReadonlySet<string>;
  overrides: readonly BusyDayOverrideRow[];
  /** The household's IANA timezone. */
  timeZone: string;
  rule?: BusyRule;
};

type Interval = { start: number; end: number };

/** Each day's busy state, in the order of `dates`. */
export function busyDays(input: BusyInput): BusyDay[] {
  const { timeZone, rule = DEFAULT_BUSY_RULE } = input;

  const intervals: Interval[] = [];
  for (const occurrence of input.occurrences) {
    if (occurrence.allDay) continue;
    pushInterval(intervals, occurrence.startsAt, occurrence.endsAt);
  }
  for (const block of input.busyBlocks) {
    if (block.deleted_at || !input.parentIds.has(block.user_id)) continue;
    pushInterval(intervals, block.starts_at, block.ends_at);
  }
  intervals.sort((a, b) => a.start - b.start);

  // The newest live mark for each day; a cleared mark (busy null) leaves the rule in charge.
  const marks = new Map<string, BusyDayOverrideRow>();
  for (const row of input.overrides) {
    if (row.deleted_at) continue;
    const seen = marks.get(row.date);
    if (!seen || (row.updated_at ?? '') > (seen.updated_at ?? '')) marks.set(row.date, row);
  }

  const at = (date: string, minutes: number) =>
    zonedInstant(
      {
        date: addDays(date, Math.floor(minutes / 1440)),
        hour: Math.floor((minutes % 1440) / 60),
        minute: minutes % 60,
        second: 0,
        ms: 0,
      },
      timeZone,
    );

  return input.dates.map((date) => {
    const dayStart = at(date, rule.dayStart);
    const dayEnd = at(date, rule.dayEnd);
    const dinnerStart = at(date, rule.dinnerStart);
    const dinnerEnd = at(date, rule.dinnerEnd);

    let dinner = false;
    let booked = 0;
    let runStart = 0;
    let runEnd = -Infinity;
    for (const { start, end } of intervals) {
      if (start >= dayEnd && start >= dinnerEnd) break;
      // Touching the window counts; a zero-length event counts at its start.
      if (start < dinnerEnd && (end > dinnerStart || (end === start && start >= dinnerStart))) {
        dinner = true;
      }
      // The union inside the day window, from intervals sorted by start.
      const clippedStart = Math.max(start, dayStart);
      const clippedEnd = Math.min(end, dayEnd);
      if (clippedEnd <= clippedStart) continue;
      if (clippedStart > runEnd) {
        if (runEnd > runStart) booked += runEnd - runStart;
        runStart = clippedStart;
        runEnd = clippedEnd;
      } else if (clippedEnd > runEnd) {
        runEnd = clippedEnd;
      }
    }
    if (runEnd > runStart) booked += runEnd - runStart;
    const bookedMinutes = Math.floor(booked / 60_000);

    const ruleReason: BusyReason | null = dinner
      ? 'dinner'
      : bookedMinutes >= rule.bookedMinutes
        ? 'booked'
        : null;
    const mark = marks.get(date)?.busy;
    if (mark === true || mark === false) {
      return { date, busy: mark, reason: mark ? 'marked' : null, overridden: true, bookedMinutes };
    }
    return {
      date,
      busy: ruleReason !== null,
      reason: ruleReason,
      overridden: false,
      bookedMinutes,
    };
  });
}

function pushInterval(intervals: Interval[], startsAt: string | null, endsAt: string | null) {
  const start = Date.parse(startsAt ?? '');
  const end = Date.parse(endsAt ?? '');
  if (Number.isFinite(start) && Number.isFinite(end) && end >= start) {
    intervals.push({ start, end });
  }
}
