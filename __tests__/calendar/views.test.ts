import type { AgendaItem } from '@/features/calendar/agenda';
import type { EventRow } from '@/features/calendar/tables';
import { calendarDays, dayLayout, mealsByDate } from '@/features/calendar/views';
import type { PlanEntryRow } from '@/features/planner/tables';

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

/** A timed item from wall times on 2026-11-18 in New York (UTC-5). */
const timed = (id: string, start: string, end: string): AgendaItem => ({
  key: `${id}:2026-11-18`,
  event: event(id, {}),
  occurrence: {
    eventId: id,
    originalDate: '2026-11-18',
    allDay: false,
    startsAt: `2026-11-18T${start}:00-05:00`,
    endsAt: `2026-11-18T${end}:00-05:00`,
    startDate: null,
    endDate: null,
    takingUserId: null,
    moved: false,
  },
});

const ids = (columns: AgendaItem[][]) => columns.map((c) => c.map((i) => i.event.id));

describe('calendarDays (S-36 day and week views)', () => {
  it('returns every day of the range, empty ones included', () => {
    const days = calendarDays(
      [
        event('dentist', {
          starts_at: '2026-11-17T15:00:00Z',
          ends_at: '2026-11-17T16:00:00Z',
        }),
        event('trip', { all_day: true, start_date: '2026-11-19', end_date: '2026-11-20' }),
      ],
      [],
      { timeZone: NY, weekStart: 7, from: '2026-11-15', days: 7 },
    );
    expect(days.map((d) => [d.date, d.items.map((i) => i.event.id)])).toEqual([
      ['2026-11-15', []],
      ['2026-11-16', []],
      ['2026-11-17', ['dentist']],
      ['2026-11-18', []],
      ['2026-11-19', ['trip']],
      ['2026-11-20', ['trip']],
      ['2026-11-21', []],
    ]);
  });

  it('expands a weekly repeat onto each week shown', () => {
    const pickup = event('pickup', {
      starts_at: '2026-11-02T22:00:00Z',
      ends_at: '2026-11-02T22:30:00Z',
      repeat: { freq: 'weekly', weekdays: [1] },
    });
    const days = calendarDays([pickup], [], {
      timeZone: NY,
      weekStart: 1,
      from: '2026-11-16',
      days: 7,
    });
    expect(days.filter((d) => d.items.length > 0).map((d) => d.date)).toEqual(['2026-11-16']);
  });

  it('shows a single day for the day view', () => {
    expect(
      calendarDays([], [], { timeZone: NY, weekStart: 7, from: '2026-11-18', days: 1 }),
    ).toEqual([{ date: '2026-11-18', items: [] }]);
  });
});

describe('dayLayout (overlaps side by side)', () => {
  it('keeps events that only touch in separate groups', () => {
    const layout = dayLayout([timed('a', '09:00', '10:00'), timed('b', '10:00', '11:00')]);
    expect(layout.groups.map((g) => ids(g.columns))).toEqual([[['a']], [['b']]]);
  });

  it('puts overlapping events in columns, reusing a column once it is free', () => {
    const layout = dayLayout([
      timed('c', '10:30', '11:30'),
      timed('a', '09:00', '10:00'),
      timed('b', '09:30', '11:00'),
    ]);
    // a and c never overlap, so c takes a's column next to b.
    expect(layout.groups.map((g) => ids(g.columns))).toEqual([[['a', 'c'], ['b']]]);
  });

  it('puts the longer of two events starting together first', () => {
    const layout = dayLayout([timed('short', '09:00', '09:30'), timed('long', '09:00', '12:00')]);
    expect(layout.groups.map((g) => ids(g.columns))).toEqual([[['long'], ['short']]]);
  });

  it('sits an event with no length beside one that starts with it', () => {
    const layout = dayLayout([timed('point', '09:00', '09:00'), timed('hour', '09:00', '10:00')]);
    expect(layout.groups.map((g) => ids(g.columns))).toEqual([[['hour'], ['point']]]);
  });

  it('keeps all-day items apart from the timed groups', () => {
    const allDay: AgendaItem = {
      ...timed('trip', '00:00', '00:00'),
      occurrence: {
        ...timed('trip', '00:00', '00:00').occurrence,
        allDay: true,
        startsAt: null,
        endsAt: null,
        startDate: '2026-11-18',
        endDate: '2026-11-18',
      },
    };
    const layout = dayLayout([allDay, timed('a', '09:00', '10:00')]);
    expect(layout.allDay.map((i) => i.event.id)).toEqual(['trip']);
    expect(layout.groups.map((g) => ids(g.columns))).toEqual([[['a']]]);
  });
});

describe('mealsByDate (FR2-CAL-5)', () => {
  const entry = (id: string, over: Partial<PlanEntryRow>): PlanEntryRow => ({
    ...base,
    id,
    date: '2026-11-18',
    slot: 'dinner',
    position: 0,
    recipe_id: null,
    free_text: id,
    servings: 2,
    leftover_of_entry_id: null,
    ...over,
  });

  it('groups each day by slot in plan order and skips deleted entries', () => {
    const meals = mealsByDate(
      [
        entry('salad', { position: 1 }),
        entry('lasagne', {}),
        entry('soup', { slot: 'lunch' }),
        entry('gone', { deleted_at: '2026-11-17T00:00:00Z' }),
        entry('toast', { date: '2026-11-19', slot: 'breakfast' }),
      ],
      (e) => e.free_text ?? '',
    );
    expect(Object.fromEntries(meals)).toEqual({
      '2026-11-18': [
        { slot: 'lunch', titles: ['soup'] },
        { slot: 'dinner', titles: ['lasagne', 'salad'] },
      ],
      '2026-11-19': [{ slot: 'breakfast', titles: ['toast'] }],
    });
  });

  it('leaves out a day with nothing planned', () => {
    expect(mealsByDate([], () => '').size).toBe(0);
  });
});
