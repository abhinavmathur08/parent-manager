import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { PlanWeekScreen, type PlanWeekActions } from '@/features/planner/week-screen';

let mockRows: Record<string, unknown[]> = {};
const mockPeople = jest.fn();

const mockInsert = jest.fn(async () => ({}));
const mockUpdate = jest.fn(async () => ({}));
const mockRemove = jest.fn(async () => ({}));
jest.mock('@/lib/sync', () => ({
  useSyncedRows: (table: string) => ({ rows: mockRows[table] ?? [], loading: false }),
  useSyncWriter: () => ({ insert: mockInsert, update: mockUpdate, remove: mockRemove }),
}));
let mockUuid = 0;
jest.mock('expo-crypto', () => ({
  randomUUID: () => `00000000-0000-4000-8000-${String(++mockUuid).padStart(12, '0')}`,
}));
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
  mockUpdate.mockClear();
  mockRemove.mockClear();
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

const PERSON = 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d';

describe('entry actions (FR-PLAN-7)', () => {
  const planned = () => ({
    plan_entries: [entry('e1', '2026-11-16', 'dinner', { free_text: 'Soup' })],
    plan_entry_portions: [
      { ...base, id: 'x', entry_id: 'e1', person_id: PERSON, portions: 2, variant: 'standard' },
    ],
  });

  it('moves an entry to another day and slot', async () => {
    mockRows = planned();
    await show();
    await fireEvent(screen.getByTestId('plan-entry-e1'), 'longPress');
    await fireEvent.press(screen.getByTestId('entry-actions-day-3'));
    await fireEvent.press(screen.getByTestId('entry-actions-slot-lunch'));
    await fireEvent.press(screen.getByTestId('entry-actions-move'));
    expect(mockUpdate).toHaveBeenCalledWith('plan_entries', 'e1', {
      date: '2026-11-18',
      slot: 'lunch',
      position: 0,
    });
  });

  it('duplicates an entry with its portions', async () => {
    mockRows = planned();
    await show();
    await fireEvent(screen.getByTestId('plan-entry-e1'), 'longPress');
    await fireEvent.press(screen.getByTestId('entry-actions-duplicate'));
    const [[, id, values]] = insertsInto('plan_entries');
    // Same day and slot by default, after the original.
    expect(values).toMatchObject({
      date: '2026-11-16',
      slot: 'dinner',
      position: 1,
      free_text: 'Soup',
    });
    expect(insertsInto('plan_entry_portions')[0][2]).toEqual({
      entry_id: id,
      person_id: PERSON,
      portions: 2,
      variant: 'standard',
    });
  });

  it('hides a removed entry at once and removes it after 5 seconds', async () => {
    mockRows = planned();
    await show();
    await fireEvent(screen.getByTestId('plan-entry-e1'), 'longPress');
    await fireEvent.press(screen.getByTestId('entry-actions-remove'));
    expect(screen.queryByTestId('plan-entry-e1')).toBeNull();
    expect(screen.getByTestId('plan-undo')).toHaveTextContent(/Removed Soup/);
    expect(mockRemove).not.toHaveBeenCalled();
    await act(async () => {
      jest.advanceTimersByTime(5000);
    });
    expect(mockRemove).toHaveBeenCalledWith('plan_entries', 'e1');
  });

  it('brings a removed entry back with undo, and never removes it', async () => {
    mockRows = planned();
    await show();
    await fireEvent(screen.getByTestId('plan-entry-e1'), 'longPress');
    await fireEvent.press(screen.getByTestId('entry-actions-remove'));
    await fireEvent.press(screen.getByTestId('plan-undo-action'));
    expect(screen.getByTestId('plan-entry-e1')).toBeOnTheScreen();
    await act(async () => {
      jest.advanceTimersByTime(6000);
    });
    expect(mockRemove).not.toHaveBeenCalled();
  });

  it("doesn't offer caregivers entry actions", async () => {
    mockRows = planned();
    await show(false);
    await fireEvent(screen.getByTestId('plan-entry-e1'), 'longPress');
    expect(screen.queryByTestId('entry-actions-move')).toBeNull();
  });
});

describe('S-12 portions and baby plates (FR-PLAN-5, FR-PLAN-6)', () => {
  const BABY = 'b1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d';
  const ADULT = 'c1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d';
  const ENTRY = 'd1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d';
  const updatesTo = (table: string) =>
    (mockUpdate.mock.calls as unknown as [string, string, Record<string, unknown>][]).filter(
      ([name]) => name === table,
    );

  beforeEach(() => {
    mockPeople.mockResolvedValue([
      { id: ADULT, displayName: 'Sam', ageBand: 'adult', dueMonth: null, allergies: [], diets: [] },
      {
        id: BABY,
        displayName: 'Ivy',
        ageBand: 'infant_6_12m',
        dueMonth: null,
        allergies: [],
        diets: [],
      },
    ]);
    mockRows = {
      plan_entries: [entry(ENTRY, '2026-11-16', 'dinner', { recipe_id: 'r1', servings: 1.5 })],
    };
  });

  it('starts on the R-SERV-1 defaults, and the baby plate is labelled on the entry', async () => {
    await show();
    expect(await screen.findByTestId(`plan-entry-${ENTRY}-baby-plate`)).toHaveTextContent(
      'Baby plate',
    );
    await fireEvent.press(screen.getByTestId(`plan-entry-${ENTRY}`));
    expect(screen.getByTestId('entry-person-0-portion-2').props.accessibilityState).toMatchObject({
      checked: true,
    });
    expect(screen.getByTestId('entry-person-1-baby-plate').props.accessibilityState).toMatchObject({
      checked: true,
    });
    // Only the 6 to 12 month band gets a baby plate.
    expect(screen.queryByTestId('entry-person-0-baby-plate')).toBeNull();
  });

  it('saves portions for everyone and makes servings their sum', async () => {
    await show();
    await screen.findByTestId(`plan-entry-${ENTRY}-baby-plate`);
    await fireEvent.press(screen.getByTestId(`plan-entry-${ENTRY}`));
    await fireEvent.press(screen.getByTestId('entry-person-0-portion-4'));
    expect(screen.getByTestId('entry-servings')).toHaveTextContent('2.25');
    await fireEvent.press(screen.getByTestId('entry-save'));
    const rows = insertsInto('plan_entry_portions').map(([, , values]) => values);
    expect(rows).toEqual([
      { entry_id: ENTRY, person_id: ADULT, portions: 2, variant: 'standard' },
      { entry_id: ENTRY, person_id: BABY, portions: 0.25, variant: 'baby_plate' },
    ]);
    expect(updatesTo('plan_entries')).toEqual([['plan_entries', ENTRY, { servings: 2.25 }]]);
  });

  it("won't save when nobody eats", async () => {
    await show();
    await screen.findByTestId(`plan-entry-${ENTRY}-baby-plate`);
    await fireEvent.press(screen.getByTestId(`plan-entry-${ENTRY}`));
    await fireEvent.press(screen.getByTestId('entry-person-0-portion-0'));
    await fireEvent.press(screen.getByTestId('entry-person-1-portion-0'));
    expect(screen.getByTestId('entry-nobody-eats')).toBeOnTheScreen();
    expect(screen.getByTestId('entry-save')).toBeDisabled();
  });

  it('sets servings directly without touching portions', async () => {
    await show();
    await fireEvent.press(screen.getByTestId(`plan-entry-${ENTRY}`));
    await fireEvent.press(screen.getByTestId('entry-servings-increase'));
    await fireEvent.press(screen.getByTestId('entry-save'));
    expect(insertsInto('plan_entry_portions')).toHaveLength(0);
    expect(updatesTo('plan_entries')).toEqual([['plan_entries', ENTRY, { servings: 2 }]]);
  });
});

describe('copy last week (FR-PLAN-9)', () => {
  const lastWeek = [
    entry('a', '2026-11-09', 'dinner', { free_text: 'Chili' }),
    entry('b', '2026-11-14', 'lunch', { free_text: 'Soup' }),
  ];

  it('copies into an empty week at once, on the same weekdays and slots', async () => {
    mockRows = { plan_entries: lastWeek };
    await show();
    await fireEvent.press(screen.getByTestId('plan-copy-last-week'));
    expect(insertsInto('plan_entries').map(([, , v]) => [v.date, v.slot, v.free_text])).toEqual([
      ['2026-11-16', 'dinner', 'Chili'],
      ['2026-11-21', 'lunch', 'Soup'],
    ]);
    expect(screen.queryByTestId('copy-week-sheet-title')).toBeNull();
  });

  it('asks add or replace when this week has entries, and adds alongside', async () => {
    mockRows = {
      plan_entries: [...lastWeek, entry('mine', '2026-11-16', 'dinner', { free_text: 'Pizza' })],
    };
    await show();
    await fireEvent.press(screen.getByTestId('plan-copy-last-week'));
    await fireEvent.press(screen.getByTestId('copy-week-add'));
    expect(insertsInto('plan_entries')[0][2]).toMatchObject({ date: '2026-11-16', position: 1 });
    expect(screen.getByTestId('plan-entry-mine')).toBeOnTheScreen();
  });

  it('replaces this week, with undo that removes the copies instead', async () => {
    mockRows = {
      plan_entries: [...lastWeek, entry('mine', '2026-11-16', 'dinner', { free_text: 'Pizza' })],
    };
    await show();
    await fireEvent.press(screen.getByTestId('plan-copy-last-week'));
    await fireEvent.press(screen.getByTestId('copy-week-replace'));
    expect(insertsInto('plan_entries')).toHaveLength(2);
    expect(screen.queryByTestId('plan-entry-mine')).toBeNull();
    await fireEvent.press(screen.getByTestId('plan-undo-action'));
    await act(async () => {
      jest.advanceTimersByTime(6000);
    });
    const copies = insertsInto('plan_entries').map(([, id]) => id);
    expect(mockRemove.mock.calls).toEqual(copies.map((id) => ['plan_entries', id]));
    expect(screen.getByTestId('plan-entry-mine')).toBeOnTheScreen();
  });

  it('removes the replaced entries once the undo bar goes', async () => {
    mockRows = {
      plan_entries: [...lastWeek, entry('mine', '2026-11-16', 'dinner', { free_text: 'Pizza' })],
    };
    await show();
    await fireEvent.press(screen.getByTestId('plan-copy-last-week'));
    await fireEvent.press(screen.getByTestId('copy-week-replace'));
    await act(async () => {
      jest.advanceTimersByTime(5000);
    });
    expect(mockRemove.mock.calls).toEqual([['plan_entries', 'mine']]);
  });
});

describe('week progress (FR-PLAN-12)', () => {
  it('shows dinners planned, and the text matches the bar', async () => {
    mockRows = {
      plan_entries: [
        entry('a', '2026-11-15', 'dinner', { free_text: 'A' }),
        entry('b', '2026-11-16', 'dinner', { free_text: 'B' }),
        entry('b2', '2026-11-16', 'dinner', { free_text: 'Side', position: 1 }),
        entry('c', '2026-11-17', 'lunch', { free_text: 'C' }),
      ],
    };
    await show();
    const bar = screen.getByTestId('plan-progress');
    expect(bar).toHaveTextContent('2 of 7 dinners planned');
    expect(bar.props.accessibilityLabel).toBe('2 of 7 dinners planned');
    expect(screen.getAllByTestId(/^plan-progress-segment-/)).toHaveLength(7);
  });

  it('has no progress bar on an empty week', async () => {
    await show();
    expect(screen.queryByTestId('plan-progress')).toBeNull();
  });
});
