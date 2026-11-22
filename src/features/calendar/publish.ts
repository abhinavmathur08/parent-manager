/**
 * Published busy days (B-01.4, D-22, R2-BUSY-2).
 *
 * Family members' and caregivers' devices hold only shared events and their own busy blocks,
 * so they can't work out a day made busy by a parent's private event. Parents' devices run
 * `busyDays()` for today and the next 13 days and publish each day's result to `busy_days`:
 * the date, busy or not, and the fixed reason, nothing else. Members show markers from those
 * rows; parents keep using `busyDays()` directly.
 *
 * A day's row has a stable ID, and a device writes only when its result differs from the row,
 * so two parents with the same synced data write the same values and then stop.
 */
import { addDays, type PlanDate, type WeekStart } from '@/features/planner/week';
import type { SyncEngine } from '@/lib/sync/engine';

import { startOfDay } from './agenda';
import { busyDays, type BusyDay, type BusyRule } from './busy';
import { expandOccurrences, type Occurrence } from './repeat';
import {
  BUSY_BLOCKS,
  BUSY_DAY_OVERRIDES,
  BUSY_DAYS,
  busyDayId,
  EVENT_EXCEPTIONS,
  EVENTS,
  type BusyBlockRow,
  type BusyDayOverrideRow,
  type BusyDayRow,
  type EventExceptionRow,
  type EventRow,
} from './tables';

/** Today plus 13 days (PROPOSED): two plan weeks, whichever day the week starts. */
export const PUBLISH_DAYS = 14;

/** The tables whose changes can change a day's result. */
export const PUBLISH_INPUT_TABLES: ReadonlySet<string> = new Set([
  EVENTS.name,
  EVENT_EXCEPTIONS.name,
  BUSY_BLOCKS.name,
  BUSY_DAY_OVERRIDES.name,
]);

export function publishWindow(today: PlanDate, days = PUBLISH_DAYS): PlanDate[] {
  return Array.from({ length: days }, (_, i) => addDays(today, i));
}

export type BusyDayWrite = {
  kind: 'insert' | 'update';
  id: string;
  values: { date: string; busy: boolean; reason: BusyDayRow['reason'] };
};

/** The writes that bring the published rows in line with the computed days; none when they agree. */
export function busyDayWrites(
  householdId: string,
  computed: readonly BusyDay[],
  published: readonly BusyDayRow[],
): BusyDayWrite[] {
  const byDate = new Map(published.filter((row) => !row.deleted_at).map((row) => [row.date, row]));
  const writes: BusyDayWrite[] = [];
  for (const day of computed) {
    const values = { date: day.date, busy: day.busy, reason: day.busy ? day.reason : null };
    const row = byDate.get(day.date);
    if (!row) {
      writes.push({ kind: 'insert', id: busyDayId(householdId, day.date), values });
    } else if (row.busy !== values.busy || (row.reason ?? null) !== values.reason) {
      writes.push({ kind: 'update', id: row.id, values });
    }
  }
  return writes;
}

/** A day's marker as a member's device shows it: `bookedMinutes` is null when unknown. */
export type ShownBusyDay = Omit<BusyDay, 'bookedMinutes'> & { bookedMinutes: number | null };

/**
 * Busy days on a family member's or caregiver's device: their own household's marks first,
 * so a mark shows at once and offline (FR2-BUSY-4), then the published rows. A day with no row
 * (outside the window, or not yet published) isn't busy. Nothing here reveals why beyond the
 * fixed reason (R2-BUSY-2).
 */
export function publishedBusyDays(
  dates: readonly PlanDate[],
  published: readonly BusyDayRow[],
  overrides: readonly BusyDayOverrideRow[],
): ShownBusyDay[] {
  const rows = new Map(published.filter((row) => !row.deleted_at).map((row) => [row.date, row]));
  const marks = new Map<string, BusyDayOverrideRow>();
  for (const row of overrides) {
    if (row.deleted_at) continue;
    const seen = marks.get(row.date);
    if (!seen || (row.updated_at ?? '') > (seen.updated_at ?? '')) marks.set(row.date, row);
  }
  return dates.map((date) => {
    const mark = marks.get(date)?.busy;
    if (mark === true || mark === false) {
      return {
        date,
        busy: mark,
        reason: mark ? 'marked' : null,
        overridden: true,
        bookedMinutes: null,
      };
    }
    const row = rows.get(date);
    const busy = row?.busy === true;
    return {
      date,
      busy,
      reason: busy ? (row?.reason ?? null) : null,
      overridden: row?.reason === 'marked',
      bookedMinutes: null,
    };
  });
}

export type PublishSource = {
  householdId: string;
  today: PlanDate;
  timeZone: string;
  weekStart: WeekStart;
  /** The household's parents. A parent's device always includes itself. */
  parentIds: ReadonlySet<string>;
  rule: BusyRule;
};

/** The busy-day engine over the window, from the local copy. */
export async function computeWindow(
  store: SyncEngine['store'],
  source: PublishSource,
): Promise<BusyDay[]> {
  const dates = publishWindow(source.today);
  const [events, exceptions, blocks, overrides] = await Promise.all([
    store.rows(EVENTS.name) as Promise<EventRow[]>,
    store.rows(EVENT_EXCEPTIONS.name) as Promise<EventExceptionRow[]>,
    store.rows(BUSY_BLOCKS.name) as Promise<BusyBlockRow[]>,
    store.rows(BUSY_DAY_OVERRIDES.name) as Promise<BusyDayOverrideRow[]>,
  ]);
  const range = {
    timeZone: source.timeZone,
    weekStart: source.weekStart,
    from: new Date(startOfDay(dates[0], source.timeZone)),
    to: new Date(startOfDay(addDays(dates[dates.length - 1], 1), source.timeZone)),
    exceptions,
  };
  const occurrences: Occurrence[] = events.flatMap((event) => expandOccurrences(event, range));
  return busyDays({
    dates,
    occurrences,
    busyBlocks: blocks,
    parentIds: source.parentIds,
    overrides,
    timeZone: source.timeZone,
    rule: source.rule,
  });
}

/**
 * Works out the window on a parent's device and writes what changed through the sync layer.
 * Returns the number of rows written.
 */
export async function publishBusyDays(
  engine: Pick<SyncEngine, 'store' | 'insert' | 'update'>,
  source: PublishSource,
): Promise<number> {
  const computed = await computeWindow(engine.store, source);
  const published = (await engine.store.rows(BUSY_DAYS.name)) as BusyDayRow[];
  const writes = busyDayWrites(source.householdId, computed, published);
  for (const write of writes) {
    if (write.kind === 'insert') await engine.insert(BUSY_DAYS.name, write.id, write.values);
    else await engine.update(BUSY_DAYS.name, write.id, write.values);
  }
  return writes.length;
}
