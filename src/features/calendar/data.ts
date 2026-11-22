import { useMemo } from 'react';

import { useSyncedRows } from '@/lib/sync';

import {
  BUSY_BLOCKS,
  BUSY_DAY_OVERRIDES,
  BUSY_DAYS,
  EVENT_EXCEPTIONS,
  EVENT_PEOPLE,
  EVENT_REMINDERS,
  EVENTS,
  type BusyBlockRow,
  type BusyDayOverrideRow,
  type BusyDayRow,
  type EventExceptionRow,
  type EventPersonRow,
  type EventReminderRow,
  type EventRow,
} from './tables';

const live = <T extends { deleted_at: string | null }>(rows: readonly T[]) =>
  rows.filter((row) => !row.deleted_at);

/**
 * The household's calendar from the local copy, so it reads offline (FR2-CAL-6). Rows the
 * member can't see never reach the copy (C-01.3). Tombstones are left out.
 */
export function useCalendarRows() {
  const events = useSyncedRows<EventRow>(EVENTS.name);
  const exceptions = useSyncedRows<EventExceptionRow>(EVENT_EXCEPTIONS.name);
  const people = useSyncedRows<EventPersonRow>(EVENT_PEOPLE.name);
  const reminders = useSyncedRows<EventReminderRow>(EVENT_REMINDERS.name);
  return {
    events: useMemo(() => live(events.rows), [events.rows]),
    exceptions: useMemo(() => live(exceptions.rows), [exceptions.rows]),
    people: useMemo(() => live(people.rows), [people.rows]),
    reminders: useMemo(() => live(reminders.rows), [reminders.rows]),
    loading: events.loading || exceptions.loading,
  };
}

/** Busy blocks, marks and published busy days from the local copy (B-01.1, B-01.4). */
export function useBusyRows() {
  const blocks = useSyncedRows<BusyBlockRow>(BUSY_BLOCKS.name);
  const overrides = useSyncedRows<BusyDayOverrideRow>(BUSY_DAY_OVERRIDES.name);
  const published = useSyncedRows<BusyDayRow>(BUSY_DAYS.name);
  return {
    blocks: useMemo(() => live(blocks.rows), [blocks.rows]),
    overrides: useMemo(() => live(overrides.rows), [overrides.rows]),
    published: useMemo(() => live(published.rows), [published.rows]),
  };
}
