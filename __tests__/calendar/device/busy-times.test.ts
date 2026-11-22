import {
  busyBlocks,
  DEFAULT_BUSY_TIMES,
  parseBusyTimes,
  planBlocks,
} from '@/features/calendar/device/busy-times';
import type { BusyBlockRow } from '@/features/calendar/tables';

const at = (iso: string) => Date.parse(iso);
const ev = (id: string, start: string, end: string, allDay = false) => ({
  id,
  allDay,
  startsAt: at(start),
  endsAt: at(end),
});
const window = {
  from: at('2026-11-22T12:00:00Z'),
  to: at('2026-12-06T12:00:00Z'),
  skipIds: new Set<string>(),
};

describe('busy blocks from device events (C-05.3, R2-BUSY-3)', () => {
  it('keeps timed events only, never all-day events or our own copies', () => {
    const blocks = busyBlocks(
      [
        ev('a', '2026-11-23T15:00:00Z', '2026-11-23T16:00:00Z'),
        ev('holiday', '2026-11-26T00:00:00Z', '2026-11-27T00:00:00Z', true),
        ev('copy', '2026-11-24T15:00:00Z', '2026-11-24T16:00:00Z'),
      ],
      { ...window, skipIds: new Set(['copy']) },
    );
    expect(blocks).toEqual([
      { starts_at: '2026-11-23T15:00:00.000Z', ends_at: '2026-11-23T16:00:00.000Z' },
    ]);
  });

  it('clips to the window and merges overlaps', () => {
    const blocks = busyBlocks(
      [
        ev('past', '2026-11-20T10:00:00Z', '2026-11-20T11:00:00Z'),
        ev('started', '2026-11-22T11:00:00Z', '2026-11-22T13:00:00Z'),
        ev('a', '2026-11-23T15:00:00Z', '2026-11-23T16:00:00Z'),
        ev('b', '2026-11-23T15:30:00Z', '2026-11-23T17:00:00Z'),
        ev('touching', '2026-11-23T17:00:00Z', '2026-11-23T17:30:00Z'),
        ev('later', '2026-12-06T11:00:00Z', '2026-12-07T11:00:00Z'),
      ],
      window,
    );
    expect(blocks).toEqual([
      { starts_at: '2026-11-22T12:00:00.000Z', ends_at: '2026-11-22T13:00:00.000Z' },
      { starts_at: '2026-11-23T15:00:00.000Z', ends_at: '2026-11-23T17:30:00.000Z' },
      { starts_at: '2026-12-06T11:00:00.000Z', ends_at: '2026-12-06T12:00:00.000Z' },
    ]);
  });

  it('cuts a long event into pieces of at most a day', () => {
    const blocks = busyBlocks([ev('trip', '2026-11-24T08:00:00Z', '2026-11-26T20:00:00Z')], window);
    expect(blocks).toEqual([
      { starts_at: '2026-11-24T08:00:00.000Z', ends_at: '2026-11-25T08:00:00.000Z' },
      { starts_at: '2026-11-25T08:00:00.000Z', ends_at: '2026-11-26T08:00:00.000Z' },
      { starts_at: '2026-11-26T08:00:00.000Z', ends_at: '2026-11-26T20:00:00.000Z' },
    ]);
  });

  it('adds new blocks, keeps unchanged ones and removes the rest', () => {
    const row = (
      id: string,
      starts_at: string,
      ends_at: string,
      deleted_at: string | null = null,
    ) =>
      ({
        id,
        household_id: 'h1',
        user_id: 'u1',
        starts_at,
        ends_at,
        version: 1,
        created_at: null,
        updated_at: null,
        deleted_at,
      }) as BusyBlockRow;
    const plan = planBlocks(
      [
        // The same instant, written differently by the server.
        { starts_at: '2026-11-23T15:00:00.000Z', ends_at: '2026-11-23T16:00:00.000Z' },
        { starts_at: '2026-11-24T15:00:00.000Z', ends_at: '2026-11-24T16:00:00.000Z' },
      ],
      [
        row('keep', '2026-11-23T15:00:00+00:00', '2026-11-23T16:00:00+00:00'),
        row('dup', '2026-11-23T15:00:00Z', '2026-11-23T16:00:00Z'),
        row('moved', '2026-11-25T15:00:00Z', '2026-11-25T16:00:00Z'),
        row('gone', '2026-11-24T15:00:00Z', '2026-11-24T16:00:00Z', '2026-11-20T00:00:00Z'),
      ],
    );
    expect(plan.insert).toEqual([
      { starts_at: '2026-11-24T15:00:00.000Z', ends_at: '2026-11-24T16:00:00.000Z' },
    ]);
    expect(plan.remove.sort()).toEqual(['dup', 'moved']);
  });

  it('reads the server setting, falling back for bad values (R2-PAY-1)', () => {
    expect(parseBusyTimes({ window_days: 7, refresh_minutes: 30 })).toEqual({
      windowDays: 7,
      refreshMinutes: 30,
    });
    expect(parseBusyTimes({ window_days: 0, refresh_minutes: 'x' })).toEqual(DEFAULT_BUSY_TIMES);
    expect(parseBusyTimes(null)).toEqual({ windowDays: 14, refreshMinutes: 15 });
  });
});
