import { fireEvent, render, screen, within } from '@testing-library/react-native';
import { Dimensions } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { AgendaScreen } from '@/features/calendar/agenda-screen';
import { i18n } from '@/i18n';
import { PSEUDO_LOCALE } from '@/i18n/locale';

let mockRows: Record<string, unknown[]> = {};
jest.mock('@/lib/sync', () => ({
  useSyncedRows: (table: string) => ({ rows: mockRows[table] ?? [], loading: false }),
}));
let mockOnline = true;
jest.mock('@/hooks/use-online', () => ({ useOnline: () => mockOnline }));
jest.mock('expo-router', () => {
  const { useEffect } = jest.requireActual('react');
  return { useFocusEffect: (effect: () => void) => useEffect(effect, [effect]) };
});
jest.mock('@/features/household/members', () => ({
  fetchMembers: async () => [{ userId: 'u2', displayName: 'Sam' }],
}));
const mockTrack = jest.fn();
jest.mock('@/lib/analytics', () => ({ track: (...a: unknown[]) => mockTrack(...a) }));

const metrics = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 47, left: 0, right: 0, bottom: 34 },
};
const base = {
  household_id: 'hh',
  version: 1,
  created_at: null,
  updated_at: null,
  deleted_at: null,
};
const event = (id: string, over: Record<string, unknown>) => ({
  ...base,
  id,
  kind: 'kind.appointment',
  title: 'Pediatrician',
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

const household = (locale: 'en-US' | 'en-GB' = 'en-US') => ({
  id: 'hh',
  locale,
  weekStart: 7 as const,
  timezone: 'America/New_York',
});

const mockOpenMeals = jest.fn();
const show = (locale?: 'en-US' | 'en-GB') =>
  render(
    <SafeAreaProvider initialMetrics={metrics}>
      <AgendaScreen household={household(locale)} userId="u1" onOpenMeals={mockOpenMeals} />
    </SafeAreaProvider>,
  );

const entry = (id: string, over: Record<string, unknown>) => ({
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

type Node = { props?: Record<string, unknown>; children?: (Node | string)[] | null };
/** Every rendered node that cuts its text short. */
function truncated(node: unknown): Node[] {
  if (!node || typeof node !== 'object') return [];
  if (Array.isArray(node)) return node.flatMap(truncated);
  const { props, children } = node as Node;
  const own = typeof props?.numberOfLines === 'number' ? [node as Node] : [];
  return [...own, ...(children ?? []).flatMap(truncated)];
}

beforeEach(() => {
  jest.useFakeTimers({ now: new Date('2026-11-18T12:00:00Z'), advanceTimers: true });
  mockRows = {};
  mockOnline = true;
  mockTrack.mockClear();
  mockOpenMeals.mockClear();
});
afterEach(() => jest.useRealTimers());

describe('S-36 agenda (FR2-CAL-1, FR2-CAL-6)', () => {
  it('shows the empty state and records calendar_viewed', async () => {
    await show();
    expect(screen.getByTestId('calendar-empty-state')).toBeTruthy();
    expect(mockTrack).toHaveBeenCalledWith('calendar_viewed', { view: 'agenda' });
  });

  it('opens on today and shows times on the household clock in its locale', async () => {
    mockRows.events = [
      event('e1', { starts_at: '2026-11-18T15:00:00Z', ends_at: '2026-11-18T16:00:00Z' }),
      event('e2', {
        kind: 'kind.childcare',
        title: 'Daycare',
        all_day: true,
        start_date: '2026-11-19',
        end_date: '2026-11-19',
      }),
    ];
    await show();
    const today = screen.getByTestId('calendar-day-2026-11-18');
    expect(today).toHaveTextContent(/Wednesday, November 18/);
    expect(within(today).getByTestId('calendar-today-tag')).toBeTruthy();
    const row = screen.getByTestId('calendar-event-e1:2026-11-18');
    expect(row).toHaveTextContent(/10:00\sAM – 11:00\sAM/);
    expect(row.props.accessibilityLabel).toMatch(
      /^Appointment, 10:00\sAM – 11:00\sAM, Pediatrician, Nobody taking yet$/,
    );
    expect(screen.getByTestId('calendar-event-e2:2026-11-19')).toHaveTextContent(/All day/);
  });

  it('uses 24-hour times and day-month order for en-GB', async () => {
    mockRows.events = [
      event('e1', { starts_at: '2026-11-18T15:00:00Z', ends_at: '2026-11-18T16:00:00Z' }),
    ];
    await show('en-GB');
    expect(screen.getByTestId('calendar-day-2026-11-18')).toHaveTextContent(
      /Wednesday 18 November/,
    );
    expect(screen.getByTestId('calendar-event-e1:2026-11-18')).toHaveTextContent(
      /^10:00 – 11:00Pediatrician/,
    );
  });

  it('says it works offline when the device is offline', async () => {
    mockOnline = false;
    mockRows.events = [
      event('e1', { starts_at: '2026-11-18T15:00:00Z', ends_at: '2026-11-18T16:00:00Z' }),
    ];
    await show();
    expect(screen.getByTestId('calendar-offline')).toBeTruthy();
    expect(screen.getByTestId('calendar-event-e1:2026-11-18')).toBeTruthy();
  });

  it('never truncates text, so the pseudo-locale and the largest sizes wrap (NFR2-L10N-1)', async () => {
    mockRows.events = [
      event('e1', { starts_at: '2026-11-18T15:00:00Z', ends_at: '2026-11-18T16:00:00Z' }),
    ];
    // The pseudo-locale is on only in development builds that ask for it (src/i18n/instance.ts).
    i18n.options.postProcess = ['pseudo'];
    await i18n.changeLanguage(PSEUDO_LOCALE);
    try {
      const { ThemeOverride } =
        jest.requireActual<typeof import('@/hooks/use-theme')>('@/hooks/use-theme');
      await render(
        <SafeAreaProvider initialMetrics={metrics}>
          <ThemeOverride fontScale={2}>
            <AgendaScreen household={household()} />
          </ThemeOverride>
        </SafeAreaProvider>,
      );
      expect(screen.getByTestId('calendar-day-2026-11-18')).toHaveTextContent(/Ţóðáý/);
      expect(truncated(screen.toJSON())).toEqual([]);
    } finally {
      i18n.options.postProcess = false;
      await i18n.changeLanguage('en-US');
    }
  });
});

describe('S-36 day and week views (FR2-CAL-1, FR2-CAL-5, NFR2-A11Y-1)', () => {
  // React Native's Jest setup reports a text size of 2; these views start at the default.
  const window = { width: 390, height: 844, scale: 3, fontScale: 1 };
  beforeEach(() => Dimensions.set({ window, screen: window }));
  afterEach(() => Dimensions.set({ window: { ...window, fontScale: 2 }, screen: window }));

  it('names who is taking an event, on screen and to screen readers', async () => {
    mockRows.events = [
      event('e1', {
        starts_at: '2026-11-18T15:00:00Z',
        ends_at: '2026-11-18T16:00:00Z',
        taking_user_id: 'u1',
      }),
    ];
    await show();
    const row = screen.getByTestId('calendar-event-e1:2026-11-18');
    expect(row).toHaveTextContent(/Appointment · You taking/);
    expect(row.props.accessibilityLabel).toMatch(/, Pediatrician, You taking$/);
  });

  it("shows a day's planned meals as one row that opens the plan on that day", async () => {
    mockRows.plan_entries = [
      entry('Lasagne', {}),
      entry('Soup', { slot: 'lunch' }),
      entry('Toast', { date: '2026-11-25', slot: 'breakfast' }),
    ];
    await show();
    const meals = screen.getByTestId('calendar-meals-2026-11-18');
    expect(meals).toHaveTextContent('Lunch: Soup; Dinner: Lasagne');
    expect(meals.props.accessibilityLabel).toBe(
      'Planned meals for Wednesday, November 18: Lunch: Soup; Dinner: Lasagne',
    );
    await fireEvent.press(meals);
    expect(mockOpenMeals).toHaveBeenCalledWith('2026-11-18');
  });

  it('switches to the day view, steps through days and lays overlaps side by side', async () => {
    mockRows.events = [
      event('a', { starts_at: '2026-11-18T14:00:00Z', ends_at: '2026-11-18T15:00:00Z' }),
      event('b', { starts_at: '2026-11-18T14:30:00Z', ends_at: '2026-11-18T16:00:00Z' }),
      event('c', { starts_at: '2026-11-19T14:00:00Z', ends_at: '2026-11-19T15:00:00Z' }),
    ];
    mockRows.plan_entries = [entry('Lasagne', {})];
    await show();
    await fireEvent.press(screen.getByTestId('calendar-view-day'));
    expect(mockTrack).toHaveBeenCalledWith('calendar_viewed', { view: 'day' });
    expect(screen.getByTestId('calendar-day-label')).toHaveTextContent('Wednesday, November 18');
    expect(screen.getByTestId('calendar-meals-2026-11-18')).toHaveTextContent('Dinner: Lasagne');
    const overlap = screen.getByTestId('calendar-overlap-2');
    expect(within(overlap).getByTestId('calendar-event-a:2026-11-18')).toBeTruthy();
    expect(within(overlap).getByTestId('calendar-event-b:2026-11-18')).toBeTruthy();
    expect(screen.queryByTestId('calendar-event-c:2026-11-19')).toBeNull();

    await fireEvent.press(screen.getByTestId('calendar-day-next'));
    expect(screen.getByTestId('calendar-day-label')).toHaveTextContent('Thursday, November 19');
    expect(screen.getByTestId('calendar-event-c:2026-11-19')).toBeTruthy();
    expect(screen.queryByTestId('calendar-meals-2026-11-18')).toBeNull();
    await fireEvent.press(screen.getByTestId('calendar-day-today'));
    expect(screen.getByTestId('calendar-day-label')).toHaveTextContent('Wednesday, November 18');
  });

  it("shows the week from the household's week start and opens a day from it", async () => {
    mockRows.events = [
      event('c', { starts_at: '2026-11-20T14:00:00Z', ends_at: '2026-11-20T15:00:00Z' }),
    ];
    await show();
    await fireEvent.press(screen.getByTestId('calendar-view-week'));
    expect(mockTrack).toHaveBeenCalledWith('calendar_viewed', { view: 'week' });
    // The household's week starts on Sunday.
    expect(screen.getByTestId('calendar-week-label')).toHaveTextContent(/Nov 15 – Nov 21/);
    expect(screen.getByTestId('calendar-week-day-2026-11-15')).toBeTruthy();
    expect(screen.getByTestId('calendar-week-day-2026-11-21')).toBeTruthy();
    const friday = screen.getByTestId('calendar-week-day-2026-11-20');
    expect(within(friday).getByTestId('calendar-event-c:2026-11-20')).toBeTruthy();

    await fireEvent.press(screen.getByTestId('calendar-week-next'));
    expect(screen.getByTestId('calendar-week-label')).toHaveTextContent(/Nov 22 – Nov 28/);
    await fireEvent.press(screen.getByTestId('calendar-week-open-2026-11-24'));
    expect(screen.getByTestId('calendar-day-view')).toBeTruthy();
    expect(screen.getByTestId('calendar-day-label')).toHaveTextContent('Tuesday, November 24');
  });

  it('offers no week view at the largest text sizes, showing the agenda instead', async () => {
    const { ThemeOverride } =
      jest.requireActual<typeof import('@/hooks/use-theme')>('@/hooks/use-theme');
    await render(
      <SafeAreaProvider initialMetrics={metrics}>
        <ThemeOverride fontScale={2}>
          <AgendaScreen household={household()} />
        </ThemeOverride>
      </SafeAreaProvider>,
    );
    expect(screen.queryByTestId('calendar-view-week')).toBeNull();
    expect(screen.getByTestId('calendar-view-day')).toBeTruthy();
  });
});
