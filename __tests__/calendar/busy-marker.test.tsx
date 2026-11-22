import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { BusyDaysProvider, type BusyViewer } from '@/features/calendar/busy-days';
import { BusyDayMarker, BusyMarkButton, resetShownBusyDays } from '@/features/calendar/busy-marker';
import { zonedInstant } from '@/features/calendar/repeat';
import { busyDayId, overrideId } from '@/features/calendar/tables';

let mockRows: Record<string, unknown[]> = {};
const mockInsert = jest.fn(async () => ({}));
const mockUpdate = jest.fn(async () => ({}));
jest.mock('@/lib/sync', () => ({
  useSyncedRows: (table: string) => ({ rows: mockRows[table] ?? [], loading: false }),
  useSyncWriter: () => ({ insert: mockInsert, update: mockUpdate, remove: jest.fn() }),
}));
jest.mock('@/features/calendar/use-members', () => ({
  useCalendarMembers: () => [
    { userId: 'parent-1', role: 'parent', joinedAt: '', displayName: null },
    { userId: 'parent-2', role: 'parent', joinedAt: '', displayName: null },
  ],
}));
jest.mock('@/features/calendar/busy-rule', () => ({
  useBusyRule: () => jest.requireActual('@/features/calendar/busy').DEFAULT_BUSY_RULE,
}));
const mockTrack = jest.fn();
jest.mock('@/lib/analytics', () => ({ track: (...a: unknown[]) => mockTrack(...a) }));

const HOUSEHOLD = '3f2a1c4e-8b7d-4e6f-9a0b-1c2d3e4f5a6b';
const NY = 'America/New_York';
const DATE = '2026-12-02';
const metrics = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 47, left: 0, right: 0, bottom: 34 },
};
const base = (id: string) => ({
  id,
  household_id: HOUSEHOLD,
  version: 1,
  created_at: null,
  updated_at: null,
  deleted_at: null,
});
const at = (hour: number, minute: number) =>
  new Date(zonedInstant({ date: DATE, hour, minute, second: 0, ms: 0 }, NY)).toISOString();
const privateEvent = {
  ...base('event-1'),
  kind: 'kind.appointment',
  title: 'Therapy',
  all_day: false,
  starts_at: at(16, 30),
  ends_at: at(17, 30),
  start_date: null,
  end_date: null,
  place: null,
  notes: null,
  taking_user_id: null,
  shared: false,
  repeat: null,
  created_by: 'parent-1',
  updated_by: 'parent-1',
};

const viewer = (role: BusyViewer['role'], userId: string): BusyViewer => ({
  householdId: HOUSEHOLD,
  userId,
  role,
  timeZone: NY,
  weekStart: 7,
});

const show = (role: BusyViewer['role'], userId = `${role}-1`) =>
  render(
    <SafeAreaProvider initialMetrics={metrics}>
      <BusyDaysProvider viewer={viewer(role, userId)}>
        <BusyDayMarker date={DATE} locale="en-US" />
        <BusyMarkButton date={DATE} locale="en-US" />
      </BusyDaysProvider>
    </SafeAreaProvider>,
  );

beforeEach(() => {
  mockRows = {};
  mockInsert.mockClear();
  mockUpdate.mockClear();
  mockTrack.mockClear();
  resetShownBusyDays();
});

describe('busy markers (FR2-BUSY-1, R2-BUSY-2)', () => {
  it("shows a parent the marker for any parent's event, with an icon and the reason", async () => {
    mockRows = { events: [privateEvent] };
    await show('parent');
    const marker = screen.getByTestId(`busy-marker-${DATE}`);
    expect(marker).toHaveTextContent('Busy around dinner');
    expect(marker.props.accessibilityLabel).toBe('Busy day: Busy around dinner');
    expect(mockTrack).toHaveBeenCalledWith('busy_day_shown', { reason: 'dinner' });
  });

  it("says how many hours are booked on a parent's device", async () => {
    mockRows = {
      events: [{ ...privateEvent, starts_at: at(9, 0), ends_at: at(13, 0) }],
    };
    await show('parent');
    expect(screen.getByTestId(`busy-marker-${DATE}`)).toHaveTextContent('4 hours booked');
  });

  it('shows a caregiver the published marker, with no events on the device and no way to mark', async () => {
    mockRows = {
      busy_days: [
        { ...base(busyDayId(HOUSEHOLD, DATE)), date: DATE, busy: true, reason: 'dinner' },
      ],
    };
    await show('caregiver');
    expect(screen.getByTestId(`busy-marker-${DATE}`)).toHaveTextContent('Busy around dinner');
    expect(screen.queryByText(/Therapy|4:30/)).toBeNull();
    expect(screen.queryByTestId(`busy-mark-open-${DATE}`)).toBeNull();
  });

  it("doesn't show a booked day's hours to a family member, who can't know them", async () => {
    mockRows = {
      busy_days: [
        { ...base(busyDayId(HOUSEHOLD, DATE)), date: DATE, busy: true, reason: 'booked' },
      ],
    };
    await show('family');
    expect(screen.getByTestId(`busy-marker-${DATE}`)).toHaveTextContent('Busy day');
  });

  it("shows nothing to a caregiver on a day that isn't busy", async () => {
    await show('caregiver');
    expect(screen.queryByTestId(`busy-marker-${DATE}`)).toBeNull();
    expect(screen.queryByTestId(`busy-mark-open-${DATE}`)).toBeNull();
  });
});

describe('marking a day (FR2-BUSY-4)', () => {
  it('lets a family member mark a quiet day busy, which shows at once', async () => {
    const view = await show('family');
    expect(screen.queryByTestId(`busy-marker-${DATE}`)).toBeNull();
    fireEvent.press(screen.getByTestId(`busy-mark-open-${DATE}`));
    fireEvent.press(await screen.findByTestId('busy-mark-busy'));
    expect(mockInsert).toHaveBeenCalledWith('busy_day_overrides', overrideId(HOUSEHOLD, DATE), {
      date: DATE,
      busy: true,
      set_by: null,
    });
    await waitFor(() =>
      expect(mockTrack).toHaveBeenCalledWith('busy_day_overridden', { busy: true }),
    );

    // The local copy now has the mark.
    mockRows = {
      busy_day_overrides: [
        { ...base(overrideId(HOUSEHOLD, DATE)), date: DATE, busy: true, set_by: 'family-1' },
      ],
    };
    await view.rerender(
      <SafeAreaProvider initialMetrics={metrics}>
        <BusyDaysProvider viewer={viewer('family', 'family-1')}>
          <BusyDayMarker date={DATE} locale="en-US" />
          <BusyMarkButton date={DATE} locale="en-US" />
        </BusyDaysProvider>
      </SafeAreaProvider>,
    );
    expect(screen.getByTestId(`busy-marker-${DATE}`)).toHaveTextContent('Marked busy');
  });

  it("lets a parent mark a busy day not busy, changing the day's one row", async () => {
    mockRows = {
      events: [privateEvent],
      busy_day_overrides: [
        { ...base(overrideId(HOUSEHOLD, DATE)), date: DATE, busy: null, set_by: null },
      ],
    };
    await show('parent');
    fireEvent.press(screen.getByTestId(`busy-mark-open-${DATE}`));
    fireEvent.press(await screen.findByTestId('busy-mark-notBusy'));
    expect(mockUpdate).toHaveBeenCalledWith('busy_day_overrides', overrideId(HOUSEHOLD, DATE), {
      busy: false,
    });
    expect(mockInsert).not.toHaveBeenCalled();
  });
});
