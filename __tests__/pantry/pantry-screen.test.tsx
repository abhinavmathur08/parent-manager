import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { PantryScreen, type PantryHousehold } from '@/features/pantry/pantry-screen';
import { stapleId } from '@/features/pantry/pantry';

let mockRows: Record<string, unknown[]> = {};
const mockUpdate = jest.fn(async () => ({}));
const mockInsert = jest.fn(async () => ({}));
const mockRemove = jest.fn(async () => ({}));
jest.mock('@/lib/sync', () => ({
  useSyncedRows: (table: string) => ({ rows: mockRows[table] ?? [], loading: false }),
  useSyncWriter: () => ({ insert: mockInsert, update: mockUpdate, remove: mockRemove }),
}));
jest.mock('expo-router', () => ({
  router: { canGoBack: () => true, back: jest.fn(), replace: jest.fn() },
}));

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
const WEEK = '2026-11-15';
const pantry = (id: string, ingredientId: string, over: Record<string, unknown> = {}) => ({
  ...base,
  id,
  ingredient_id: ingredientId,
  status: 'staple',
  have_week_start: null,
  ...over,
});
const household: PantryHousehold = {
  id: 'hh',
  locale: 'en-US',
  weekStart: 7,
  timezone: 'UTC',
  canEditStaples: true,
};

const show = async (over: Partial<PantryHousehold> = {}) => {
  await render(
    <SafeAreaProvider initialMetrics={metrics}>
      <PantryScreen household={{ ...household, ...over }} />
    </SafeAreaProvider>,
  );
  await act(async () => undefined);
};

beforeEach(() => {
  jest.useFakeTimers({ now: new Date('2026-11-18T12:00:00Z'), advanceTimers: true });
  mockRows = {
    pantry_items: [
      pantry('salt', 'ingredient.salt'),
      pantry('milk', 'ingredient.milk', { status: 'have', have_week_start: WEEK }),
      pantry('old', 'ingredient.eggs', { status: 'have', have_week_start: '2026-11-08' }),
    ],
  };
  mockUpdate.mockClear();
  mockInsert.mockClear();
  mockRemove.mockClear();
});
afterEach(() => jest.useRealTimers());

describe('S-22 pantry (FR-PAN-2, FR-PAN-5, FR-PAN-6)', () => {
  it('shows this week\'s "have" items and the staples by section', async () => {
    await show();
    expect(screen.getByTestId('pantry-have-0')).toHaveTextContent(/milk/i);
    expect(screen.queryByTestId('pantry-have-1')).toBeNull();
    expect(screen.getByTestId('pantry-staples')).toHaveTextContent(/salt/i);
  });

  it('undoes "have", which puts the item back on the list', async () => {
    await show();
    await fireEvent.press(screen.getByTestId('pantry-have-0-action'));
    expect(mockRemove).toHaveBeenCalledWith('pantry_items', 'milk');
  });

  it('removes a staple by hiding it', async () => {
    await show();
    const salt = screen.getAllByTestId(/^pantry-staple-.*-0-action$/)[0];
    await fireEvent.press(salt);
    expect(mockUpdate).toHaveBeenCalledWith('pantry_items', 'salt', { status: 'hidden_staple' });
  });

  it('adds a staple from the catalog search', async () => {
    await show();
    await fireEvent.press(screen.getByTestId('pantry-add'));
    await fireEvent.changeText(screen.getByTestId('pantry-add-search'), 'flour');
    await fireEvent.press(screen.getByTestId('pantry-add-suggestion-0'));
    await act(async () => undefined);
    expect(mockInsert).toHaveBeenCalledWith(
      'pantry_items',
      expect.any(String),
      expect.objectContaining({ status: 'staple' }),
    );
    const calls = mockInsert.mock.calls as unknown as [string, string, { ingredient_id: string }][];
    const [, id, values] = calls[0];
    expect(id).toBe(stapleId('hh', values.ingredient_id, 0));
  });

  it('lets caregivers undo "have" but not change staples', async () => {
    await show({ canEditStaples: false });
    expect(screen.queryByTestId('pantry-add')).toBeNull();
    expect(screen.queryAllByTestId(/^pantry-staple-.*-action$/)).toHaveLength(0);
    expect(screen.getByTestId('pantry-read-only')).toBeOnTheScreen();
    expect(screen.getByTestId('pantry-have-0-action')).toBeOnTheScreen();
  });
});
