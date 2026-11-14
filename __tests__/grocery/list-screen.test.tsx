import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { emitListUpdated } from '@/features/grocery/list-events';
import { ListScreen, type ListHousehold } from '@/features/grocery/list-screen';
import { weekListId } from '@/features/grocery/weekly';

let mockRows: Record<string, unknown[]> = {};
const mockUpdate = jest.fn(async () => ({}));
const mockInsert = jest.fn(async () => ({}));
const mockRemove = jest.fn(async () => ({}));
let mockOnline = true;
jest.mock('@/lib/sync', () => ({
  useSyncedRows: (table: string) => ({ rows: mockRows[table] ?? [], loading: false }),
  useSyncWriter: () => ({ insert: mockInsert, update: mockUpdate, remove: mockRemove }),
}));
jest.mock('expo-crypto', () => ({ randomUUID: () => 'new-item-id' }));
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
  region: 'US',
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
  mockInsert.mockClear();
  mockRemove.mockClear();
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

describe('S-14 add an item (FR-LIST-6)', () => {
  const open = async () => {
    await fireEvent.press(screen.getByTestId('list-add'));
  };

  it('adds a catalog suggestion as a manual item in its section', async () => {
    mockRows = { grocery_lists: [list] };
    await show();
    await fireEvent.press(screen.getByTestId('list-empty-add'));
    await fireEvent.changeText(screen.getByTestId('add-item-search'), 'diap');
    expect(screen.getByTestId('add-item-suggestion-0')).toHaveTextContent(/diaper/);
    await fireEvent.press(screen.getByTestId('add-item-suggestion-0'));
    await fireEvent.press(screen.getByTestId('add-item-done'));
    expect(mockInsert).toHaveBeenCalledWith(
      'grocery_items',
      'new-item-id',
      expect.objectContaining({
        list_id: LIST,
        ingredient_id: 'ingredient.diapers',
        section_id: 'section.baby',
        origin: 'manual',
      }),
    );
    expect(screen.getByTestId('list-updated')).toHaveTextContent(/diapers? added/);
  });

  it('merges an amount into the generated item and marks it user-modified', async () => {
    mockRows = { grocery_lists: [list], grocery_items: [item('milk')] };
    await show();
    await open();
    await fireEvent.changeText(screen.getByTestId('add-item-search'), 'milk');
    await fireEvent.press(screen.getByTestId('add-item-suggestion-0'));
    await fireEvent.changeText(screen.getByTestId('add-item-quantity'), '1');
    await fireEvent.press(screen.getByTestId('add-item-unit-cup_us'));
    await fireEvent.press(screen.getByTestId('add-item-done'));
    expect(mockInsert).not.toHaveBeenCalled();
    expect(mockUpdate).toHaveBeenCalledWith('grocery_items', 'milk', {
      quantity_base: 709.764 + 236.588,
      user_modified: true,
    });
    expect(screen.getByTestId('list-updated')).toHaveTextContent('Added to milk on your list.');
  });

  it('adds text as typed in the chosen section', async () => {
    mockRows = { grocery_lists: [list] };
    await show();
    await open();
    await fireEvent.changeText(screen.getByTestId('add-item-search'), 'Birthday card');
    await fireEvent.press(screen.getByTestId('add-item-as-typed'));
    await fireEvent.press(screen.getByTestId('add-item-section-household'));
    await fireEvent.press(screen.getByTestId('add-item-done'));
    expect(mockInsert).toHaveBeenCalledWith(
      'grocery_items',
      'new-item-id',
      expect.objectContaining({
        ingredient_id: null,
        custom_name: 'Birthday card',
        section_id: 'section.household',
      }),
    );
  });

  it('refuses an amount that is not a number', async () => {
    mockRows = { grocery_lists: [list] };
    await show();
    await open();
    await fireEvent.changeText(screen.getByTestId('add-item-search'), 'Wipes');
    await fireEvent.press(screen.getByTestId('add-item-as-typed'));
    await fireEvent.changeText(screen.getByTestId('add-item-quantity'), 'lots');
    await fireEvent.press(screen.getByTestId('add-item-done'));
    expect(mockInsert).not.toHaveBeenCalled();
    expect(screen.getByText('Enter a number, like 2 or 1 1/2.')).toBeOnTheScreen();
  });

  it('waits for the week list before offering to add', async () => {
    await show();
    expect(screen.queryByTestId('list-add')).toBeNull();
    expect(screen.queryByTestId('list-empty-add')).toBeNull();
  });
});

describe('S-15 item detail (FR-LIST-7, FR-LIST-12)', () => {
  const recipe = { ...base, id: 'soup', title: 'Lentil soup', servings: 4 };
  const entry = (id: string, date: string) => ({
    ...base,
    id,
    date,
    slot: 'dinner',
    position: 0,
    recipe_id: 'soup',
    free_text: null,
    servings: 4,
    leftover_of_entry_id: null,
  });
  const withMilk = () => {
    mockRows = {
      grocery_lists: [list],
      grocery_items: [item('milk')],
      grocery_item_sources: [source('milk', 'e1'), source('milk', 'e2')],
      plan_entries: [entry('e1', '2026-11-16'), entry('e2', '2026-11-18')],
      recipes: [recipe],
    };
  };
  const openMilk = async () => {
    await show();
    await fireEvent.press(screen.getByTestId('list-item-dairy-0-details'));
  };

  it('lists the planned meals the item comes from', async () => {
    withMilk();
    await openMilk();
    expect(screen.getByTestId('item-source-0')).toHaveTextContent(/Monday, Dinner: Lentil soup/);
    expect(screen.getByTestId('item-source-1')).toHaveTextContent(/Wednesday, Dinner: Lentil soup/);
  });

  it('saves a new quantity as a user-modified item', async () => {
    withMilk();
    await openMilk();
    expect(screen.getByTestId('item-quantity').props.value).toBe('3');
    await fireEvent.changeText(screen.getByTestId('item-quantity'), '4');
    await fireEvent.press(screen.getByTestId('item-save'));
    expect(mockUpdate).toHaveBeenCalledWith('grocery_items', 'milk', {
      quantity_base: 4 * 236.588,
      dimension: 'volume',
      display_unit_id: 'unit.cup_us',
      user_modified: true,
      plan_changed: false,
    });
    expect(screen.getByTestId('list-updated')).toHaveTextContent('milk updated.');
  });

  it('renames an item', async () => {
    withMilk();
    await openMilk();
    await fireEvent.changeText(screen.getByTestId('item-name'), 'Oat milk');
    await fireEvent.press(screen.getByTestId('item-save'));
    expect(mockUpdate).toHaveBeenCalledWith('grocery_items', 'milk', {
      custom_name: 'Oat milk',
      user_modified: true,
      plan_changed: false,
    });
  });

  it('marks "I already have this" for the week and takes the item off the list (FR-PAN-4)', async () => {
    withMilk();
    await openMilk();
    await fireEvent.press(screen.getByTestId('item-have'));
    expect(mockInsert).toHaveBeenCalledWith('pantry_items', expect.any(String), {
      ingredient_id: 'ingredient.milk',
      status: 'have',
      have_week_start: WEEK,
    });
    expect(mockRemove).toHaveBeenCalledWith('grocery_items', 'milk');
  });

  it('holds a delete behind the undo bar, and undo keeps the item', async () => {
    withMilk();
    await openMilk();
    await fireEvent.press(screen.getByTestId('item-delete'));
    expect(screen.queryByTestId('list-item-dairy-0')).toBeNull();
    expect(screen.getByTestId('list-undo')).toHaveTextContent(/milk deleted/);
    expect(mockRemove).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByTestId('list-undo-action'));
    expect(screen.getByTestId('list-item-dairy-0')).toBeOnTheScreen();
    expect(mockRemove).not.toHaveBeenCalled();
  });

  it('deletes the item once the undo bar goes', async () => {
    withMilk();
    await openMilk();
    await fireEvent.press(screen.getByTestId('item-delete'));
    await act(async () => {
      jest.advanceTimersByTime(6000);
    });
    expect(mockRemove).toHaveBeenCalledWith('grocery_items', 'milk');
  });

  it('says a manual item was added by hand, and offers no "have" for free text', async () => {
    mockRows = {
      grocery_lists: [list],
      grocery_items: [
        item('card', {
          ingredient_id: null,
          custom_name: 'Card',
          origin: 'manual',
          dimension: null,
          quantity_base: null,
        }),
      ],
    };
    await show();
    await fireEvent.press(screen.getByTestId('list-item-dairy-0-details'));
    expect(screen.getByTestId('item-no-sources')).toHaveTextContent('Added to the list by hand.');
    expect(screen.queryByTestId('item-have')).toBeNull();
  });
});
