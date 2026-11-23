import {
  copyItems,
  dinnersByDate,
  planCopies,
  type CopySource,
} from '@/features/calendar/device/copy';
import type { EventExceptionRow, EventRow } from '@/features/calendar/tables';
import type { PlanEntryRow } from '@/features/planner/tables';

const base = {
  household_id: 'hh',
  version: 1,
  created_at: null,
  updated_at: null,
  deleted_at: null,
};

const event = (id: string, over: Partial<EventRow> = {}): EventRow => ({
  ...base,
  id,
  kind: 'kind.appointment',
  title: 'Pediatrician',
  all_day: false,
  starts_at: '2026-11-23T15:00:00.000Z',
  ends_at: '2026-11-23T16:00:00.000Z',
  start_date: null,
  end_date: null,
  place: 'Main St Clinic',
  notes: 'Bring the red book; ask about the rash',
  taking_user_id: 'u2',
  shared: true,
  repeat: null,
  created_by: 'u1',
  updated_by: 'u1',
  ...over,
});

const moved = (eventId: string, date: string, startsAt: string, endsAt: string) =>
  ({
    ...base,
    id: `x-${eventId}-${date}`,
    event_id: eventId,
    original_date: date,
    status: 'moved',
    starts_at: startsAt,
    ends_at: endsAt,
    start_date: null,
    end_date: null,
    taking_user_id: null,
  }) satisfies EventExceptionRow;

const source = (over: Partial<CopySource> = {}): CopySource => ({
  events: [event('e1')],
  exceptions: [],
  timeZone: 'America/New_York',
  weekStart: 7,
  today: '2026-11-22',
  kindName: (kind) => `name:${kind}`,
  eventLink: (id, date) => `app://calendar/${id}?date=${date}`,
  dinners: null,
  mealTitle: (titles) => `Dinner: ${titles.join(', ')}`,
  mealNotes: 'Planned dinner',
  mealLink: (date) => `app://plan?date=${date}`,
  ...over,
});

describe('copy to my calendar (C-05.2)', () => {
  it('carries the title, time, place and kind, never notes or people (FR2-DEV-3)', () => {
    const [item] = copyItems(source());
    expect(item).toEqual({
      key: 'e1:2026-11-23',
      details: {
        allDay: false,
        title: 'Pediatrician',
        location: 'Main St Clinic',
        notes: 'name:kind.appointment',
        url: 'app://calendar/e1?date=2026-11-23',
        startsAt: '2026-11-23T15:00:00.000Z',
        endsAt: '2026-11-23T16:00:00.000Z',
        timeZone: 'America/New_York',
      },
    });
    const written = JSON.stringify(item);
    expect(written).not.toContain('red book');
    expect(written).not.toContain('u2');
  });

  it('copies each occurrence of a repeat in the window as its own event', () => {
    const weekly = event('e1', { repeat: { freq: 'weekly', weekdays: [1] } });
    const items = copyItems(source({ events: [weekly] }));
    // Mondays from the first, 23 November, to the window's end 180 days ahead (21 May).
    expect(items).toHaveLength(26);
    expect(items[25].key).toBe('e1:2027-05-17');
    expect(new Set(items.map((i) => i.key)).size).toBe(items.length);
    expect(items.every((i) => !i.details.allDay)).toBe(true);
  });

  it('leaves out deleted events and events beyond the window', () => {
    const items = copyItems(
      source({
        events: [
          event('gone', { deleted_at: '2026-11-20T00:00:00Z' }),
          event('far', { starts_at: '2027-09-01T15:00:00Z', ends_at: '2027-09-01T16:00:00Z' }),
          event('old', { starts_at: '2026-09-01T15:00:00Z', ends_at: '2026-09-01T16:00:00Z' }),
        ],
      }),
    );
    expect(items).toEqual([]);
  });

  it('copies all-day events with inclusive dates', () => {
    const [item] = copyItems(
      source({
        events: [
          event('trip', {
            all_day: true,
            starts_at: null,
            ends_at: null,
            start_date: '2026-11-27',
            end_date: '2026-11-29',
            place: '',
          }),
        ],
      }),
    );
    expect(item.details).toMatchObject({
      allDay: true,
      startDate: '2026-11-27',
      endDate: '2026-11-29',
      location: null,
    });
  });

  it('updates the existing copy when a partner moves an appointment (acceptance: copy)', () => {
    const weekly = event('e1', { repeat: { freq: 'weekly', weekdays: [1] } });
    const before = copyItems(source({ events: [weekly] }));
    const copies = Object.fromEntries(
      before.map((i, n) => [i.key, { id: `dev-${n}`, hash: JSON.stringify(i.details) }]),
    );
    expect(planCopies(before, copies)).toEqual({ put: [], remove: [] });

    const after = copyItems(
      source({
        events: [weekly],
        exceptions: [moved('e1', '2026-11-30', '2026-12-01T20:00:00Z', '2026-12-01T21:00:00Z')],
      }),
    );
    const plan = planCopies(after, copies);
    expect(plan.remove).toEqual([]);
    expect(plan.put).toHaveLength(1);
    expect(plan.put[0]).toMatchObject({
      key: 'e1:2026-11-30',
      existingId: copies['e1:2026-11-30'].id,
      details: { startsAt: '2026-12-01T20:00:00.000Z' },
    });
  });

  it('removes copies of deleted events and makes copies of new ones', () => {
    const copies = { 'old:2026-11-24': { id: 'dev-old', hash: '{}' } };
    const plan = planCopies(copyItems(source()), copies);
    expect(plan.remove).toEqual([{ key: 'old:2026-11-24', id: 'dev-old' }]);
    expect(plan.put).toEqual([expect.objectContaining({ key: 'e1:2026-11-23', existingId: null })]);
  });

  it('copies dinners only when meals are included', () => {
    expect(copyItems(source({ events: [] }))).toEqual([]);
    const dinners = new Map([
      ['2026-11-24', ['Lentil soup', 'Bread']],
      ['2026-12-31', []],
      ['2028-01-01', ['Too far']],
    ]);
    expect(copyItems(source({ events: [], dinners }))).toEqual([
      {
        key: 'meal:2026-11-24',
        details: {
          allDay: true,
          title: 'Dinner: Lentil soup, Bread',
          location: null,
          notes: 'Planned dinner',
          url: 'app://plan?date=2026-11-24',
          startDate: '2026-11-24',
          endDate: '2026-11-24',
        },
      },
    ]);
  });

  it('groups planned dinners by date in plan order', () => {
    const entry = (id: string, date: string, slot: string, position: number) =>
      ({ ...base, id, date, slot, position, recipe_id: null, free_text: id }) as PlanEntryRow;
    const map = dinnersByDate(
      [
        entry('b', '2026-11-24', 'dinner', 2),
        entry('a', '2026-11-24', 'dinner', 1),
        entry('lunch', '2026-11-24', 'lunch', 0),
        { ...entry('gone', '2026-11-25', 'dinner', 0), deleted_at: '2026-11-20' },
      ],
      (e) => e.free_text ?? '',
    );
    expect([...map]).toEqual([['2026-11-24', ['a', 'b']]]);
  });
});
