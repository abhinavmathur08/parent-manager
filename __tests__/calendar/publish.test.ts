import { DEFAULT_BUSY_RULE, type BusyDay } from '@/features/calendar/busy';
import {
  busyDayWrites,
  publishBusyDays,
  publishedBusyDays,
  publishWindow,
  type PublishSource,
} from '@/features/calendar/publish';
import { zonedInstant } from '@/features/calendar/repeat';
import {
  busyDayId,
  overrideId,
  type BusyDayOverrideRow,
  type BusyDayRow,
  type EventRow,
} from '@/features/calendar/tables';

const NY = 'America/New_York';
const HOUSEHOLD = '3f2a1c4e-8b7d-4e6f-9a0b-1c2d3e4f5a6b';
const PARENT = 'parent-1';

const system = (id: string) => ({
  id,
  household_id: HOUSEHOLD,
  version: 1,
  created_at: '2026-11-01T00:00:00Z',
  updated_at: '2026-11-01T00:00:00Z',
  deleted_at: null,
});

const day = (date: string, busy: boolean, reason: BusyDay['reason'] = null): BusyDay => ({
  date,
  busy,
  reason,
  overridden: reason === 'marked',
  bookedMinutes: 0,
});

const published = (
  date: string,
  busy: boolean,
  reason: BusyDayRow['reason'] = null,
): BusyDayRow => ({
  ...system(busyDayId(HOUSEHOLD, date)),
  date,
  busy,
  reason,
});

const mark = (date: string, busy: boolean | null, updatedAt = '2026-11-02T00:00:00Z') =>
  ({
    ...system(overrideId(HOUSEHOLD, date)),
    updated_at: updatedAt,
    date,
    busy,
    set_by: 'someone',
  }) satisfies BusyDayOverrideRow;

function instant(date: string, hour: number, minute = 0) {
  return new Date(zonedInstant({ date, hour, minute, second: 0, ms: 0 }, NY)).toISOString();
}

function privateEvent(id: string, date: string, hour: number, minute = 0): EventRow {
  return {
    ...system(id),
    kind: 'kind.appointment',
    title: 'Therapy',
    all_day: false,
    starts_at: instant(date, hour, minute),
    ends_at: instant(date, hour + 1, minute),
    start_date: null,
    end_date: null,
    place: null,
    notes: null,
    taking_user_id: null,
    shared: false,
    repeat: null,
    created_by: PARENT,
    updated_by: PARENT,
  };
}

describe('publishWindow', () => {
  it('covers today plus 13 days, across a month end', () => {
    const dates = publishWindow('2026-11-25');
    expect(dates).toHaveLength(14);
    expect(dates[0]).toBe('2026-11-25');
    expect(dates[13]).toBe('2026-12-08');
  });
});

describe('busyDayWrites', () => {
  it('inserts days with no row, under the shared stable ID', () => {
    const writes = busyDayWrites(HOUSEHOLD, [day('2026-12-02', true, 'dinner')], []);
    expect(writes).toEqual([
      {
        kind: 'insert',
        id: busyDayId(HOUSEHOLD, '2026-12-02'),
        values: { date: '2026-12-02', busy: true, reason: 'dinner' },
      },
    ]);
  });

  it('writes nothing when the rows already agree, so two parents stop writing', () => {
    const computed = [day('2026-12-02', true, 'dinner'), day('2026-12-03', false)];
    const rows = [published('2026-12-02', true, 'dinner'), published('2026-12-03', false)];
    expect(busyDayWrites(HOUSEHOLD, computed, rows)).toEqual([]);
  });

  it('updates a day whose busy state or reason changed', () => {
    const computed = [day('2026-12-02', true, 'booked'), day('2026-12-03', false)];
    const rows = [published('2026-12-02', true, 'dinner'), published('2026-12-03', true, 'marked')];
    expect(busyDayWrites(HOUSEHOLD, computed, rows).map((w) => [w.kind, w.values])).toEqual([
      ['update', { date: '2026-12-02', busy: true, reason: 'booked' }],
      ['update', { date: '2026-12-03', busy: false, reason: null }],
    ]);
  });

  it('two parents name the same day the same way', () => {
    expect(busyDayId(HOUSEHOLD, '2026-12-02')).toBe(busyDayId(HOUSEHOLD, '2026-12-02'));
    expect(busyDayId(HOUSEHOLD, '2026-12-02')).not.toBe(busyDayId(HOUSEHOLD, '2026-12-03'));
    expect(busyDayId(HOUSEHOLD, '2026-12-02')).not.toBe(overrideId(HOUSEHOLD, '2026-12-02'));
  });
});

describe('publishedBusyDays', () => {
  const dates = ['2026-12-02', '2026-12-03', '2026-12-04', '2026-12-05'];

  it('shows the published state and the fixed reason, and nothing about a day with no row', () => {
    const rows = [published('2026-12-02', true, 'dinner'), published('2026-12-03', false)];
    expect(publishedBusyDays(dates, rows, [])).toEqual([
      { date: '2026-12-02', busy: true, reason: 'dinner', overridden: false, bookedMinutes: null },
      { date: '2026-12-03', busy: false, reason: null, overridden: false, bookedMinutes: null },
      { date: '2026-12-04', busy: false, reason: null, overridden: false, bookedMinutes: null },
      { date: '2026-12-05', busy: false, reason: null, overridden: false, bookedMinutes: null },
    ]);
  });

  it("puts the household's own marks first, so a mark shows at once and offline", () => {
    const rows = [published('2026-12-02', true, 'dinner'), published('2026-12-03', false)];
    const marks = [
      mark('2026-12-02', false),
      mark('2026-12-03', true),
      // A cleared mark leaves the published state in charge.
      mark('2026-12-04', null),
    ];
    expect(publishedBusyDays(dates, rows, marks).map((d) => [d.busy, d.reason])).toEqual([
      [false, null],
      [true, 'marked'],
      [false, null],
      [false, null],
    ]);
  });
});

describe('publishBusyDays', () => {
  function fakeEngine(tables: Record<string, unknown[]>) {
    return {
      store: { rows: jest.fn(async (table: string) => tables[table] ?? []) },
      insert: jest.fn(async () => ({})),
      update: jest.fn(async () => ({})),
    } as unknown as Parameters<typeof publishBusyDays>[0] & {
      insert: jest.Mock;
      update: jest.Mock;
    };
  }
  const source: PublishSource = {
    householdId: HOUSEHOLD,
    today: '2026-12-01',
    timeZone: NY,
    weekStart: 7,
    parentIds: new Set([PARENT]),
    rule: DEFAULT_BUSY_RULE,
  };

  it("publishes a parent's private event as a busy day, with no title, time or event ID", async () => {
    const engine = fakeEngine({ events: [privateEvent('event-1', '2026-12-02', 16, 30)] });
    expect(await publishBusyDays(engine, source)).toBe(14);
    const values = engine.insert.mock.calls.map(([, , v]) => v);
    expect(values).toContainEqual({ date: '2026-12-02', busy: true, reason: 'dinner' });
    expect(values.filter((v) => v.busy)).toHaveLength(1);
    for (const call of engine.insert.mock.calls) {
      expect(call[0]).toBe('busy_days');
      expect(Object.keys(call[2]).sort()).toEqual(['busy', 'date', 'reason']);
      expect(JSON.stringify(call)).not.toMatch(/Therapy|event-1|T\d\d:/);
    }
  });

  it('writes only what changed once the window is published', async () => {
    const rows = publishWindow('2026-12-01').map((date) => published(date, false));
    const engine = fakeEngine({
      events: [privateEvent('event-1', '2026-12-02', 16, 30)],
      busy_days: rows,
    });
    expect(await publishBusyDays(engine, source)).toBe(1);
    expect(engine.insert).not.toHaveBeenCalled();
    expect(engine.update).toHaveBeenCalledWith('busy_days', busyDayId(HOUSEHOLD, '2026-12-02'), {
      date: '2026-12-02',
      busy: true,
      reason: 'dinner',
    });
  });
});
