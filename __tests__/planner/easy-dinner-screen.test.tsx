import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { BusyDaysProvider } from '@/features/calendar/busy-days';
import { overrideId } from '@/features/calendar/tables';
import { PlanWeekScreen } from '@/features/planner/week-screen';

let mockRows: Record<string, unknown[]> = {};
const mockInsert = jest.fn(async () => ({}));
const mockUpdate = jest.fn(async () => ({}));
const mockRemove = jest.fn(async () => ({}));
jest.mock('@/lib/sync', () => ({
  useSyncedRows: (table: string) => ({ rows: mockRows[table] ?? [], loading: false }),
  useSyncWriter: () => ({ insert: mockInsert, update: mockUpdate, remove: mockRemove }),
}));
const mockStore = new Map<string, string>();
jest.mock('expo-sqlite/kv-store', () => ({
  __esModule: true,
  default: {
    getItemSync: (key: string) => mockStore.get(key) ?? null,
    setItemSync: (key: string, value: string) => mockStore.set(key, value),
  },
}));
let mockUuid = 0;
jest.mock('expo-crypto', () => ({
  randomUUID: () => `00000000-0000-4000-8000-${String(++mockUuid).padStart(12, '0')}`,
}));
jest.mock('@/features/people/data', () => ({
  fetchPeople: async () => [
    {
      id: 'p1',
      displayName: 'Mia',
      ageBand: 'toddler',
      dueMonth: null,
      allergies: ['allergen.milk'],
      diets: [],
    },
  ],
}));
jest.mock('@/hooks/use-online', () => ({ useOnline: () => true }));
jest.mock('expo-router', () => ({ router: { push: jest.fn() } }));
let mockPremium = false;
const mockOpenPremiumSheet = jest.fn();
jest.mock('@/features/subscription/entitlement', () => ({
  useEntitlement: () => ({ isPremium: mockPremium }),
}));
jest.mock('@/features/subscription/premium-sheet', () => ({
  usePremiumSheet: () => ({ openPremiumSheet: mockOpenPremiumSheet }),
}));
jest.mock('@/lib/supabase', () => ({
  getSupabase: () => ({
    from: () => {
      const chain: Record<string, unknown> = {};
      for (const m of ['select', 'eq']) chain[m] = () => chain;
      chain.order = async () => ({ data: [], error: null });
      return chain;
    },
  }),
}));
jest.mock('@/features/calendar/use-members', () => ({
  useCalendarMembers: () => [
    { userId: 'parent-1', role: 'parent', joinedAt: '', displayName: null },
  ],
}));
jest.mock('@/features/calendar/busy-rule', () => ({
  useBusyRule: () => jest.requireActual('@/features/calendar/busy').DEFAULT_BUSY_RULE,
}));
const mockTrack = jest.fn();
jest.mock('@/lib/analytics', () => ({ track: (...a: unknown[]) => mockTrack(...a) }));

const metrics = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 47, left: 0, right: 0, bottom: 34 },
};
const base = (id: string) => ({
  id,
  household_id: 'hh',
  version: 1,
  created_at: null,
  updated_at: null,
  deleted_at: null,
});
const BUSY = '2026-11-19';
const household = { id: 'hh', locale: 'en-US' as const, weekStart: 7 as const, timezone: 'UTC' };
const quickWraps = {
  ...base('r-wraps'),
  title: 'Bean wraps',
  servings: 4,
  prep_minutes: 10,
  cook_minutes: 5,
  tags: ['tag.quick'],
  notes: null,
  source_type: 'manual',
  source_url: null,
  library_recipe_id: null,
  content_locale: 'en-US',
  created_by: null,
  updated_by: null,
};

const show = () =>
  render(
    <SafeAreaProvider initialMetrics={metrics}>
      <BusyDaysProvider
        viewer={{
          householdId: 'hh',
          userId: 'parent-1',
          role: 'parent',
          timeZone: 'UTC',
          weekStart: 7,
        }}
      >
        <PlanWeekScreen household={household} canWrite />
      </BusyDaysProvider>
    </SafeAreaProvider>,
  );

beforeEach(() => {
  jest.useFakeTimers({ now: new Date('2026-11-18T12:00:00Z'), advanceTimers: true });
  mockStore.clear();
  mockInsert.mockClear();
  mockRemove.mockClear();
  mockTrack.mockClear();
  mockOpenPremiumSheet.mockClear();
  mockUuid = 0;
  // Thursday is marked busy, and its dinner is empty.
  mockRows = {
    busy_day_overrides: [
      { ...base(overrideId('hh', BUSY)), date: BUSY, busy: true, set_by: 'parent-1' },
    ],
    recipes: [quickWraps],
  };
});
afterEach(() => jest.useRealTimers());

describe('easy dinners on a free household (FR2-BUSY-5)', () => {
  beforeEach(() => {
    mockPremium = false;
  });

  it('shows the marker and one "easy dinner ideas", which opens the Premium sheet', async () => {
    await show();
    expect(screen.getByTestId(`busy-marker-${BUSY}`)).toHaveTextContent('Marked busy');
    expect(screen.queryByTestId(`easy-dinner-open-${BUSY}`)).toBeNull();
    expect(screen.queryByTestId('easy-dinner-0')).toBeNull();
    await fireEvent.press(screen.getByTestId(`easy-dinner-ideas-${BUSY}`));
    expect(mockOpenPremiumSheet).toHaveBeenCalledWith('busy_day_meals');
    // The plan never changes without a tap (FR2-BUSY-3).
    expect(mockInsert).not.toHaveBeenCalled();
  });

  it('shows the prompt on one day a week at most', async () => {
    mockRows.busy_day_overrides = [
      { ...base(overrideId('hh', BUSY)), date: BUSY, busy: true, set_by: 'parent-1' },
      { ...base(overrideId('hh', '2026-11-20')), date: '2026-11-20', busy: true, set_by: null },
    ];
    await show();
    expect(screen.getByTestId(`easy-dinner-ideas-${BUSY}`)).toBeOnTheScreen();
    expect(screen.queryByTestId('easy-dinner-ideas-2026-11-20')).toBeNull();
    // Dismissing it uses up the week's prompt.
    await fireEvent.press(screen.getByTestId(`easy-dinner-dismiss-${BUSY}`));
    expect(screen.queryByTestId(`easy-dinner-ideas-${BUSY}`)).toBeNull();
    expect(screen.queryByTestId('easy-dinner-ideas-2026-11-20')).toBeNull();
  });
});

describe('easy dinners on a Premium household (FR2-BUSY-2, FR2-BUSY-3)', () => {
  beforeEach(() => {
    mockPremium = true;
  });

  it('adds a quick recipe in one tap, with an undo bar', async () => {
    await show();
    expect(mockInsert).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByTestId(`easy-dinner-open-${BUSY}`));
    expect(await screen.findByTestId('easy-dinner-sheet')).toBeOnTheScreen();
    expect(mockTrack).toHaveBeenCalledWith('busy_day_suggestion_shown', {
      mode: 'add',
      candidates_count: 4,
    });
    expect(screen.getByTestId('easy-dinner-0')).toHaveTextContent(/Bean wraps/);
    await fireEvent.press(screen.getByTestId('easy-dinner-0'));
    await waitFor(() =>
      expect(mockInsert).toHaveBeenCalledWith(
        'plan_entries',
        expect.any(String),
        expect.objectContaining({ date: BUSY, slot: 'dinner', recipe_id: 'r-wraps' }),
      ),
    );
    expect(mockTrack).toHaveBeenCalledWith('busy_day_suggestion_applied', {
      mode: 'add',
      source: 'household',
    });
    expect(await screen.findByTestId('plan-undo')).toHaveTextContent(/Added Bean wraps/);
    await fireEvent.press(screen.getByText('Undo'));
    await waitFor(() => expect(mockRemove).toHaveBeenCalledTimes(1));
  });

  it('notes allergens on suggestions (FR2-BUSY-6)', async () => {
    mockRows.recipes = [];
    await show();
    // People load asynchronously.
    await act(async () => undefined);
    await fireEvent.press(screen.getByTestId(`easy-dinner-open-${BUSY}`));
    // The first starter, overnight oats, has milk, and Mia is allergic to it.
    expect(await screen.findByTestId('easy-dinner-0-allergen-milk')).toBeOnTheScreen();
  });

  it('hides a dismissed suggestion for that day', async () => {
    await show();
    await fireEvent.press(screen.getByTestId(`easy-dinner-dismiss-${BUSY}`));
    expect(screen.queryByTestId(`easy-dinner-open-${BUSY}`)).toBeNull();
    expect(screen.getByTestId(`busy-marker-${BUSY}`)).toBeOnTheScreen();
    expect(mockInsert).not.toHaveBeenCalled();
  });
});
