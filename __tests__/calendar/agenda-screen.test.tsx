import { render, screen, within } from '@testing-library/react-native';
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

const show = (locale?: 'en-US' | 'en-GB') =>
  render(
    <SafeAreaProvider initialMetrics={metrics}>
      <AgendaScreen household={household(locale)} />
    </SafeAreaProvider>,
  );

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
      /^Appointment, 10:00\sAM – 11:00\sAM, Pediatrician$/,
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
