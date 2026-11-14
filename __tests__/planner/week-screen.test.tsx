import { fireEvent, render, screen } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { PlanWeekScreen, type PlanWeekActions } from '@/features/planner/week-screen';

let mockRows: Record<string, unknown[]> = {};
const mockPeople = jest.fn();

const mockInsert = jest.fn(async () => ({}));
jest.mock('@/lib/sync', () => ({
  useSyncedRows: (table: string) => ({ rows: mockRows[table] ?? [], loading: false }),
  useSyncWriter: () => ({ insert: mockInsert, update: jest.fn(), remove: jest.fn() }),
}));
let mockUuid = 0;
jest.mock('expo-crypto', () => ({ randomUUID: () => `uuid-${++mockUuid}` }));
jest.mock('@/features/people/data', () => ({ fetchPeople: () => mockPeople() }));

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
const entry = (id: string, date: string, slot: string, over: Record<string, unknown> = {}) => ({
  ...base,
  id,
  date,
  slot,
  position: 0,
  recipe_id: null,
  free_text: null,
  servings: 2,
  leftover_of_entry_id: null,
  ...over,
});

const household = { id: 'hh', locale: 'en-US' as const, weekStart: 7 as const, timezone: 'UTC' };

const show = (canWrite = true, actions: PlanWeekActions = {}) =>
  render(
    <SafeAreaProvider initialMetrics={metrics}>
      <PlanWeekScreen household={household} canWrite={canWrite} actions={actions} />
    </SafeAreaProvider>,
  );

beforeEach(() => {
  mockInsert.mockClear();
  mockUuid = 0;
  jest.useFakeTimers({ now: new Date('2026-11-18T12:00:00Z'), advanceTimers: true });
  mockRows = {};
  mockPeople.mockResolvedValue([
    {
      id: 'p1',
      displayName: 'Mia',
      ageBand: 'toddler',
      dueMonth: null,
      allergies: ['allergen.milk'],
      diets: [],
    },
  ]);
});
afterEach(() => jest.useRealTimers());

describe('S-10 week view (FR-PLAN-1, FR-PLAN-2)', () => {
  it('shows 7 days from the week start, with today highlighted', async () => {
    await show();
    expect(screen.getByTestId('plan-range')).toHaveTextContent('Nov 15 – Nov 21');
    expect(screen.getByTestId('plan-day-2026-11-15')).toHaveTextContent(/Sunday/);
    expect(screen.getByTestId('plan-day-2026-11-21')).toHaveTextContent(/Saturday/);
    expect(screen.getByTestId('plan-day-2026-11-18')).toHaveTextContent(/Today/);
    expect(screen.queryByTestId('plan-today')).toBeNull();
  });

  it('moves between weeks, and today comes back', async () => {
    await show();
    await fireEvent.press(screen.getByTestId('plan-next'));
    expect(screen.getByTestId('plan-range')).toHaveTextContent('Nov 22 – Nov 28');
    await fireEvent.press(screen.getByTestId('plan-previous'));
    await fireEvent.press(screen.getByTestId('plan-previous'));
    expect(screen.getByTestId('plan-range')).toHaveTextContent('Nov 8 – Nov 14');
    await fireEvent.press(screen.getByTestId('plan-today'));
    expect(screen.getByTestId('plan-range')).toHaveTextContent('Nov 15 – Nov 21');
  });

  it('offers add, and copy last week when last week had entries, on an empty week', async () => {
    mockRows = { plan_entries: [entry('old', '2026-11-10', 'dinner', { free_text: 'Soup' })] };
    const onAdd = jest.fn();
    const onCopyLastWeek = jest.fn();
    await show(true, { onAdd, onCopyLastWeek });
    expect(screen.getByTestId('plan-empty')).toBeOnTheScreen();
    await fireEvent.press(screen.getByTestId('plan-empty-state-action'));
    expect(onAdd).toHaveBeenCalledWith('2026-11-18', 'dinner');
    await fireEvent.press(screen.getByTestId('plan-copy-last-week'));
    expect(onCopyLastWeek).toHaveBeenCalledWith('2026-11-15');
    // Empty slots are compact chips that open the add sheet.
    await fireEvent.press(screen.getByTestId('plan-add-4-lunch'));
    expect(onAdd).toHaveBeenCalledWith('2026-11-19', 'lunch');
  });

  it("doesn't offer copy when last week was empty", async () => {
    await show(true, { onAdd: jest.fn(), onCopyLastWeek: jest.fn() });
    expect(screen.queryByTestId('plan-copy-last-week')).toBeNull();
  });

  it("doesn't offer caregivers anything that writes", async () => {
    mockRows = { plan_entries: [entry('old', '2026-11-10', 'dinner', { free_text: 'Soup' })] };
    await show(false, { onAdd: jest.fn(), onCopyLastWeek: jest.fn() });
    expect(screen.queryByTestId('plan-copy-last-week')).toBeNull();
    expect(screen.queryByTestId('plan-empty-state-action')).toBeNull();
    expect(screen.queryByTestId('plan-add-4-lunch')).toBeNull();
  });

  it('shows entries in their slots, with an allergen marker for someone eating (FR-PLAN-11)', async () => {
    mockRows = {
      recipes: [{ ...base, id: 'r1', title: 'Mac and cheese', servings: 4, tags: [] }],
      recipe_ingredients: [
        { ...base, id: 'l1', recipe_id: 'r1', position: 0, ingredient_id: 'ingredient.milk' },
      ],
      plan_entries: [
        entry('e1', '2026-11-16', 'dinner', { recipe_id: 'r1', servings: 2.5 }),
        entry('e2', '2026-11-16', 'dinner', { free_text: 'Salad', position: 1 }),
        entry('e3', '2026-11-17', 'lunch', { recipe_id: 'gone' }),
      ],
    };
    await show();
    expect(screen.queryByTestId('plan-empty')).toBeNull();
    const dinner = screen.getByTestId('plan-slot-1-dinner');
    expect(dinner).toHaveTextContent(/Mac and cheese.*2.5 servings.*Salad/);
    expect(await screen.findByTestId('plan-entry-e1-allergen-milk')).toHaveTextContent(/Mia/);
    expect(screen.queryByTestId('plan-entry-e2-allergen-milk')).toBeNull();
    expect(screen.getByTestId('plan-entry-e3')).toHaveTextContent(/Deleted recipe/);
  });
});

const insertsInto = (table: string) =>
  (mockInsert.mock.calls as unknown as [string, string, Record<string, unknown>][]).filter(
    ([name]) => name === table,
  );

describe('S-11 add to a slot (FR-PLAN-3 to FR-PLAN-5)', () => {
  it('adds a starter recipe in one tap after search, saving a household copy first', async () => {
    await show();
    await fireEvent.press(screen.getByTestId('plan-add-1-dinner'));
    expect(screen.getByTestId('add-sheet')).toBeOnTheScreen();
    await fireEvent.changeText(screen.getByTestId('add-search'), 'lentil');
    await fireEvent.press(screen.getByTestId('add-starter-0'));

    const [[, recipeId, recipe]] = insertsInto('recipes');
    expect(recipe).toMatchObject({
      source_type: 'library',
      library_recipe_id: 'starter.lentil_tomato_soup',
    });
    const [[, , values]] = insertsInto('plan_entries');
    // One toddler at ½, rounded up to the nearest ½ (R-SERV-1).
    expect(values).toEqual({
      date: '2026-11-16',
      slot: 'dinner',
      position: 0,
      recipe_id: recipeId,
      free_text: null,
      servings: 0.5,
      leftover_of_entry_id: null,
    });
  });

  it('reuses an existing copy of a starter', async () => {
    mockRows = {
      recipes: [
        {
          ...base,
          id: 'copy',
          title: 'Lentil and tomato soup',
          servings: 4,
          tags: [],
          library_recipe_id: 'starter.lentil_tomato_soup',
        },
      ],
    };
    await show();
    await fireEvent.press(screen.getByTestId('plan-add-1-dinner'));
    await fireEvent.changeText(screen.getByTestId('add-search'), 'lentil');
    await fireEvent.press(screen.getByTestId('add-starter-0'));
    expect(insertsInto('recipes')).toHaveLength(0);
    expect(insertsInto('plan_entries')[0][2]).toMatchObject({ recipe_id: 'copy' });
  });

  it('adds free text with the chosen servings', async () => {
    await show();
    await fireEvent.press(screen.getByTestId('plan-add-5-dinner'));
    await fireEvent.press(screen.getByTestId('add-servings-increase'));
    await fireEvent.changeText(screen.getByTestId('add-search'), 'Takeout');
    await fireEvent.press(screen.getByTestId('add-free-text'));
    expect(insertsInto('plan_entries')[0][2]).toMatchObject({
      date: '2026-11-20',
      recipe_id: null,
      free_text: 'Takeout',
      servings: 1,
    });
  });

  it("offers recently planned recipes, and adds after the slot's last entry (FR-PLAN-4)", async () => {
    mockRows = {
      recipes: [
        {
          ...base,
          id: 'r1',
          title: 'Chili',
          servings: 4,
          tags: [],
          updated_at: '2026-11-01T00:00:00Z',
        },
        {
          ...base,
          id: 'r2',
          title: 'Pasta',
          servings: 4,
          tags: [],
          updated_at: '2026-11-10T00:00:00Z',
        },
      ],
      plan_entries: [
        entry('e1', '2026-11-16', 'dinner', {
          recipe_id: 'r1',
          updated_at: '2026-11-12T00:00:00Z',
        }),
      ],
    };
    await show();
    await fireEvent.press(screen.getByTestId('plan-add-1-dinner'));
    expect(screen.getByTestId('add-recipe-0')).toHaveTextContent('Chili');
    expect(screen.getByTestId('add-recipe-1')).toHaveTextContent('Pasta');
    await fireEvent.press(screen.getByTestId('add-recipe-1'));
    expect(insertsInto('plan_entries')[0][2]).toMatchObject({ recipe_id: 'r2', position: 1 });
  });
});
