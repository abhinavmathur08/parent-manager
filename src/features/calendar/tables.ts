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

/**
 * A member's busy time from their device calendar (B-01.1, D-14): only the member, start and
 * end, never a title (R2-BUSY-3). Parents see every block; others only their own (C9).
 */
export const BUSY_BLOCKS = {
  name: 'busy_blocks',
  scoped: true,
  columns: {
    user_id: 'text',
    starts_at: 'text',
    ends_at: 'text',
  },
} as const satisfies SyncTableDefinition;

/** A day marked busy or not busy by a member (FR2-BUSY-4); `busy` null is a cleared mark. */
export const BUSY_DAY_OVERRIDES = {
  name: 'busy_day_overrides',
  columns: {
    date: 'text',
    busy: 'boolean',
    set_by: 'text',
  },
} as const satisfies SyncTableDefinition;

/**
 * Each day's busy state, published by parents' devices for every member (B-01.4, D-23,
 * R2-BUSY-2): the date, busy or not, and the fixed reason, never titles, times or event IDs.
 */
export const BUSY_DAYS = {
  name: 'busy_days',
  columns: {
    date: 'text',
    busy: 'boolean',
    reason: 'text',
  },
} as const satisfies SyncTableDefinition;

export const BUSY_TABLES = [BUSY_BLOCKS, BUSY_DAY_OVERRIDES, BUSY_DAYS] as const;

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

export type BusyBlockRow = SyncRow & {
  /** Set by the server to the member who shared it. */
  user_id: string;
  starts_at: string;
  ends_at: string;
};

export type BusyDayOverrideRow = SyncRow & {
  /** The day in the household's timezone, `YYYY-MM-DD`. */
  date: string;
  /** Marked busy (true) or not busy (false); null when the mark was cleared. */
  busy: boolean | null;
  set_by: string | null;
};

/**
 * The ID of a day's override row, the same on every device, so two members marking the same
 * day offline write one row. Clearing a mark sets `busy` to null rather than deleting the row.
 */
export function overrideId(householdId: string, date: string): string {
  return stableId('busy_day_override', householdId, date);
}

export type BusyDayRow = SyncRow & {
  /** The day in the household's timezone, `YYYY-MM-DD`. */
  date: string;
  busy: boolean;
  /** `dinner`, `booked` or `marked` when busy; null otherwise. */
  reason: 'dinner' | 'booked' | 'marked' | null;
};

/**
 * The ID of a day's published row, the same on every device, so two parents publishing the
 * same day write one row (B-01.4).
 */
export function busyDayId(householdId: string, date: string): string {
  return stableId('busy_day', householdId, date);
}
