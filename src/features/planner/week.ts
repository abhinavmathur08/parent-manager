/**
 * Calendar dates for the planner (FR-PLAN-1, FR-PLAN-2; spec 3.6 edge cases).
 *
 * A plan entry belongs to a calendar date in the household's timezone, written `YYYY-MM-DD`.
 * Dates are worked out as days since 1970-01-01 in UTC, which has no daylight-saving
 * changes, so adding a day or a week is always exact and a clock change never moves an
 * entry. Only "today" depends on a timezone.
 */

/** A calendar date, `YYYY-MM-DD`. */
export type PlanDate = string;

/** ISO weekday the week starts on: 1 is Monday, 7 is Sunday. */
export type WeekStart = 1 | 7;

const DAY_MS = 24 * 60 * 60 * 1000;
const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

export function isPlanDate(value: unknown): value is PlanDate {
  if (typeof value !== 'string') return false;
  const match = DATE_PATTERN.exec(value);
  if (!match) return false;
  return toDate(value).toISOString().slice(0, 10) === value;
}

/** Midnight UTC on that date, for arithmetic and for formatting with `timeZone: 'UTC'`. */
export function toDate(date: PlanDate): Date {
  const match = DATE_PATTERN.exec(date);
  if (!match) throw new Error(`Not a calendar date: ${date}`);
  return new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
}

function fromDate(date: Date): PlanDate {
  return date.toISOString().slice(0, 10);
}

export function addDays(date: PlanDate, days: number): PlanDate {
  return fromDate(new Date(toDate(date).getTime() + days * DAY_MS));
}

/** Whole days from `from` to `to`; negative if `to` is earlier. */
export function daysBetween(from: PlanDate, to: PlanDate): number {
  return Math.round((toDate(to).getTime() - toDate(from).getTime()) / DAY_MS);
}

/** ISO weekday: 1 is Monday, 7 is Sunday. */
export function isoWeekday(date: PlanDate): number {
  return ((toDate(date).getUTCDay() + 6) % 7) + 1;
}

/** The first day of the week that contains `date`, for a household's week start. */
export function startOfWeek(date: PlanDate, weekStart: WeekStart): PlanDate {
  return addDays(date, -((isoWeekday(date) - weekStart + 7) % 7));
}

/** The 7 dates of the week starting on `start`. */
export function weekDates(start: PlanDate): PlanDate[] {
  return Array.from({ length: 7 }, (_, i) => addDays(start, i));
}

export function inWeek(date: PlanDate, start: PlanDate): boolean {
  const offset = daysBetween(start, date);
  return offset >= 0 && offset < 7;
}

/**
 * Today's date in a timezone, such as the household's. An unknown timezone falls back to
 * the device's, so the planner still opens.
 */
export function todayIn(timeZone: string | null, now: Date = new Date()): PlanDate {
  const read = (zone: string | undefined) => {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: zone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(now);
    const part = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
    return `${part('year')}-${part('month')}-${part('day')}`;
  };
  try {
    return read(timeZone ?? undefined);
  } catch {
    return read(undefined);
  }
}
