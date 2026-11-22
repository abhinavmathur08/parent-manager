import { act, fireEvent, render, renderHook, screen } from '@testing-library/react-native';
import { Alert } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { agendaDays } from '@/features/calendar/agenda';
import {
  canSave,
  draftFromEvent,
  draftFromOccurrence,
  draftValues,
  newDraft,
  repeatFromRule,
  repeatRule,
} from '@/features/calendar/editor';
import { EventDetailScreen } from '@/features/calendar/event-detail-screen';
import { expandOccurrences } from '@/features/calendar/repeat';
import { exceptionId, type EventExceptionRow, type EventRow } from '@/features/calendar/tables';
import { useOccurrenceWrites, useUpdateEvent } from '@/features/calendar/writes';

let mockRows: Record<string, unknown[]> = {};
const mockInsert = jest.fn(async (..._args: unknown[]) => ({}));
const mockUpdate = jest.fn(async (..._args: unknown[]) => ({}));
const mockRemove = jest.fn(async (..._args: unknown[]) => ({}));
jest.mock('@/lib/sync', () => ({
  useSyncedRows: (table: string) => ({ rows: mockRows[table] ?? [], loading: false }),
  useSyncWriter: () => ({ insert: mockInsert, update: mockUpdate, remove: mockRemove }),
}));
let mockUuid = 0;
jest.mock('expo-crypto', () => ({
  randomUUID: () => `00000000-0000-4000-8000-${String(++mockUuid).padStart(12, '0')}`,
}));
jest.mock('@/features/people/data', () => ({ fetchPeople: async () => [] }));
jest.mock('@/features/household/members', () => ({ fetchMembers: async () => [] }));
const mockTrack = jest.fn();
jest.mock('@/lib/analytics', () => ({ track: (...a: unknown[]) => mockTrack(...a) }));

const NY = 'America/New_York';
const base = {
  household_id: 'hh',
  version: 1,
  created_at: null,
  updated_at: null,
  deleted_at: null,
};
// Daycare pickup, Mondays at 17:00 New York time, from Monday 2026-11-23.
const series: EventRow = {
  ...base,
  id: 'e1',
  kind: 'kind.childcare',
  title: 'Daycare pickup',
  all_day: false,
  starts_at: '2026-11-23T22:00:00Z',
  ends_at: '2026-11-23T22:30:00Z',
  start_date: null,
  end_date: null,
  place: null,
  notes: null,
  taking_user_id: null,
  shared: true,
  repeat: { freq: 'weekly', weekdays: [1] },
  created_by: 'parent',
  updated_by: 'parent',
};
const range = { timeZone: NY, weekStart: 1 as const, from: '2026-11-23', days: 21 };

beforeEach(() => {
  jest.clearAllMocks();
  mockRows = { events: [series] };
});

describe('repeat picker rules (FR2-CAL-4)', () => {
  const draft = newDraft(new Date('2026-11-18T19:20:00Z'), NY, true);

  it('turns each choice into the stored rule and back', () => {
    const with_ = (repeat: object) => ({
      ...draft,
      repeat: { ...repeatFromRule(null, draft.date), ...repeat },
    });
    expect(repeatRule(draft)).toBeNull();
    expect(repeatRule(with_({ choice: 'daily' }))).toEqual({ freq: 'daily' });
    expect(repeatRule(with_({ choice: 'weekly', weekdays: [5, 1] }))).toEqual({
      freq: 'weekly',
      weekdays: [1, 5],
    });
    expect(
      repeatRule(with_({ choice: 'biweekly', weekdays: [3], end: 'count', count: 6 })),
    ).toEqual({
      freq: 'weekly',
      interval: 2,
      weekdays: [3],
      count: 6,
    });
    expect(repeatRule(with_({ choice: 'monthly', end: 'until', until: '2027-03-18' }))).toEqual({
      freq: 'monthly',
      until: '2027-03-18',
    });
    expect(
      repeatFromRule({ freq: 'weekly', interval: 2, weekdays: [3], count: 6 }, '2026-11-18'),
    ).toMatchObject({
      choice: 'biweekly',
      weekdays: [3],
      end: 'count',
      count: 6,
    });
  });

  it('needs a weekday for a weekly rule', () => {
    const repeat = { ...repeatFromRule(null, draft.date), choice: 'weekly' as const, weekdays: [] };
    expect(canSave({ ...draft, title: 'Swim', repeat })).toBe(false);
  });

  it('reads drafts saved before repeats as not repeating', () => {
    const { repeat: _repeat, ...old } = draft;
    expect(repeatRule({ ...old, title: 'Old' })).toBeNull();
  });
});

describe('"this event" and "all events" (FR2-CAL-4, R2-CAL-2)', () => {
  const occurrenceOn = (date: string, exceptions: EventExceptionRow[] = []) =>
    expandOccurrences(series, {
      timeZone: NY,
      from: new Date('2026-11-01T00:00:00Z'),
      to: new Date('2027-01-01T00:00:00Z'),
      exceptions,
    }).find((o) => o.originalDate === date)!;

  it('moving next Monday to 17:30 changes only that day', async () => {
    const { result } = await renderHook(() => useOccurrenceWrites(NY));
    const draft = {
      ...draftFromOccurrence(series, occurrenceOn('2026-11-30'), [], [], NY),
      startMinutes: 17 * 60 + 30,
    };
    await result.current.move(series, '2026-11-30', draft, []);
    const [table, id, values] = mockInsert.mock.calls[0] as [
      string,
      string,
      Record<string, unknown>,
    ];
    expect(table).toBe('event_exceptions');
    expect(id).toBe(exceptionId('e1', '2026-11-30'));
    expect(values).toMatchObject({ status: 'moved', starts_at: '2026-11-30T22:30:00.000Z' });
    expect(mockTrack).toHaveBeenCalledWith('event_updated', { kind: 'childcare', scope: 'one' });

    const exception = { ...base, id, ...values } as unknown as EventExceptionRow;
    const days = agendaDays([series], [exception], range);
    const times = days.flatMap((d) => d.items.map((i) => [d.date, i.occurrence.startsAt]));
    expect(times).toEqual([
      ['2026-11-23', '2026-11-23T22:00:00.000Z'],
      ['2026-11-30', '2026-11-30T22:30:00.000Z'],
      ['2026-12-07', '2026-12-07T22:00:00.000Z'],
    ]);
  });

  it('updates an existing exception instead of adding a second one', async () => {
    const { result } = await renderHook(() => useOccurrenceWrites(NY));
    const existing = {
      ...base,
      id: exceptionId('e1', '2026-11-30'),
      event_id: 'e1',
      original_date: '2026-11-30',
      status: 'moved' as const,
      starts_at: '2026-11-30T22:30:00Z',
      ends_at: '2026-11-30T23:00:00Z',
      start_date: null,
      end_date: null,
      taking_user_id: null,
    };
    await result.current.skip(series, '2026-11-30', [existing]);
    expect(mockInsert).not.toHaveBeenCalled();
    expect(mockUpdate).toHaveBeenCalledWith(
      'event_exceptions',
      existing.id,
      expect.objectContaining({ status: 'skipped' }),
    );
    expect(mockTrack).toHaveBeenCalledWith('event_deleted', { kind: 'childcare', scope: 'one' });
  });

  it('editing all events keeps the exceptions', async () => {
    const moved = {
      ...base,
      id: exceptionId('e1', '2026-11-30'),
      event_id: 'e1',
      original_date: '2026-11-30',
      status: 'moved' as const,
      starts_at: '2026-11-30T22:30:00Z',
      ends_at: '2026-11-30T23:00:00Z',
      start_date: null,
      end_date: null,
      taking_user_id: null,
    };
    const { result } = await renderHook(() => useUpdateEvent(NY, 'parent'));
    const draft = { ...draftFromEvent(series, [], [], NY), startMinutes: 16 * 60 };
    await result.current(series, draft, { people: [], reminders: [] });
    expect(mockUpdate.mock.calls.map(([table]) => table)).toEqual(['events']);
    expect(mockTrack).toHaveBeenCalledWith('event_updated', { kind: 'childcare', scope: 'all' });

    const updated = { ...series, ...draftValues(draft, NY) } as EventRow;
    const days = agendaDays([updated], [moved], range);
    expect(days.flatMap((d) => d.items.map((i) => i.occurrence.startsAt))).toEqual([
      '2026-11-23T21:00:00.000Z',
      '2026-11-30T22:30:00.000Z',
      '2026-12-07T21:00:00.000Z',
    ]);
  });
});

describe('detail of a repeating event (FR2-CAL-8)', () => {
  const metrics = {
    frame: { x: 0, y: 0, width: 390, height: 844 },
    insets: { top: 47, left: 0, right: 0, bottom: 34 },
  };
  const onEdit = jest.fn();
  const show = async () => {
    await render(
      <SafeAreaProvider initialMetrics={metrics}>
        <EventDetailScreen
          eventId="e1"
          date="2026-11-30"
          household={{ id: 'hh', locale: 'en-US', timeZone: NY }}
          role="parent"
          userId="parent"
          onBack={jest.fn()}
          onEdit={onEdit}
        />
      </SafeAreaProvider>,
    );
    await act(async () => undefined);
  };

  beforeEach(() =>
    jest.useFakeTimers({ now: new Date('2026-11-18T12:00:00Z'), advanceTimers: true }),
  );
  afterEach(() => jest.useRealTimers());

  it('asks "this event" or "all events" before editing', async () => {
    await show();
    expect(screen.getByTestId('event-detail-repeats')).toHaveTextContent(/Every week/);
    await fireEvent.press(screen.getByTestId('event-edit'));
    await fireEvent.press(screen.getByTestId('event-scope-one'));
    expect(onEdit).toHaveBeenLastCalledWith(
      expect.objectContaining({ id: 'e1' }),
      expect.anything(),
      expect.objectContaining({ originalDate: '2026-11-30' }),
    );
    await fireEvent.press(screen.getByTestId('event-edit'));
    await fireEvent.press(screen.getByTestId('event-scope-all'));
    expect(onEdit).toHaveBeenLastCalledWith(
      expect.objectContaining({ id: 'e1' }),
      expect.anything(),
      null,
    );
  });

  it('deletes one occurrence after the undo, as a skipped exception', async () => {
    await show();
    await fireEvent.press(screen.getByTestId('event-delete'));
    await fireEvent.press(screen.getByTestId('event-scope-one'));
    await act(async () => {
      jest.advanceTimersByTime(5100);
    });
    expect(mockInsert).toHaveBeenCalledWith(
      'event_exceptions',
      exceptionId('e1', '2026-11-30'),
      expect.objectContaining({ status: 'skipped', original_date: '2026-11-30' }),
    );
    expect(mockRemove).not.toHaveBeenCalled();
  });

  it('confirms before deleting the whole series', async () => {
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    await show();
    await fireEvent.press(screen.getByTestId('event-delete'));
    await fireEvent.press(screen.getByTestId('event-scope-all'));
    expect(alert).toHaveBeenCalledWith(
      'Delete every event in this series?',
      expect.stringContaining('Daycare pickup'),
      expect.any(Array),
    );
    expect(mockRemove).not.toHaveBeenCalled();
    const buttons = alert.mock.calls[0][2] as { style?: string; onPress?: () => void }[];
    await act(async () => buttons.find((b) => b.style === 'destructive')?.onPress?.());
    await act(async () => {
      jest.advanceTimersByTime(5100);
    });
    expect(mockRemove).toHaveBeenCalledWith('events', 'e1');
    expect(mockTrack).toHaveBeenCalledWith('event_deleted', { kind: 'childcare', scope: 'all' });
    alert.mockRestore();
  });
});
