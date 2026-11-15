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
let mockMembers: { userId: string; role: string; joinedAt: string; displayName: string | null }[] =
  [];
jest.mock('@/features/household/members', () => ({
  fetchMembers: async () => mockMembers,
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
  updated_by: null,
  shopped_at: null,
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
  mockMembers = [];
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

  it('marks "have" again after an undo, under a new row ID (G-03.2)', async () => {
    withMilk();
    // The first ID is held by the undone "have" row's tombstone.
    mockInsert.mockImplementationOnce(async () => {
      throw new Error('Row already exists: pantry_items x');
    });
    await openMilk();
    await fireEvent.press(screen.getByTestId('item-have'));
    await act(async () => undefined);
    expect(mockInsert).toHaveBeenCalledTimes(2);
    const calls = mockInsert.mock.calls as unknown as [string, string][];
    expect(calls[1][1]).not.toBe(calls[0][1]);
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

describe('"assumed at home" (FR-PAN-3, R-PAN-3)', () => {
  const planned = () => {
    mockRows = {
      grocery_lists: [list],
      grocery_items: [item('milk')],
      pantry_items: [
        {
          ...base,
          id: 's1',
          ingredient_id: 'ingredient.salt',
          status: 'staple',
          have_week_start: null,
        },
      ],
      plan_entries: [
        {
          ...base,
          id: 'e1',
          date: '2026-11-17',
          slot: 'dinner',
          position: 0,
          recipe_id: 'r1',
          free_text: null,
          servings: 2,
          leftover_of_entry_id: null,
        },
      ],
      recipes: [{ ...base, id: 'r1', title: 'Soup', servings: 2 }],
      recipe_ingredients: [
        {
          ...base,
          id: 'l1',
          recipe_id: 'r1',
          ingredient_id: 'ingredient.salt',
          quantity: 1,
          unit_id: 'unit.tsp',
          quantity_base: 4.93,
          position: 0,
        },
      ],
    };
  };

  it('shows the staples the plan uses, collapsed, with a count', async () => {
    planned();
    await show();
    expect(screen.getByTestId('list-assumed-toggle')).toHaveTextContent(/1 item/);
    expect(screen.queryByTestId('list-assumed-item-0')).toBeNull();
    await fireEvent.press(screen.getByTestId('list-assumed-toggle'));
    expect(screen.getByTestId('list-assumed-item-0')).toHaveTextContent(/salt/i);
  });

  it("puts a staple on this week's list with one tap", async () => {
    planned();
    await show();
    await fireEvent.press(screen.getByTestId('list-assumed-toggle'));
    await fireEvent.press(screen.getByTestId('list-assumed-item-0'));
    expect(mockInsert).toHaveBeenCalledWith(
      'grocery_items',
      'new-item-id',
      expect.objectContaining({ ingredient_id: 'ingredient.salt', origin: 'manual' }),
    );
  });

  it('is hidden when no staple is needed', async () => {
    mockRows = { grocery_lists: [list], grocery_items: [item('milk')] };
    await show();
    expect(screen.queryByTestId('list-assumed')).toBeNull();
  });
});

describe('shopping together (FR-LIST-8, FR-LIST-9)', () => {
  const partners = [
    { userId: 'me', role: 'parent', joinedAt: '2026-11-01', displayName: 'Sam' },
    { userId: 'alex', role: 'parent', joinedAt: '2026-11-02', displayName: 'Alex' },
  ];
  const checkedByAlex = item('milk', {
    checked: true,
    checked_by: 'alex',
    checked_at: '2026-11-18T11:00:00Z',
  });

  it('shows who checked an item off when the household has more than one member', async () => {
    mockMembers = partners;
    mockRows = { grocery_lists: [list], grocery_items: [checkedByAlex] };
    await show({ userId: 'me' });
    await fireEvent.press(screen.getByTestId('list-cart-toggle'));
    expect(screen.getByTestId('list-cart-item-0')).toHaveAccessibleName(/checked by Alex/);
  });

  it('leaves "checked by" off for a household of one', async () => {
    mockMembers = [partners[0]];
    mockRows = {
      grocery_lists: [list],
      grocery_items: [{ ...checkedByAlex, checked_by: 'me' }],
    };
    await show({ userId: 'me' });
    await fireEvent.press(screen.getByTestId('list-cart-toggle'));
    expect(screen.getByTestId('list-cart-item-0')).not.toHaveAccessibleName(/checked by/);
  });

  it('shows the banner for a minute after another member changes the list', async () => {
    mockRows = {
      grocery_lists: [list],
      grocery_items: [item('milk', { updated_by: 'alex', updated_at: '2026-11-18T11:59:50Z' })],
    };
    await show({ userId: 'me' });
    expect(screen.getByTestId('list-partner-activity')).toHaveTextContent(
      'Someone else is updating the list.',
    );
    await act(async () => {
      jest.advanceTimersByTime(60_000);
    });
    expect(screen.queryByTestId('list-partner-activity')).toBeNull();
  });

  it("doesn't show the banner for the member's own changes", async () => {
    mockRows = {
      grocery_lists: [list],
      grocery_items: [item('milk', { updated_by: 'me', updated_at: '2026-11-18T11:59:50Z' })],
    };
    await show({ userId: 'me' });
    expect(screen.queryByTestId('list-partner-activity')).toBeNull();
  });
});

describe('purchase events and finish shopping (FR-LIST-10, FR-MEM-1)', () => {
  const purchase = (itemId: string, minutesAgo: number) => ({
    ...base,
    id: `event-${itemId}`,
    list_id: LIST,
    item_id: itemId,
    ingredient_id: 'ingredient.milk',
    dimension: 'volume',
    quantity_base: 709.764,
    occurred_at: new Date(Date.parse('2026-11-18T12:00:00Z') - minutesAgo * 60_000).toISOString(),
    source: 'checked_off',
    recorded_by: 'me',
  });

  it('records a purchase when an item is checked off', async () => {
    mockRows = { grocery_lists: [list], grocery_items: [item('milk')] };
    await show();
    await fireEvent.press(screen.getByTestId('list-item-dairy-0'));
    await act(async () => undefined);
    expect(mockInsert).toHaveBeenCalledWith(
      'purchase_events',
      expect.any(String),
      expect.objectContaining({ item_id: 'milk', source: 'checked_off', quantity_base: 709.764 }),
    );
  });

  it('deletes the purchase when the item is unchecked within 10 minutes', async () => {
    mockRows = {
      grocery_lists: [list],
      grocery_items: [item('milk', { checked: true })],
      purchase_events: [purchase('milk', 2)],
    };
    await show();
    await fireEvent.press(screen.getByTestId('list-cart-toggle'));
    await fireEvent.press(screen.getByTestId('list-cart-item-0'));
    await act(async () => undefined);
    expect(mockRemove).toHaveBeenCalledWith('purchase_events', 'event-milk');
  });

  it('keeps the purchase when the item is unchecked later', async () => {
    mockRows = {
      grocery_lists: [list],
      grocery_items: [item('milk', { checked: true })],
      purchase_events: [purchase('milk', 11)],
    };
    await show();
    await fireEvent.press(screen.getByTestId('list-cart-toggle'));
    await fireEvent.press(screen.getByTestId('list-cart-item-0'));
    await act(async () => undefined);
    expect(mockRemove).not.toHaveBeenCalled();
  });

  it('asks before finishing, then records missing purchases and moves the cart to history', async () => {
    mockRows = {
      grocery_lists: [list],
      grocery_items: [
        item('milk', { checked: true }),
        item('eggs', { ingredient_id: 'ingredient.egg', checked: true }),
        item('bread', { ingredient_id: 'ingredient.bread', section_id: 'section.bakery' }),
      ],
      purchase_events: [purchase('milk', 30)],
    };
    await show();
    await fireEvent.press(screen.getByTestId('list-finish'));
    expect(screen.getByTestId('list-finish-body')).toHaveTextContent(
      "2 checked items move to this week's history.",
    );
    expect(screen.getByTestId('list-finish-staying')).toHaveTextContent(/1 unchecked item stays/);
    expect(mockUpdate).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByTestId('list-finish-confirm'));
    await act(async () => undefined);
    expect(mockInsert).toHaveBeenCalledTimes(1);
    expect(mockInsert).toHaveBeenCalledWith(
      'purchase_events',
      expect.any(String),
      expect.objectContaining({ item_id: 'eggs', source: 'confirmed' }),
    );
    expect(mockUpdate).toHaveBeenCalledWith('grocery_items', 'milk', {
      shopped_at: expect.any(String),
    });
    expect(mockUpdate).toHaveBeenCalledWith('grocery_items', 'eggs', {
      shopped_at: expect.any(String),
    });
    expect(mockUpdate).not.toHaveBeenCalledWith('grocery_items', 'bread', expect.anything());
  });

  it('leaves items already moved to history off the list', async () => {
    mockRows = {
      grocery_lists: [list],
      grocery_items: [
        item('milk', { checked: true, shopped_at: '2026-11-17T10:00:00Z' }),
        item('bread', { ingredient_id: 'ingredient.bread', section_id: 'section.bakery' }),
      ],
    };
    await show();
    expect(screen.queryByTestId('list-cart')).toBeNull();
    expect(screen.queryByTestId('list-finish')).toBeNull();
    expect(screen.getByTestId('list-item-bakery-0')).toBeOnTheScreen();
  });
});

describe('frequently bought (FR-MEM-3, FR-MEM-5)', () => {
  const bought = (id: string, daysAgo: number) => ({
    ...base,
    id,
    list_id: 'old',
    item_id: `item-${id}`,
    ingredient_id: 'ingredient.banana',
    dimension: null,
    quantity_base: null,
    occurred_at: new Date(Date.parse('2026-11-18T12:00:00Z') - daysAgo * 86_400_000).toISOString(),
    source: 'checked_off',
    recorded_by: 'me',
  });

  it('suggests items bought often, and one tap adds one', async () => {
    mockRows = {
      grocery_lists: [list],
      grocery_items: [item('milk')],
      purchase_events: [bought('e1', 1), bought('e2', 8), bought('e3', 15)],
    };
    await show();
    await fireEvent.press(screen.getByTestId('list-add'));
    expect(screen.getByTestId('add-item-frequent-0')).toHaveTextContent(/banana/i);
    await fireEvent.press(screen.getByTestId('add-item-frequent-0'));
    await act(async () => undefined);
    expect(mockInsert).toHaveBeenCalledWith(
      'grocery_items',
      'new-item-id',
      expect.objectContaining({ ingredient_id: 'ingredient.banana', origin: 'manual' }),
    );
  });

  it('hides an item with "don\'t suggest"', async () => {
    mockRows = {
      grocery_lists: [list],
      grocery_items: [item('milk')],
      purchase_events: [bought('e1', 1), bought('e2', 8)],
    };
    await show();
    await fireEvent.press(screen.getByTestId('list-add'));
    await fireEvent.press(screen.getByTestId('add-item-frequent-0-hide'));
    await act(async () => undefined);
    expect(mockInsert).toHaveBeenCalledWith('frequent_suggestion_hides', expect.any(String), {
      ingredient_id: 'ingredient.banana',
      hidden_until: expect.any(String),
    });
  });

  it('shows no frequently bought section for a household with no history', async () => {
    mockRows = { grocery_lists: [list], grocery_items: [item('milk')] };
    await show();
    await fireEvent.press(screen.getByTestId('list-add'));
    expect(screen.queryByTestId('add-item-frequent')).toBeNull();
  });
});

describe('S-23 export entry (FR-EXP-1)', () => {
  it('opens the export sheet from the list, for caregivers too', async () => {
    mockRows = { grocery_lists: [list], grocery_items: [item('milk')] };
    await show({ canRegenerate: false });
    await fireEvent.press(screen.getByTestId('list-export'));
    expect(screen.getByTestId('export-sheet')).toBeTruthy();
    expect(screen.getByTestId('export-count')).toHaveTextContent('1 item');
  });

  it('offers export on an empty list, with the actions disabled and the reason shown', async () => {
    mockRows = { grocery_lists: [list], grocery_items: [] };
    await show();
    await fireEvent.press(screen.getByTestId('list-export'));
    expect(screen.getByTestId('export-empty')).toHaveTextContent(/nothing on the list/);
    expect(screen.getByTestId('export-print')).toBeDisabled();
  });
});
