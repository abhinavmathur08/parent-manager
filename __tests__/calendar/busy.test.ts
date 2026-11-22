import {
  busyDays,
  DEFAULT_BUSY_RULE,
  parseBusyRule,
  type BusyInput,
} from '@/features/calendar/busy';
import { expandOccurrences, zonedInstant, type Occurrence } from '@/features/calendar/repeat';
import { overrideId, type BusyBlockRow, type BusyDayOverrideRow } from '@/features/calendar/tables';
import { weekDates } from '@/features/planner/week';

const NY = 'America/New_York';
const SYDNEY = 'Australia/Sydney';
const PARENT = 'parent-1';
const FAMILY = 'family-1';

function instant(date: string, time: string, tz: string) {
  const [hour, minute] = time.split(':').map(Number);
  return new Date(zonedInstant({ date, hour, minute, second: 0, ms: 0 }, tz)).toISOString();
}

let seq = 0;
function timed(date: string, from: string, to: string, tz = NY): Occurrence {
  return {
    eventId: `event-${++seq}`,
    originalDate: date,
    allDay: false,
    startsAt: instant(date, from, tz),
    endsAt: instant(date, to, tz),
    startDate: null,
    endDate: null,
    takingUserId: null,
    moved: false,
  };
}

const sync = { version: 1, created_at: '', updated_at: '2026-12-01T00:00:00Z', deleted_at: null };

function block(user: string, date: string, from: string, to: string, tz = NY): BusyBlockRow {
  return {
    ...sync,
    id: `block-${++seq}`,
    household_id: 'h',
    user_id: user,
    starts_at: instant(date, from, tz),
    ends_at: instant(date, to, tz),
  };
}

function mark(date: string, busy: boolean | null, updatedAt = sync.updated_at): BusyDayOverrideRow {
  return {
    ...sync,
    updated_at: updatedAt,
    id: overrideId('h', date),
    household_id: 'h',
    date,
    busy,
    set_by: PARENT,
  };
}

function day(date: string, input: Partial<BusyInput> = {}) {
  const [result] = busyDays({
    dates: [date],
    occurrences: [],
    busyBlocks: [],
    parentIds: new Set([PARENT]),
    overrides: [],
    timeZone: NY,
    ...input,
  });
  return result;
}

const WED = '2026-12-02';

describe('busyDays: the dinner window (R2-BUSY-1a)', () => {
  it('marks a day with an event overlapping 16:00 to 19:00', () => {
    expect(day(WED, { occurrences: [timed(WED, '17:30', '18:00')] })).toEqual({
      date: WED,
      busy: true,
      reason: 'dinner',
      overridden: false,
      bookedMinutes: 30,
    });
    expect(day(WED, { occurrences: [timed(WED, '15:00', '16:30')] }).reason).toBe('dinner');
    expect(day(WED, { occurrences: [timed(WED, '18:59', '20:00')] }).reason).toBe('dinner');
  });

  it('ignores events that only touch the window', () => {
    expect(day(WED, { occurrences: [timed(WED, '15:00', '16:00')] }).busy).toBe(false);
    expect(day(WED, { occurrences: [timed(WED, '19:00', '20:00')] }).busy).toBe(false);
  });

  it("counts a parent's busy block, but not another member's", () => {
    expect(day(WED, { busyBlocks: [block(PARENT, WED, '16:30', '17:00')] }).reason).toBe('dinner');
    expect(day(WED, { busyBlocks: [block(FAMILY, WED, '16:30', '17:00')] }).busy).toBe(false);
    const deleted = { ...block(PARENT, WED, '16:30', '17:00'), deleted_at: '2026-12-01T00:00:00Z' };
    expect(day(WED, { busyBlocks: [deleted] }).busy).toBe(false);
  });

  it('counts a zero-length event inside the window', () => {
    expect(day(WED, { occurrences: [timed(WED, '17:00', '17:00')] }).reason).toBe('dinner');
  });
});

describe('busyDays: 3 hours booked (R2-BUSY-1b)', () => {
  it('marks a day with 3 hours booked between 07:00 and 21:00', () => {
    const result = day(WED, {
      occurrences: [timed(WED, '09:00', '10:30'), timed(WED, '13:00', '14:30')],
    });
    expect(result).toMatchObject({ busy: true, reason: 'booked', bookedMinutes: 180 });
  });

  it('stays free under 3 hours', () => {
    const result = day(WED, { occurrences: [timed(WED, '09:00', '11:59')] });
    expect(result).toMatchObject({ busy: false, reason: null, bookedMinutes: 179 });
  });

  it('counts overlapping events and blocks once', () => {
    const result = day(WED, {
      occurrences: [timed(WED, '09:00', '11:00'), timed(WED, '10:00', '11:30')],
      busyBlocks: [block(PARENT, WED, '10:30', '11:45'), block(PARENT, WED, '09:15', '09:45')],
    });
    expect(result).toMatchObject({ busy: false, bookedMinutes: 165 });
  });

  it('counts only the part inside the day window', () => {
    const result = day(WED, {
      occurrences: [timed(WED, '05:00', '08:00'), timed(WED, '20:00', '23:00')],
    });
    expect(result).toMatchObject({ busy: false, bookedMinutes: 120 });
  });

  it('counts an overnight event on both days', () => {
    const overnight: Occurrence = {
      ...timed(WED, '20:00', '20:00'),
      endsAt: instant('2026-12-03', '10:00', NY),
    };
    const [wed, thu] = busyDays({
      dates: [WED, '2026-12-03'],
      occurrences: [overnight],
      busyBlocks: [],
      parentIds: new Set(),
      overrides: [],
      timeZone: NY,
    });
    expect(wed.bookedMinutes).toBe(60);
    expect(thu).toMatchObject({ busy: true, reason: 'booked', bookedMinutes: 180 });
  });

  it('prefers the dinner reason when both parts hold', () => {
    const result = day(WED, { occurrences: [timed(WED, '12:00', '18:00')] });
    expect(result).toMatchObject({ reason: 'dinner', bookedMinutes: 360 });
  });
});

describe('busyDays: all-day events', () => {
  it('never count', () => {
    const allDay = expandOccurrences(
      {
        id: 'e',
        all_day: true,
        starts_at: null,
        ends_at: null,
        start_date: WED,
        end_date: WED,
        repeat: null,
        taking_user_id: null,
      },
      {
        timeZone: NY,
        from: new Date('2026-12-01T00:00:00Z'),
        to: new Date('2026-12-04T00:00:00Z'),
      },
    );
    expect(allDay).toHaveLength(1);
    expect(day(WED, { occurrences: allDay })).toMatchObject({ busy: false, bookedMinutes: 0 });
  });
});

describe('busyDays: overrides (FR2-BUSY-4)', () => {
  const busyEvening = [timed(WED, '17:00', '18:00')];

  it('marks a free day busy', () => {
    expect(day(WED, { overrides: [mark(WED, true)] })).toMatchObject({
      busy: true,
      reason: 'marked',
      overridden: true,
    });
  });

  it('marks a busy day not busy', () => {
    expect(day(WED, { occurrences: busyEvening, overrides: [mark(WED, false)] })).toMatchObject({
      busy: false,
      reason: null,
      overridden: true,
    });
  });

  it('follows the rule again when the mark is cleared or deleted', () => {
    expect(day(WED, { occurrences: busyEvening, overrides: [mark(WED, null)] })).toMatchObject({
      busy: true,
      reason: 'dinner',
      overridden: false,
    });
    const tombstone = { ...mark(WED, false), deleted_at: '2026-12-01T00:00:00Z' };
    expect(day(WED, { occurrences: busyEvening, overrides: [tombstone] }).busy).toBe(true);
  });

  it('applies only to its own day, and the newest mark wins', () => {
    expect(day(WED, { overrides: [mark('2026-12-03', true)] }).busy).toBe(false);
    const older = mark(WED, true, '2026-12-01T00:00:00Z');
    const newer = mark(WED, false, '2026-12-01T00:05:00Z');
    expect(day(WED, { overrides: [newer, older] }).busy).toBe(false);
  });
});

describe("busyDays: the household's timezone", () => {
  it('uses the household clock, not UTC or the device', () => {
    // 07:00 to 08:00 UTC is 18:00 in Sydney (summer, UTC+11) and 02:00 in New York.
    const occurrence: Occurrence = {
      ...timed(WED, '00:00', '00:00'),
      startsAt: '2026-12-02T07:00:00.000Z',
      endsAt: '2026-12-02T08:00:00.000Z',
    };
    expect(day(WED, { occurrences: [occurrence], timeZone: SYDNEY }).reason).toBe('dinner');
    expect(day(WED, { occurrences: [occurrence], timeZone: NY }).busy).toBe(false);
  });

  it('keeps the windows on the wall clock across daylight-saving changes', () => {
    // US clocks spring forward on 2027-03-14 and fall back on 2026-11-01.
    for (const date of ['2027-03-14', '2026-11-01']) {
      expect(day(date, { occurrences: [timed(date, '16:15', '16:45')] }).reason).toBe('dinner');
      expect(day(date, { occurrences: [timed(date, '19:00', '20:00')] }).busy).toBe(false);
      expect(day(date, { occurrences: [timed(date, '07:00', '10:00')] })).toMatchObject({
        reason: 'booked',
        bookedMinutes: 180,
      });
    }
  });

  it('measures booked time in real minutes when the clock changes inside an event', () => {
    // 01:00 to 04:00 on the clock is 4 real hours on fall-back day; with the day window
    // opened to midnight, all of it counts.
    const rule = { ...DEFAULT_BUSY_RULE, dayStart: 0 };
    const result = day('2026-11-01', {
      occurrences: [timed('2026-11-01', '01:00', '04:00')],
      rule,
    });
    expect(result.bookedMinutes).toBe(240);
  });
});

describe('parseBusyRule', () => {
  it('reads the server setting', () => {
    expect(
      parseBusyRule({
        dinner_start: 1020,
        dinner_end: 1200,
        day_start: 480,
        day_end: 1440,
        booked_minutes: 240,
      }),
    ).toEqual({
      dinnerStart: 1020,
      dinnerEnd: 1200,
      dayStart: 480,
      dayEnd: 1440,
      bookedMinutes: 240,
    });
  });

  it('falls back to the default for a missing or malformed setting', () => {
    expect(parseBusyRule(null)).toBe(DEFAULT_BUSY_RULE);
    expect(parseBusyRule({ dinner_start: '16:00' })).toBe(DEFAULT_BUSY_RULE);
    expect(
      parseBusyRule({
        dinner_start: 1140,
        dinner_end: 960,
        day_start: 420,
        day_end: 1260,
        booked_minutes: 180,
      }),
    ).toBe(DEFAULT_BUSY_RULE);
  });

  it('uses a tuned threshold', () => {
    const rule = { ...DEFAULT_BUSY_RULE, bookedMinutes: 60 };
    expect(day(WED, { occurrences: [timed(WED, '09:00', '10:00')], rule }).reason).toBe('booked');
  });
});

describe('busyDays: performance (NFR2-PERF-3)', () => {
  it('evaluates a crowded week well within 50 ms', () => {
    const dates = weekDates('2026-11-29');
    const occurrences = dates.flatMap((date) =>
      Array.from({ length: 30 }, (_, i) => timed(date, `${7 + (i % 14)}:00`, `${8 + (i % 14)}:30`)),
    );
    const busyBlocks = dates.flatMap((date) =>
      Array.from({ length: 20 }, (_, i) =>
        block(PARENT, date, `${7 + (i % 12)}:15`, `${8 + (i % 12)}:00`),
      ),
    );
    const input = {
      dates,
      occurrences,
      busyBlocks,
      parentIds: new Set([PARENT]),
      overrides: [],
      timeZone: NY,
    };
    busyDays(input);
    const start = performance.now();
    const result = busyDays(input);
    expect(performance.now() - start).toBeLessThan(50);
    expect(result).toHaveLength(7);
  });
});
