/**
 * The event editor's draft (S-37, FR2-CAL-2, FR2-REM-1): what the sheet holds while it's open,
 * saved on the device so it survives the app being killed (NFR-A11Y-8), and turned into an
 * `events` row on save. Times are wall times on the household's clock until then.
 */
import { addDays, daysBetween, isoWeekday, type PlanDate } from '@/features/planner/week';

import {
  parseRepeat,
  REPEAT_LIMITS,
  wallTime,
  zonedInstant,
  type Occurrence,
  type RepeatRule,
} from './repeat';
import {
  EVENT_LIMITS,
  REMINDER_OFFSETS,
  type EventKind,
  type EventRow,
  type ReminderOffset,
} from './tables';

/** The repeat picker's choices (FR2-CAL-4); "every 2 weeks" is a weekly rule with interval 2. */
export const REPEAT_CHOICES = ['none', 'daily', 'weekly', 'biweekly', 'monthly'] as const;
export type RepeatChoice = (typeof REPEAT_CHOICES)[number];
export const REPEAT_ENDS = ['never', 'until', 'count'] as const;
export type RepeatEnd = (typeof REPEAT_ENDS)[number];

export type RepeatDraft = {
  choice: RepeatChoice;
  /** ISO weekdays for weekly rules, 1 Monday to 7 Sunday. */
  weekdays: number[];
  end: RepeatEnd;
  /** The last date, when it ends on a date. */
  until: PlanDate;
  /** How many times, when it ends after a count. */
  count: number;
};

export const DEFAULT_REPEAT_COUNT = 10;
/** "Ends on a date" starts 3 months out (PROPOSED). */
const DEFAULT_UNTIL_DAYS = 91;

export function defaultRepeat(date: PlanDate): RepeatDraft {
  return {
    choice: 'none',
    weekdays: [isoWeekday(date)],
    end: 'never',
    until: addDays(date, DEFAULT_UNTIL_DAYS),
    count: DEFAULT_REPEAT_COUNT,
  };
}

export type EventDraft = {
  title: string;
  kind: EventKind;
  allDay: boolean;
  /** The start date, on the household's clock. */
  date: PlanDate;
  /** Minutes after midnight on the household's clock. */
  startMinutes: number;
  /** A timed event's length; the end is the start plus this. */
  lengthMinutes: number;
  /** An all-day event's length in days, 1 or more. */
  days: number;
  personIds: string[];
  takingUserId: string | null;
  place: string;
  notes: string;
  reminders: ReminderOffset[];
  shared: boolean;
  /** Set once the member changes sharing, so a kind change no longer decides it. */
  sharedChosen: boolean;
  /** Missing from drafts saved before repeats; read it through `repeatOf`. */
  repeat?: RepeatDraft;
};

export function repeatOf(draft: EventDraft): RepeatDraft {
  return draft.repeat ?? defaultRepeat(draft.date);
}

/** The rule stored on the event (C-01.2), or null when it doesn't repeat. */
export function repeatRule(draft: EventDraft): RepeatRule | null {
  const repeat = repeatOf(draft);
  if (repeat.choice === 'none') return null;
  const rule: RepeatRule =
    repeat.choice === 'weekly' || repeat.choice === 'biweekly'
      ? {
          freq: 'weekly',
          ...(repeat.choice === 'biweekly' ? { interval: 2 as const } : {}),
          weekdays: [...repeat.weekdays].sort((a, b) => a - b),
        }
      : { freq: repeat.choice };
  if (repeat.end === 'until') rule.until = repeat.until < draft.date ? draft.date : repeat.until;
  if (repeat.end === 'count') {
    rule.count = Math.min(REPEAT_LIMITS.maxCount, Math.max(1, Math.round(repeat.count)));
  }
  return rule;
}

/** The picker's state for a stored rule. */
export function repeatFromRule(value: unknown, date: PlanDate): RepeatDraft {
  const rule = parseRepeat(value);
  const repeat = defaultRepeat(date);
  if (!rule) return repeat;
  const choice: RepeatChoice =
    rule.freq === 'weekly' ? (rule.interval === 2 ? 'biweekly' : 'weekly') : rule.freq;
  return {
    ...repeat,
    choice,
    weekdays: rule.weekdays ?? repeat.weekdays,
    end: rule.until ? 'until' : rule.count ? 'count' : 'never',
    until: rule.until ?? repeat.until,
    count: rule.count ?? repeat.count,
  };
}

export const DEFAULT_LENGTH_MINUTES = 60;
export const LENGTH_STEP_MINUTES = 15;
export const MAX_LENGTH_MINUTES = 24 * 60;
export const MAX_ALL_DAY_DAYS = 31;
/** New appointments remind a day before (FR2-REM-1). */
export const APPOINTMENT_REMINDER: ReminderOffset = 1440;

/**
 * The reminders allowed per event (FR2-REM-1, D-15). The server enforces them from
 * `app_config` `calendar.reminders`; the app mirrors them to offer the Premium sheet.
 */
export const REMINDERS_PER_EVENT = { free: 1, premium: 5 } as const;

/** Childcare is shared with family and caregivers by default (FR2-CAL-2, PROPOSED). */
export function sharedByDefault(kind: EventKind): boolean {
  return kind === 'kind.childcare';
}

/**
 * A new event with FR2-CAL-2's defaults: an appointment today at the next whole hour on the
 * household's clock, an hour long, reminding a day before. Only parents may keep an event
 * private, so others always create shared events (spec section 2, C3).
 */
export function newDraft(now: Date, timeZone: string, isParent: boolean): EventDraft {
  const wall = wallTime(now.getTime(), timeZone);
  const next = wall.hour + 1;
  const kind: EventKind = 'kind.appointment';
  return {
    title: '',
    kind,
    allDay: false,
    date: next >= 24 ? addDays(wall.date, 1) : wall.date,
    startMinutes: (next % 24) * 60,
    lengthMinutes: DEFAULT_LENGTH_MINUTES,
    days: 1,
    personIds: [],
    takingUserId: null,
    place: '',
    notes: '',
    reminders: [APPOINTMENT_REMINDER],
    shared: !isParent || sharedByDefault(kind),
    sharedChosen: !isParent,
  };
}

/** Changing the kind changes sharing too, until the member has chosen it themselves. */
export function withKind(draft: EventDraft, kind: EventKind): EventDraft {
  return { ...draft, kind, shared: draft.sharedChosen ? draft.shared : sharedByDefault(kind) };
}

/** Turns a reminder on or off, keeping them in offset order and within the tier's limit. */
export function toggleReminder(
  draft: EventDraft,
  offset: ReminderOffset,
  limit: number,
): { draft: EventDraft; overLimit: boolean } {
  if (draft.reminders.includes(offset)) {
    return {
      draft: { ...draft, reminders: draft.reminders.filter((r) => r !== offset) },
      overLimit: false,
    };
  }
  if (draft.reminders.length >= limit) return { draft, overLimit: true };
  const reminders = [...draft.reminders, offset].sort((a, b) => a - b);
  return { draft: { ...draft, reminders }, overLimit: false };
}

/** The instant a wall time on a date is on the household's clock. */
export function wallInstant(date: PlanDate, minutes: number, timeZone: string): Date {
  const hour = Math.floor(minutes / 60);
  return new Date(zonedInstant({ date, hour, minute: minutes % 60, second: 0, ms: 0 }, timeZone));
}

/** The title is the only required field; the rest have defaults or are optional. */
export function canSave(draft: EventDraft): boolean {
  const title = draft.title.trim();
  const repeat = repeatOf(draft);
  const weekly = repeat.choice === 'weekly' || repeat.choice === 'biweekly';
  return (
    title.length > 0 &&
    title.length <= EVENT_LIMITS.titleLength &&
    !(weekly && !repeat.weekdays.length)
  );
}

export type EventValues = Pick<
  EventRow,
  | 'kind'
  | 'title'
  | 'all_day'
  | 'starts_at'
  | 'ends_at'
  | 'start_date'
  | 'end_date'
  | 'place'
  | 'notes'
  | 'taking_user_id'
  | 'shared'
  | 'repeat'
>;

/** The event's columns from a draft (R2-CAL-1): instants when timed, dates when all day. */
export function draftValues(draft: EventDraft, timeZone: string): EventValues {
  const start = wallInstant(draft.date, draft.startMinutes, timeZone);
  const text = (value: string, max: number) => value.trim().slice(0, max) || null;
  return {
    kind: draft.kind,
    title: draft.title.trim().slice(0, EVENT_LIMITS.titleLength),
    all_day: draft.allDay,
    starts_at: draft.allDay ? null : start.toISOString(),
    ends_at: draft.allDay
      ? null
      : new Date(start.getTime() + draft.lengthMinutes * 60_000).toISOString(),
    start_date: draft.allDay ? draft.date : null,
    end_date: draft.allDay ? addDays(draft.date, draft.days - 1) : null,
    place: text(draft.place, EVENT_LIMITS.placeLength),
    notes: text(draft.notes, EVENT_LIMITS.notesLength),
    taking_user_id: draft.takingUserId,
    shared: draft.shared,
    repeat: repeatRule(draft),
  };
}

/** The draft for editing an event, with its people and reminders (S-37 from S-38). */
export function draftFromEvent(
  event: EventRow,
  personIds: readonly string[],
  reminders: readonly number[],
  timeZone: string,
): EventDraft {
  const start = event.starts_at ? wallTime(Date.parse(event.starts_at), timeZone) : null;
  const length =
    event.starts_at && event.ends_at
      ? Math.round((Date.parse(event.ends_at) - Date.parse(event.starts_at)) / 60_000)
      : DEFAULT_LENGTH_MINUTES;
  const date = (event.all_day ? event.start_date : start?.date) ?? '1970-01-01';
  return {
    title: event.title,
    kind: event.kind,
    allDay: event.all_day,
    date,
    startMinutes: start ? start.hour * 60 + start.minute : 9 * 60,
    lengthMinutes: Math.min(MAX_LENGTH_MINUTES, Math.max(LENGTH_STEP_MINUTES, length)),
    days: event.all_day && event.end_date ? daysBetween(date, event.end_date) + 1 : 1,
    personIds: [...personIds],
    takingUserId: event.taking_user_id,
    place: event.place ?? '',
    notes: event.notes ?? '',
    reminders: REMINDER_OFFSETS.filter((offset) => reminders.includes(offset)),
    shared: event.shared,
    sharedChosen: true,
    repeat: repeatFromRule(event.repeat, date),
  };
}

/**
 * The draft for changing one occurrence ("this event", FR2-CAL-4): the event's details with
 * the occurrence's own times. Only times and taking are saved, as an exception.
 */
export function draftFromOccurrence(
  event: EventRow,
  occurrence: Occurrence,
  personIds: readonly string[],
  reminders: readonly number[],
  timeZone: string,
): EventDraft {
  return draftFromEvent(
    {
      ...event,
      starts_at: occurrence.startsAt,
      ends_at: occurrence.endsAt,
      start_date: occurrence.startDate,
      end_date: occurrence.endDate,
      taking_user_id: occurrence.takingUserId,
    },
    personIds,
    reminders,
    timeZone,
  );
}
