import {
  expandOccurrences,
  parseRepeat,
  wallTime,
  zonedInstant,
  type SeriesEvent,
} from '@/features/calendar/repeat';
import type { EventExceptionRow } from '@/features/calendar/tables';

const NY = 'America/New_York';
const LONDON = 'Europe/London';
const SYDNEY = 'Australia/Sydney';

/** A timed series starting at a wall time in a timezone. */
function timed(date: string, time: string, minutes: number, repeat: unknown, tz: string) {
  const [hour, minute] = time.split(':').map(Number);
  const start = zonedInstant({ date, hour, minute, second: 0, ms: 0 }, tz);
  return {
    id: 'event-1',
    all_day: false,
    starts_at: new Date(start).toISOString(),
    ends_at: new Date(start + minutes * 60_000).toISOString(),
    start_date: null,
    end_date: null,
    repeat: repeat as SeriesEvent['repeat'],
    taking_user_id: null,
  } satisfies SeriesEvent;
}

function allDay(start: string, end: string, repeat: unknown): SeriesEvent {
  return {
    id: 'event-1',
    all_day: true,
    starts_at: null,
    ends_at: null,
    start_date: start,
    end_date: end,
    repeat: repeat as SeriesEvent['repeat'],
    taking_user_id: null,
  };
}

const range = (from: string, to: string) => ({ from: new Date(from), to: new Date(to) });

/** Local "date hh:mm" of each occurrence's start. */
function localStarts(event: SeriesEvent, tz: string, from: string, to: string, extra = {}) {
  return expandOccurrences(event, { timeZone: tz, ...range(from, to), ...extra }).map((o) => {
    const wall = wallTime(Date.parse(o.startsAt!), tz);
    const hh = String(wall.hour).padStart(2, '0');
    const mm = String(wall.minute).padStart(2, '0');
    return `${wall.date} ${hh}:${mm}`;
  });
}

function exception(
  originalDate: string,
  status: EventExceptionRow['status'],
  times: Partial<EventExceptionRow> = {},
): EventExceptionRow {
  return {
    id: `exception-${originalDate}`,
    household_id: 'household-1',
    version: 1,
    created_at: null,
    updated_at: null,
    deleted_at: null,
    event_id: 'event-1',
    original_date: originalDate,
    status,
    starts_at: null,
    ends_at: null,
    start_date: null,
    end_date: null,
    taking_user_id: null,
    ...times,
  };
}

describe('parseRepeat (C-01.2)', () => {
  it('reads each rule in the glossary', () => {
    expect(parseRepeat({ freq: 'daily' })).toEqual({ freq: 'daily' });
    expect(parseRepeat({ freq: 'weekly', weekdays: [1, 3] })).not.toBeNull();
    expect(parseRepeat({ freq: 'weekly', interval: 2, weekdays: [5] })).not.toBeNull();
    expect(parseRepeat({ freq: 'monthly', until: '2027-06-30' })).not.toBeNull();
    expect(parseRepeat({ freq: 'daily', count: 10, until: null })).toEqual({
      freq: 'daily',
      count: 10,
    });
  });

  it('refuses anything else', () => {
    expect(parseRepeat(null)).toBeNull();
    expect(parseRepeat({ freq: 'yearly' })).toBeNull();
    expect(parseRepeat({ freq: 'weekly' })).toBeNull();
    expect(parseRepeat({ freq: 'weekly', weekdays: [0] })).toBeNull();
    expect(parseRepeat({ freq: 'weekly', weekdays: [1, 1] })).toBeNull();
    expect(parseRepeat({ freq: 'daily', interval: 2 })).toBeNull();
    expect(parseRepeat({ freq: 'daily', weekdays: [1] })).toBeNull();
    expect(parseRepeat({ freq: 'daily', count: 0 })).toBeNull();
    expect(parseRepeat({ freq: 'daily', count: 5, until: '2027-01-01' })).toBeNull();
    expect(parseRepeat({ freq: 'daily', until: '1 Jan' })).toBeNull();
    expect(parseRepeat({ freq: 'daily', until: '2027-13-01' })).toBeNull();
    expect(parseRepeat({ freq: 'daily', byhour: 3 })).toBeNull();
  });
});

describe('expandOccurrences (C-01.2, FR2-CAL-4, R2-CAL-1)', () => {
  it('returns a single event once, only if it overlaps the range', () => {
    const event = timed('2026-12-01', '10:00', 60, null, NY);
    expect(localStarts(event, NY, '2026-11-30T00:00Z', '2026-12-07T00:00Z')).toEqual([
      '2026-12-01 10:00',
    ]);
    expect(localStarts(event, NY, '2026-12-02T00:00Z', '2026-12-07T00:00Z')).toEqual([]);
  });

  it('repeats daily, ending after a count', () => {
    const event = timed('2026-12-01', '07:00', 30, { freq: 'daily', count: 3 }, NY);
    expect(localStarts(event, NY, '2026-11-30T00:00Z', '2027-01-01T00:00Z')).toEqual([
      '2026-12-01 07:00',
      '2026-12-02 07:00',
      '2026-12-03 07:00',
    ]);
  });

  it('counts from the first occurrence, not from the range', () => {
    const event = timed('2026-12-01', '07:00', 30, { freq: 'daily', count: 3 }, NY);
    expect(localStarts(event, NY, '2026-12-03T00:00Z', '2027-01-01T00:00Z')).toEqual([
      '2026-12-03 07:00',
    ]);
  });

  it('repeats weekly on chosen weekdays, ending on a date (inclusive)', () => {
    // Tuesday 1 December; Mondays and Wednesdays until Monday 14 December.
    const rule = { freq: 'weekly', weekdays: [1, 3], until: '2026-12-14' };
    const event = timed('2026-12-01', '17:00', 30, rule, NY);
    expect(localStarts(event, NY, '2026-11-30T00:00Z', '2027-01-01T00:00Z')).toEqual([
      '2026-12-02 17:00',
      '2026-12-07 17:00',
      '2026-12-09 17:00',
      '2026-12-14 17:00',
    ]);
  });

  it('repeats every 2 weeks, keeping the weeks after the range starts later', () => {
    const rule = { freq: 'weekly', interval: 2, weekdays: [5] };
    const event = timed('2026-01-02', '09:00', 60, rule, LONDON);
    expect(localStarts(event, LONDON, '2026-12-01T00:00Z', '2027-01-01T00:00Z')).toEqual([
      '2026-12-04 09:00',
      '2026-12-18 09:00',
    ]);
  });

  it('sets the weeks of "every 2 weeks" by the household week start', () => {
    // Sunday 6 December, then Monday: in a Sunday-start week they're the same week.
    const rule = { freq: 'weekly', interval: 2, weekdays: [7, 1] };
    const event = timed('2026-12-06', '09:00', 60, rule, NY);
    const sundayWeeks = localStarts(event, NY, '2026-12-06T00:00Z', '2026-12-25T00:00Z', {
      weekStart: 7,
    });
    expect(sundayWeeks).toEqual([
      '2026-12-06 09:00',
      '2026-12-07 09:00',
      '2026-12-20 09:00',
      '2026-12-21 09:00',
    ]);
  });

  it('repeats monthly on the same date, skipping months without it', () => {
    const event = timed('2027-01-31', '12:00', 60, { freq: 'monthly' }, SYDNEY);
    expect(localStarts(event, SYDNEY, '2027-01-01T00:00Z', '2027-06-01T00:00Z')).toEqual([
      '2027-01-31 12:00',
      '2027-03-31 12:00',
      '2027-05-31 12:00',
    ]);
  });

  it('finds occurrences of a series that started years before the range', () => {
    const event = timed('2016-01-04', '08:00', 60, { freq: 'weekly', weekdays: [1] }, NY);
    expect(localStarts(event, NY, '2026-12-07T00:00Z', '2026-12-15T00:00Z')).toEqual([
      '2026-12-07 08:00',
      '2026-12-14 08:00',
    ]);
  });

  it('includes an occurrence that started before the range and is still going', () => {
    const event = timed('2026-12-01', '23:00', 120, { freq: 'daily' }, 'UTC');
    expect(localStarts(event, 'UTC', '2026-12-03T00:30Z', '2026-12-03T12:00Z')).toEqual([
      '2026-12-02 23:00',
    ]);
  });

  describe('daylight saving: a 10:00 event stays at 10:00 local time', () => {
    it('in the US, when clocks go back on 1 November 2026', () => {
      const event = timed('2026-10-26', '10:00', 60, { freq: 'weekly', weekdays: [1] }, NY);
      const occurrences = expandOccurrences(event, {
        timeZone: NY,
        ...range('2026-10-25T00:00Z', '2026-11-10T00:00Z'),
      });
      expect(occurrences.map((o) => o.startsAt)).toEqual([
        '2026-10-26T14:00:00.000Z',
        '2026-11-02T15:00:00.000Z',
        '2026-11-09T15:00:00.000Z',
      ]);
      expect(occurrences.map((o) => o.endsAt)[1]).toBe('2026-11-02T16:00:00.000Z');
    });

    it('in Great Britain, when clocks go forward on 29 March 2026', () => {
      const event = timed('2026-03-22', '10:00', 60, { freq: 'weekly', weekdays: [7] }, LONDON);
      expect(
        expandOccurrences(event, {
          timeZone: LONDON,
          ...range('2026-03-20T00:00Z', '2026-04-01T00:00Z'),
        }).map((o) => o.startsAt),
      ).toEqual(['2026-03-22T10:00:00.000Z', '2026-03-29T09:00:00.000Z']);
    });

    it('in Great Britain, when clocks go back on 25 October 2026', () => {
      const event = timed('2026-10-24', '10:00', 60, { freq: 'daily' }, LONDON);
      expect(localStarts(event, LONDON, '2026-10-24T00:00Z', '2026-10-27T00:00Z')).toEqual([
        '2026-10-24 10:00',
        '2026-10-25 10:00',
        '2026-10-26 10:00',
      ]);
    });

    it('in Australia, when clocks go back on 5 April 2026', () => {
      const event = timed('2026-04-04', '10:00', 60, { freq: 'daily' }, SYDNEY);
      expect(
        expandOccurrences(event, {
          timeZone: SYDNEY,
          ...range('2026-04-03T00:00Z', '2026-04-05T12:00Z'),
        }).map((o) => o.startsAt),
      ).toEqual(['2026-04-03T23:00:00.000Z', '2026-04-05T00:00:00.000Z']);
    });

    it('in Australia, when clocks go forward on 4 October 2026', () => {
      const event = timed('2026-10-03', '10:00', 60, { freq: 'daily' }, SYDNEY);
      expect(
        expandOccurrences(event, {
          timeZone: SYDNEY,
          ...range('2026-10-02T12:00Z', '2026-10-04T12:00Z'),
        }).map((o) => o.startsAt),
      ).toEqual(['2026-10-03T00:00:00.000Z', '2026-10-03T23:00:00.000Z']);
    });

    it('moves a time in the spring-forward gap forward by the gap', () => {
      // 02:30 doesn't exist in New York on 8 March 2026; it becomes 03:30 EDT.
      const event = timed('2026-03-07', '02:30', 30, { freq: 'daily' }, NY);
      expect(localStarts(event, NY, '2026-03-07T00:00Z', '2026-03-10T00:00Z')).toEqual([
        '2026-03-07 02:30',
        '2026-03-08 03:30',
        '2026-03-09 02:30',
      ]);
    });

    it('uses the first of a time that happens twice', () => {
      // 01:30 happens twice in New York on 1 November 2026; the first is EDT (UTC-4).
      const event = timed('2026-10-31', '01:30', 30, { freq: 'daily' }, NY);
      const starts = expandOccurrences(event, {
        timeZone: NY,
        ...range('2026-10-31T00:00Z', '2026-11-02T12:00Z'),
      }).map((o) => o.startsAt);
      expect(starts).toEqual([
        '2026-10-31T05:30:00.000Z',
        '2026-11-01T05:30:00.000Z',
        '2026-11-02T06:30:00.000Z',
      ]);
    });
  });

  describe('exceptions (FR2-CAL-4, R2-CAL-2)', () => {
    const event = timed('2026-11-30', '17:00', 30, { freq: 'weekly', weekdays: [1] }, NY);
    const december = range('2026-12-01T00:00Z', '2026-12-22T00:00Z');

    it('moves only the changed occurrence', () => {
      const moved = exception('2026-12-07', 'moved', {
        starts_at: '2026-12-07T22:30:00.000Z',
        ends_at: '2026-12-07T23:00:00.000Z',
        taking_user_id: 'user-2',
      });
      const occurrences = expandOccurrences(event, {
        timeZone: NY,
        ...december,
        exceptions: [moved],
      });
      expect(occurrences.map((o) => [o.originalDate, o.moved, o.takingUserId])).toEqual([
        ['2026-12-07', true, 'user-2'],
        ['2026-12-14', false, null],
        ['2026-12-21', false, null],
      ]);
      expect(
        localStarts(event, NY, december.from.toISOString(), december.to.toISOString(), {
          exceptions: [moved],
        })[0],
      ).toBe('2026-12-07 17:30');
    });

    it('drops a skipped occurrence and brings back a restored one', () => {
      const exceptions = [exception('2026-12-07', 'skipped'), exception('2026-12-14', 'restored')];
      expect(
        expandOccurrences(event, { timeZone: NY, ...december, exceptions }).map(
          (o) => o.originalDate,
        ),
      ).toEqual(['2026-12-14', '2026-12-21']);
    });

    it("ignores tombstones and other events' exceptions", () => {
      const exceptions = [
        { ...exception('2026-12-07', 'skipped'), deleted_at: '2026-12-01T00:00:00Z' },
        { ...exception('2026-12-14', 'skipped'), event_id: 'event-2' },
      ];
      expect(expandOccurrences(event, { timeZone: NY, ...december, exceptions })).toHaveLength(3);
    });

    it('includes an occurrence moved into the range from outside it', () => {
      const moved = exception('2027-01-04', 'moved', {
        starts_at: '2026-12-16T22:00:00.000Z',
        ends_at: '2026-12-16T22:30:00.000Z',
      });
      expect(
        expandOccurrences(event, { timeZone: NY, ...december, exceptions: [moved] }).map(
          (o) => o.originalDate,
        ),
      ).toEqual(['2026-12-07', '2026-12-14', '2027-01-04', '2026-12-21']);
    });
  });

  describe('all-day events', () => {
    it('repeat by date and overlap the range by any day', () => {
      const event = allDay('2026-12-04', '2026-12-05', { freq: 'weekly', weekdays: [5] });
      const occurrences = expandOccurrences(event, {
        timeZone: SYDNEY,
        ...range('2026-12-12T00:00Z', '2026-12-20T00:00Z'),
      });
      expect(occurrences.map((o) => [o.startDate, o.endDate])).toEqual([
        ['2026-12-11', '2026-12-12'],
        ['2026-12-18', '2026-12-19'],
      ]);
    });

    it('move to other dates', () => {
      const event = allDay('2026-12-02', '2026-12-02', { freq: 'weekly', weekdays: [3] });
      const moved = exception('2026-12-09', 'moved', {
        start_date: '2026-12-10',
        end_date: '2026-12-10',
      });
      expect(
        expandOccurrences(event, {
          timeZone: NY,
          ...range('2026-12-07T05:00Z', '2026-12-14T05:00Z'),
          exceptions: [moved],
        }).map((o) => o.startDate),
      ).toEqual(['2026-12-10']);
    });
  });
});
