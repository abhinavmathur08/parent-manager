import { stableId } from '@/lib/sync/stable-id';
import type { SyncRow, SyncTableDefinition } from '@/lib/sync/types';

/**
 * The calendar tables in the household sync layer (C-01.1, FR2-CAL-6, architecture section 3.5).
 * Plain definitions with no app imports, so the two-device harness can use them too.
 * `sync.ts` registers them with the sync layer.
 */
export const EVENTS = {
  name: 'events',
  // Parents see every event; others only shared ones (D-16, C-01.3).
  scoped: true,
  columns: {
    kind: 'text',
    title: 'text',
    all_day: 'boolean',
    starts_at: 'text',
    ends_at: 'text',
    start_date: 'text',
    end_date: 'text',
    place: 'text',
    notes: 'text',
    taking_user_id: 'text',
    shared: 'boolean',
    repeat: 'json',
    created_by: 'text',
    updated_by: 'text',
  },
} as const satisfies SyncTableDefinition;

export const EVENT_PEOPLE = {
  name: 'event_people',
  scoped: true,
  columns: {
    event_id: 'text',
    person_id: 'text',
  },
} as const satisfies SyncTableDefinition;

export const EVENT_REMINDERS = {
  name: 'event_reminders',
  scoped: true,
  columns: {
    event_id: 'text',
    offset_minutes: 'integer',
  },
} as const satisfies SyncTableDefinition;

/** One changed occurrence of a repeating event (C-01.2, FR2-CAL-4, R2-CAL-2). */
export const EVENT_EXCEPTIONS = {
  name: 'event_exceptions',
  scoped: true,
  columns: {
    event_id: 'text',
    original_date: 'text',
    status: 'text',
    starts_at: 'text',
    ends_at: 'text',
    start_date: 'text',
    end_date: 'text',
    taking_user_id: 'text',
  },
} as const satisfies SyncTableDefinition;

export const CALENDAR_TABLES = [EVENTS, EVENT_PEOPLE, EVENT_REMINDERS, EVENT_EXCEPTIONS] as const;

/** Event kinds, stored as identifiers; names come from translations (NFR2-L10N-1). */
export const EVENT_KINDS = [
  'kind.appointment',
  'kind.childcare',
  'kind.activity',
  'kind.family',
  'kind.other',
] as const;
export type EventKind = (typeof EVENT_KINDS)[number];

export function isEventKind(value: unknown): value is EventKind {
  return (EVENT_KINDS as readonly unknown[]).includes(value);
}

/** Reminder offsets in minutes before the start: at the time, 15 min, 1 h, 1 day, 2 days (FR2-REM-1). */
export const REMINDER_OFFSETS = [0, 15, 60, 1440, 2880] as const;
export type ReminderOffset = (typeof REMINDER_OFFSETS)[number];

/** Limits the database checks too. Reminder counts per tier are server settings (`calendar.reminders`). */
export const EVENT_LIMITS = {
  titleLength: 200,
  placeLength: 200,
  notesLength: 4000,
} as const;

/** The server's hint when an event has the most reminders its tier allows (FR2-PAY-1, trigger `reminders`). */
export const REMINDER_LIMIT_HINT = 'calendar.reminders_limit';

export type EventRow = SyncRow & {
  kind: EventKind;
  title: string;
  all_day: boolean;
  /** Instants for a timed event (R2-CAL-1); null when all day. */
  starts_at: string | null;
  ends_at: string | null;
  /** Inclusive dates in the household's timezone, `YYYY-MM-DD`, for an all-day event. */
  start_date: string | null;
  end_date: string | null;
  place: string | null;
  notes: string | null;
  taking_user_id: string | null;
  /** Visible to family members and caregivers (D-16). Only parents change it. */
  shared: boolean;
  /** The repeat rule, or null (C-01.2). */
  repeat: Record<string, unknown> | null;
  created_by: string | null;
  updated_by: string | null;
};

export type EventPersonRow = SyncRow & {
  event_id: string;
  person_id: string;
};

export type EventReminderRow = SyncRow & {
  event_id: string;
  offset_minutes: ReminderOffset;
};

/** moved: new times; skipped: deleted from the series; restored: a change undone. */
export type ExceptionStatus = 'moved' | 'skipped' | 'restored';

export type EventExceptionRow = SyncRow & {
  event_id: string;
  /** The occurrence's original date in the household's timezone, `YYYY-MM-DD`. */
  original_date: string;
  status: ExceptionStatus;
  starts_at: string | null;
  ends_at: string | null;
  start_date: string | null;
  end_date: string | null;
  taking_user_id: string | null;
};

/**
 * The ID of the exception row for one occurrence, the same on every device, so two devices
 * changing the same occurrence offline write one row (R2-CAL-2).
 */
export function exceptionId(eventId: string, originalDate: string): string {
  return stableId('event_exception', eventId, originalDate);
}
