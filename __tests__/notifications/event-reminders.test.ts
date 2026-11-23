import type { TFunction } from 'i18next';

import type { EventExceptionRow, EventReminderRow, EventRow } from '@/features/calendar/tables';
import {
  eventReminderNotification,
  eventReminderText,
} from '@/features/notifications/event-reminder-scheduler';
import {
  afterQuietHours,
  eventReminderSchedule,
  firstReminderIds,
  type EventReminderInput,
} from '@/features/notifications/event-reminders';
import { routeFor } from '@/features/notifications/inbox';

jest.mock('@/lib/notifications/push', () => ({
  DEFAULT_CHANNEL_ID: 'default',
  readPushPermission: jest.fn(),
}));
jest.mock('expo-sqlite/kv-store', () => ({
  __esModule: true,
  default: { getItemSync: () => null, setItemSync: () => undefined },
}));
jest.mock('@/features/calendar/data', () => ({ useCalendarRows: jest.fn() }));
jest.mock('@/features/calendar/use-members', () => ({ useCalendarMembers: jest.fn() }));
jest.mock('@/features/subscription/entitlement', () => ({ useEntitlement: jest.fn() }));

const NY = 'America/New_York';

const event = (id: string, over: Partial<EventRow> = {}) =>
  ({
    id,
    household_id: 'hh',
    kind: 'kind.appointment',
    title: 'Pediatrician',
    all_day: false,
    // Wednesday 25 November 2026, 10:00 in New York.
    starts_at: '2026-11-25T15:00:00.000Z',
    ends_at: '2026-11-25T16:00:00.000Z',
    start_date: null,
    end_date: null,
    place: 'Main St clinic',
    notes: 'Bring the red book',
    taking_user_id: null,
    shared: false,
    repeat: null,
    created_by: 'u1',
    updated_by: 'u1',
    version: 1,
    created_at: '2026-11-20T10:00:00Z',
    updated_at: null,
    deleted_at: null,
    ...over,
  }) as EventRow;

const reminder = (
  id: string,
  eventId: string,
  offset: number,
  created = '2026-11-20T10:00:00Z',
  over: Partial<EventReminderRow> = {},
) =>
  ({
    id,
    household_id: 'hh',
    event_id: eventId,
    offset_minutes: offset,
    version: 1,
    created_at: created,
    updated_at: null,
    deleted_at: null,
    ...over,
  }) as EventReminderRow;

const base: EventReminderInput = {
  events: [event('e1')],
  exceptions: [],
  reminders: [],
  timeZone: NY,
  weekStart: 1,
  // Sunday 22 November 2026, 12:00 in New York.
  now: new Date('2026-11-22T17:00:00Z'),
  premium: true,
  quietStartMinute: 21 * 60,
  quietEndMinute: 7 * 60,
};

const iso = (d: Date) => d.toISOString();

describe('event reminders (FR2-REM-2)', () => {
  it('reminds at the offset before the start, nearest first, naming the occurrence', () => {
    const list = eventReminderSchedule({
      ...base,
      reminders: [reminder('r1', 'e1', 1440), reminder('r2', 'e1', 60, '2026-11-20T11:00:00Z')],
    });
    expect(list.map((r) => [r.id, iso(r.fireAt)])).toEqual([
      ['event.e1.2026-11-25.1440', '2026-11-24T15:00:00.000Z'],
      ['event.e1.2026-11-25.60', '2026-11-25T14:00:00.000Z'],
    ]);
    expect(list[0]).toMatchObject({ eventId: 'e1', originalDate: '2026-11-25', allDay: false });
  });

  it('skips events and reminders that were deleted, and times already past', () => {
    expect(
      eventReminderSchedule({
        ...base,
        events: [event('e1'), event('gone', { deleted_at: 'x' })],
        reminders: [
          reminder('r1', 'e1', 1440, undefined, { deleted_at: 'x' }),
          reminder('r2', 'gone', 60),
          // 2 days before is Monday 23rd: still ahead. Then move "now" past it.
          reminder('r3', 'e1', 2880),
        ],
        now: new Date('2026-11-23T16:00:00Z'),
      }),
    ).toEqual([]);
  });

  it('looks two weeks ahead only', () => {
    const later = event('e2', {
      starts_at: '2026-12-10T15:00:00.000Z',
      ends_at: '2026-12-10T16:00:00.000Z',
    });
    expect(
      eventReminderSchedule({ ...base, events: [later], reminders: [reminder('r', 'e2', 60)] }),
    ).toEqual([]);
  });

  it('moves a reminder in quiet hours to their end, in the household timezone', () => {
    // 07:30 start: 1 hour before is 06:30, inside 21:00 to 07:00, so it goes at 07:00.
    const early = event('e1', {
      starts_at: '2026-11-25T12:30:00.000Z',
      ends_at: '2026-11-25T13:30:00.000Z',
    });
    const [r] = eventReminderSchedule({
      ...base,
      events: [early],
      reminders: [reminder('r', 'e1', 60)],
    });
    expect(iso(r.fireAt)).toBe('2026-11-25T12:00:00.000Z');
  });

  it('always sends "at the time", and drops one that quiet hours would push past the start', () => {
    // 06:00 start: "at the time" fires at 06:00; 15 minutes before would wait until 07:00.
    const dawn = event('e1', {
      starts_at: '2026-11-25T11:00:00.000Z',
      ends_at: '2026-11-25T12:00:00.000Z',
    });
    const list = eventReminderSchedule({
      ...base,
      events: [dawn],
      reminders: [reminder('a', 'e1', 0), reminder('b', 'e1', 15, '2026-11-20T11:00:00Z')],
    });
    expect(list.map((r) => [r.offsetMinutes, iso(r.fireAt)])).toEqual([
      [0, '2026-11-25T11:00:00.000Z'],
    ]);
  });

  it('merges two reminders that quiet hours move to the same minute', () => {
    // 07:10 start: 1 hour before (06:10) and 15 minutes before (06:55) both wait until 07:00.
    const early = event('e1', {
      starts_at: '2026-11-25T12:10:00.000Z',
      ends_at: '2026-11-25T13:00:00.000Z',
    });
    const list = eventReminderSchedule({
      ...base,
      events: [early],
      reminders: [reminder('a', 'e1', 60), reminder('b', 'e1', 15, '2026-11-20T11:00:00Z')],
    });
    expect(list.map((r) => [r.offsetMinutes, iso(r.fireAt)])).toEqual([
      [60, '2026-11-25T12:00:00.000Z'],
    ]);
  });

  it('drops reminders a late-night event would only get after it started', () => {
    // 23:30 start: 1 hour and 15 minutes before both fall in quiet hours, which end next day.
    const late = event('e1', {
      starts_at: '2026-11-26T04:30:00.000Z',
      ends_at: '2026-11-26T05:00:00.000Z',
    });
    expect(
      eventReminderSchedule({
        ...base,
        events: [late],
        reminders: [reminder('a', 'e1', 60), reminder('b', 'e1', 15, '2026-11-20T11:00:00Z')],
      }),
    ).toEqual([]);
  });

  it('counts an all-day event from 09:00 household time on its first day', () => {
    const day = event('e1', {
      all_day: true,
      starts_at: null,
      ends_at: null,
      start_date: '2026-11-25',
      end_date: '2026-11-26',
    });
    const list = eventReminderSchedule({
      ...base,
      events: [day],
      reminders: [reminder('a', 'e1', 1440), reminder('b', 'e1', 0, '2026-11-20T11:00:00Z')],
    });
    expect(list.map((r) => iso(r.fireAt))).toEqual([
      '2026-11-24T14:00:00.000Z',
      '2026-11-25T14:00:00.000Z',
    ]);
    expect(list[0].allDay).toBe(true);
  });

  it('reminds for each occurrence of a repeat, leaving out skipped ones and following moves', () => {
    const weekly = event('e1', {
      // Wednesdays at 10:00 from 25 November.
      repeat: { freq: 'weekly', weekdays: [3] },
    });
    const exceptions = [
      {
        id: 'x1',
        household_id: 'hh',
        event_id: 'e1',
        original_date: '2026-12-02',
        status: 'skipped',
        starts_at: null,
        ends_at: null,
        start_date: null,
        end_date: null,
        taking_user_id: null,
        version: 1,
        created_at: null,
        updated_at: null,
        deleted_at: null,
      },
      {
        id: 'x2',
        household_id: 'hh',
        event_id: 'e1',
        original_date: '2026-11-25',
        status: 'moved',
        starts_at: '2026-11-25T20:00:00.000Z',
        ends_at: '2026-11-25T21:00:00.000Z',
        start_date: null,
        end_date: null,
        taking_user_id: 'u2',
        version: 1,
        created_at: null,
        updated_at: null,
        deleted_at: null,
      },
    ] as EventExceptionRow[];
    const list = eventReminderSchedule({
      ...base,
      events: [weekly],
      exceptions,
      reminders: [reminder('r', 'e1', 60)],
    });
    expect(list.map((r) => [r.originalDate, iso(r.fireAt), r.takingUserId])).toEqual([
      ['2026-11-25', '2026-11-25T19:00:00.000Z', 'u2'],
    ]);
  });

  it('keeps local time across a daylight-saving change', () => {
    // Mondays at 10:00 New York from 8 March 2027; clocks go forward on 14 March.
    const weekly = event('e1', {
      starts_at: '2027-03-08T15:00:00.000Z',
      ends_at: '2027-03-08T16:00:00.000Z',
      repeat: { freq: 'weekly', weekdays: [1] },
    });
    const list = eventReminderSchedule({
      ...base,
      events: [weekly],
      reminders: [reminder('r', 'e1', 1440)],
      now: new Date('2027-03-09T12:00:00Z'),
    });
    // Sunday 14 March, 10:00 EDT, is 14:00 UTC.
    expect(iso(list[0].fireAt)).toBe('2027-03-14T14:00:00.000Z');
  });
});

describe('on a lapse (FR2-REM-6)', () => {
  const reminders = [
    reminder('later', 'e1', 60, '2026-11-21T09:00:00Z'),
    reminder('first', 'e1', 1440, '2026-11-20T09:00:00Z'),
    reminder('offline', 'e1', 15, null as unknown as string),
  ];

  it("keeps only each event's first reminder working, without deleting the others", () => {
    expect([...firstReminderIds(reminders)]).toEqual(['first']);
    const free = eventReminderSchedule({ ...base, reminders, premium: false });
    expect(free.map((r) => r.offsetMinutes)).toEqual([1440]);
    const premium = eventReminderSchedule({ ...base, reminders, premium: true });
    expect(premium.map((r) => r.offsetMinutes)).toEqual([1440, 60, 15]);
  });

  it('breaks a tie on the set time by ID, so every device agrees', () => {
    const tie = [reminder('b', 'e1', 60), reminder('a', 'e1', 15)];
    expect([...firstReminderIds(tie)]).toEqual(['a']);
  });
});

describe('quiet hours in the household timezone', () => {
  it('is unchanged outside quiet hours, and none when start equals end', () => {
    const noon = Date.parse('2026-11-25T17:00:00Z');
    expect(afterQuietHours(noon, NY, 1260, 420)).toBe(noon);
    const night = Date.parse('2026-11-26T03:00:00Z');
    expect(afterQuietHours(night, NY, 0, 0)).toBe(night);
  });

  it('moves a late-evening time to the next morning', () => {
    // 22:00 Wednesday New York to 07:00 Thursday.
    expect(new Date(afterQuietHours(Date.parse('2026-11-26T03:00:00Z'), NY, 1260, 420))).toEqual(
      new Date('2026-11-26T12:00:00Z'),
    );
  });
});

describe('reminder text (FR2-REM-3)', () => {
  const t = ((key: string, values?: Record<string, string>) =>
    values ? `${key} ${JSON.stringify(values)}` : key) as unknown as TFunction;
  const [r] = eventReminderSchedule({ ...base, reminders: [reminder('r', 'e1', 1440)] });
  const options = {
    t,
    locale: 'en-US',
    timeZone: NY,
    userId: 'me',
    members: [{ userId: 'u2', role: 'parent' as const, joinedAt: '', displayName: 'Sam' }],
    details: false,
  };

  it('names only the kind, time and taking member by default', () => {
    const text = eventReminderText(r, options);
    expect(text.title).toBe('calendar.kinds.appointment');
    expect(text.body).toContain('notifications.event.tomorrow');
    expect(text.body).toContain('10:00');
    expect(text.body).toContain('notifications.event.takingNobody');
    const all = JSON.stringify(text);
    expect(all).not.toContain('Pediatrician');
    expect(all).not.toContain('Main St');
    expect(all).not.toContain('red book');
  });

  it('adds the title and place, never notes, when details are on', () => {
    const text = eventReminderText(r, { ...options, details: true });
    expect(text.title).toBe('Pediatrician');
    expect(text.body).toContain('Main St clinic');
    expect(JSON.stringify(text)).not.toContain('red book');
  });

  it('says who is taking: me, a named member, or a member not loaded yet', () => {
    expect(eventReminderText({ ...r, takingUserId: 'me' }, options).body).toContain(
      'notifications.event.takingYou',
    );
    expect(eventReminderText({ ...r, takingUserId: 'u2' }, options).body).toContain('Sam');
    expect(eventReminderText({ ...r, takingUserId: 'u9' }, options).body).toContain(
      'notifications.event.takingMember',
    );
  });
});

describe('opening a reminder', () => {
  it('opens the occurrence it was for, with IDs only in its data', () => {
    const [r] = eventReminderSchedule({ ...base, reminders: [reminder('r', 'e1', 60)] });
    const n = eventReminderNotification(r, { title: 'Appointment', body: 'Today at 10:00 AM' });
    expect(n.data).toEqual({ type: 'calendar_reminders', event_id: 'e1', date: '2026-11-25' });
    expect(n.categoryIdentifier).toBe('calendar_reminders');
    expect(routeFor('calendar_reminders', n.data)).toEqual({
      pathname: '/calendar/[id]',
      params: { id: 'e1', date: '2026-11-25' },
    });
    expect(routeFor('calendar_reminders')).toBe('/calendar');
  });
});
