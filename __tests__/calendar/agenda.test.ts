import { agendaDays, householdTimeZone, startOfDay } from '@/features/calendar/agenda';
import type { EventExceptionRow, EventRow } from '@/features/calendar/tables';

const base = {
  household_id: 'hh',
  version: 1,
  created_at: null,
  updated_at: null,
  deleted_at: null,
};

const event = (id: string, over: Partial<EventRow>): EventRow => ({
  ...base,
  id,
  kind: 'kind.appointment',
  title: id,
  all_day: false,
  starts_at: null,
  ends_at: null,
  start_date: null,
  end_date: null,
  place: null,
  notes: null,
  taking_user_id: null,
  shared: false,
  repeat: null,
  created_by: null,
  updated_by: null,
  ...over,
});

const NY = 'America/New_York';
const options = { timeZone: NY, weekStart: 7 as const, from: '2026-11-18', days: 7 };

describe('agendaDays (S-36, FR2-CAL-1)', () => {
  it('always starts with today, even when nothing is on', () => {
    expect(agendaDays([], [], options)).toEqual([{ date: '2026-11-18', items: [] }]);
  });

  it('puts timed events on their day in the household timezone, in start order', () => {
    const rows = [
      // 03:00 UTC on the 19th is 22:00 on the 18th in New York.
      event('late', { starts_at: '2026-11-19T03:00:00Z', ends_at: '2026-11-19T04:00:00Z' }),
      event('early', { starts_at: '2026-11-18T14:00:00Z', ends_at: '2026-11-18T15:00:00Z' }),
      event('next', { starts_at: '2026-11-20T15:00:00Z', ends_at: '2026-11-20T16:00:00Z' }),
    ];
    const days = agendaDays(rows, [], options);
    expect(days.map((d) => [d.date, d.items.map((i) => i.event.id)])).toEqual([
      ['2026-11-18', ['early', 'late']],
      ['2026-11-20', ['next']],
    ]);
  });

  it('shows all-day events first, on each day they span inside the range', () => {
    const rows = [
      event('trip', { all_day: true, start_date: '2026-11-17', end_date: '2026-11-19' }),
      event('visit', { starts_at: '2026-11-18T13:00:00Z', ends_at: '2026-11-18T14:00:00Z' }),
    ];
    const days = agendaDays(rows, [], options);
    expect(days[0].items.map((i) => i.event.id)).toEqual(['trip', 'visit']);
    expect(days[1]).toMatchObject({ date: '2026-11-19', items: [{ key: 'trip:2026-11-17' }] });
  });

  it('expands repeats and applies exceptions, leaving out events outside the range', () => {
    const weekly = event('swim', {
      starts_at: '2026-11-02T15:00:00Z',
      ends_at: '2026-11-02T16:00:00Z',
      repeat: { freq: 'weekly', weekdays: [1, 3] },
    });
    const skipped: EventExceptionRow = {
      ...base,
      id: 'x',
      event_id: 'swim',
      original_date: '2026-11-23',
      status: 'skipped',
      starts_at: null,
      ends_at: null,
      start_date: null,
      end_date: null,
      taking_user_id: null,
    };
    const past = event('past', {
      starts_at: '2026-11-01T15:00:00Z',
      ends_at: '2026-11-01T16:00:00Z',
    });
    const days = agendaDays([weekly, past], [skipped], { ...options, days: 14 });
    expect(days.map((d) => d.date)).toEqual(['2026-11-18', '2026-11-25', '2026-11-30']);
    expect(days[0].items[0].key).toBe('swim:2026-11-18');
  });

  it('leaves out tombstoned events', () => {
    const gone = event('gone', {
      starts_at: '2026-11-18T15:00:00Z',
      ends_at: '2026-11-18T16:00:00Z',
      deleted_at: '2026-11-17T00:00:00Z',
    });
    expect(agendaDays([gone], [], options)[0].items).toEqual([]);
  });

  it('shows an event that began before today on today', () => {
    const overnight = event('night', {
      starts_at: '2026-11-18T03:00:00Z',
      ends_at: '2026-11-18T07:00:00Z',
    });
    expect(agendaDays([overnight], [], options)[0].items).toHaveLength(1);
  });
});

describe('startOfDay and householdTimeZone', () => {
  it('finds midnight on the household clock', () => {
    expect(new Date(startOfDay('2026-11-18', NY)).toISOString()).toBe('2026-11-18T05:00:00.000Z');
  });

  it('falls back to the device timezone for a missing or unknown zone', () => {
    const device = Intl.DateTimeFormat().resolvedOptions().timeZone;
    expect(householdTimeZone(NY)).toBe(NY);
    expect(householdTimeZone(null)).toBe(device);
    expect(householdTimeZone('Not/AZone')).toBe(device);
  });
});
