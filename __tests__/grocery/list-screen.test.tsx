import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { emitListUpdated } from '@/features/grocery/list-events';
import { ListScreen, type ListHousehold } from '@/features/grocery/list-screen';
import { weekListId } from '@/features/grocery/weekly';

let mockRows: Record<string, unknown[]> = {};
const mockUpdate = jest.fn(async () => ({}));
let mockOnline = true;
jest.mock('@/lib/sync', () => ({
  useSyncedRows: (table: string) => ({ rows: mockRows[table] ?? [], loading: false }),
  useSyncWriter: () => ({ insert: jest.fn(), update: mockUpdate, remove: jest.fn() }),
}));
jest.mock('@/hooks/use-online', () => ({ useOnline: () => mockOnline }));
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
const mockNavigate = jest.fn();
jest.mock('expo-router', () => ({
  router: { navigate: (...args: unknown[]) => mockNavigate(...args) },
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
const LIST = weekListId('hh', WEEK);
const list = { ...base, id: LIST, week_start: WEEK, is_default: true };
const item = (id: string, over: Record<string, unknown> = {}) => ({
  ...base,
  id,
  list_id: LIST,
  ingredient_id: 'ingredient.milk',
  custom_name: null,
  dimension: 'volume',
  quantity_base: 709.764,
  display_unit_id: null,
  section_id: 'section.dairy',
  origin: 'plan',
  plan_quantity_base: 709.764,
  user_modified: false,
  plan_changed: false,
  checked: false,
  checked_at: null,
  checked_by: null,
  ...over,
});
const source = (itemId: string, entryId: string) => ({
  ...base,
  id: `${itemId}-${entryId}`,
  item_id: itemId,
  plan_entry_id: entryId,
  recipe_ingredient_id: `line-${entryId}`,
  quantity_base: 1,
});

const household: ListHousehold = {
  id: 'hh',
  locale: 'en-US',
  unitSystem: 'us_customary',
  weekStart: 7,
  timezone: 'UTC',
  canRegenerate: true,
};

const show = async (over: Partial<ListHousehold> = {}) => {
  await render(
    <SafeAreaProvider initialMetrics={metrics}>
      <ListScreen household={{ ...household, ...over }} />
    </SafeAreaProvider>,
  );
  await act(async () => undefined);
};

beforeEach(() => {
  jest.useFakeTimers({ now: new Date('2026-11-18T12:00:00Z'), advanceTimers: true });
  mockRows = {};
  mockOnline = true;
  mockUpdate.mockClear();
  mockNavigate.mockClear();
});
afterEach(() => jest.useRealTimers());

describe('S-13 grocery list (FR-LIST-4, FR-LIST-5)', () => {
  it('shows items by section with quantities in household units, source hints and allergen markers', async () => {
    mockRows = {
      grocery_lists: [list],
      grocery_items: [
        item('milk'),
        item('onion', {
          ingredient_id: 'ingredient.onion',
          dimension: 'count',
          quantity_base: 2.25,
          section_id: 'section.produce',
        }),
      ],
      grocery_item_sources: [source('milk', 'e1'), source('milk', 'e2')],
    };
    await show();
    expect(screen.getByTestId('list-section-produce')).toHaveTextContent(/onions/);
    expect(screen.getByTestId('list-item-produce-0')).toHaveTextContent(/3/);
    expect(screen.getByTestId('list-item-dairy-0')).toHaveTextContent('milk3 cups · for 2 meals');
    expect(screen.getByTestId('list-item-dairy-0-allergen-milk-message')).toHaveTextContent(
      'Contains Milk. Mia is allergic.',
    );
    expect(screen.queryByTestId('list-item-produce-0-allergen-milk')).toBeNull();
  });

  it('shows the same stored quantity in metric for a metric household', async () => {
    mockRows = { grocery_lists: [list], grocery_items: [item('milk')] };
    await show({ unitSystem: 'metric', locale: 'en-GB' });
    expect(screen.getByTestId('list-item-dairy-0')).toHaveTextContent(/700 ml/);
  });

  it('checks an item off with one tap anywhere on the row (FR-LIST-8)', async () => {
    mockRows = { grocery_lists: [list], grocery_items: [item('milk')] };
    await show();
    await fireEvent.press(screen.getByTestId('list-item-dairy-0'));
    expect(mockUpdate).toHaveBeenCalledWith('grocery_items', 'milk', { checked: true });
  });

  it('keeps checked items in a collapsed "in the cart" group', async () => {
    mockRows = {
      grocery_lists: [list],
      grocery_items: [
        item('milk', { checked: true }),
        item('bread', {
          custom_name: 'Bread',
          ingredient_id: null,
          origin: 'manual',
          dimension: null,
          quantity_base: null,
          section_id: 'section.bakery',
        }),
      ],
    };
    await show();
    expect(screen.getByTestId('list-cart-toggle')).toHaveTextContent(/In the cart.*1 item/);
    expect(screen.queryByTestId('list-item-dairy-0')).toBeNull();
    expect(screen.getByTestId('list-item-bakery-0')).toHaveTextContent('BreadAdded');
    await fireEvent.press(screen.getByTestId('list-cart-toggle'));
    await fireEvent.press(screen.getByTestId('list-cart-item-0'));
    expect(mockUpdate).toHaveBeenCalledWith('grocery_items', 'milk', { checked: false });
  });

  it('says all done when everything is in the cart', async () => {
    mockRows = { grocery_lists: [list], grocery_items: [item('milk', { checked: true })] };
    await show();
    expect(screen.getByTestId('list-all-done')).toBeOnTheScreen();
  });

  it('shows the empty state with "plan meals" when there is nothing to buy', async () => {
    await show();
    await fireEvent.press(screen.getByTestId('list-empty-action'));
    expect(mockNavigate).toHaveBeenCalledWith('/plan');
    expect(screen.queryByTestId('list-regenerate')).toBeNull();
  });

  it('shows the offline banner offline (FR-LIST-11)', async () => {
    mockOnline = false;
    mockRows = { grocery_lists: [list], grocery_items: [item('milk')] };
    await show();
    expect(screen.getByTestId('list-offline')).toBeOnTheScreen();
  });

  it('summarizes what a plan change did to the open list (FR-LIST-3)', async () => {
    mockRows = { grocery_lists: [list], grocery_items: [item('milk')] };
    await show();
    await act(async () =>
      emitListUpdated({
        listId: LIST,
        summary: { added: 2, changed: 1, removed: 0 },
        regenerated: false,
      }),
    );
    expect(screen.getByTestId('list-updated')).toHaveTextContent(
      'List updated: 2 added and 1 changed.',
    );
    await act(async () =>
      emitListUpdated({
        listId: 'another-list',
        summary: { added: 5, changed: 0, removed: 0 },
        regenerated: false,
      }),
    );
    expect(screen.getByTestId('list-updated')).toHaveTextContent(/2 added/);
  });

  it('offers regenerate to parents but not caregivers', async () => {
    mockRows = { grocery_lists: [list], grocery_items: [item('milk')] };
    await show();
    expect(screen.getByTestId('list-regenerate')).toBeOnTheScreen();
  });

  it('hides regenerate from caregivers (spec section 2.2)', async () => {
    mockRows = { grocery_lists: [list], grocery_items: [item('milk')] };
    await show({ canRegenerate: false });
    expect(screen.queryByTestId('list-regenerate')).toBeNull();
  });

  it("only shows this week's list", async () => {
    mockRows = {
      grocery_lists: [list, { ...list, id: 'old', week_start: '2026-11-08' }],
      grocery_items: [item('old-milk', { list_id: 'old' })],
    };
    await show();
    expect(screen.getByTestId('list-empty')).toBeOnTheScreen();
  });
});
