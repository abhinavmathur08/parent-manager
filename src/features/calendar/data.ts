import { useMemo } from 'react';

import { useSyncedRows } from '@/lib/sync';

import {
  EVENT_EXCEPTIONS,
  EVENT_PEOPLE,
  EVENT_REMINDERS,
  EVENTS,
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
