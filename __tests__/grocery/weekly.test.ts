import { buildIngredientFacts } from '@/features/grocery/facts';
import type {
  GroceryItemRow,
  GroceryItemSourceRow,
  GroceryListRow,
} from '@/features/grocery/tables';
import { weekListId, weeklyListUpdates, type WeeklyInput } from '@/features/grocery/weekly';
import { weekPantry, type PantryItemRow } from '@/features/pantry/tables';
import type { SaveOp } from '@/features/recipes/draft';

const HH = '11111111-2222-4333-8444-555555555555';
// Sunday-start weeks: 2026-11-15 is a Sunday, today is Wednesday 2026-11-18.
const TODAY = '2026-11-18';
const THIS_WEEK = '2026-11-15';
const NEXT_WEEK = '2026-11-22';

const base = { household_id: HH, version: 1, created_at: null, updated_at: null, deleted_at: null };
const entry = (id: string, date: string, recipeId: string | null = 'r1') => ({
  id,
  date,
  recipe_id: recipeId,
  servings: 4,
  leftover_of_entry_id: null,
  deleted_at: null,
});
const recipes = [{ id: 'r1', servings: 4, deleted_at: null }];
const lines = [
  {
    id: 'l1',
    recipe_id: 'r1',
    ingredient_id: 'ingredient.milk',
    quantity: 1,
    unit_id: 'unit.cup_us',
    quantity_base: 236.588,
    deleted_at: null,
  },
  {
    id: 'l2',
    recipe_id: 'r1',
    ingredient_id: 'ingredient.salt',
    quantity: 1,
    unit_id: 'unit.tsp_us',
    quantity_base: 4.93,
    deleted_at: null,
  },
];
const pantryRow = (over: Partial<PantryItemRow>): PantryItemRow => ({
  ...base,
  id: 'p1',
  ingredient_id: 'ingredient.salt',
  status: 'staple',
  have_week_start: null,
  ...over,
});

const input = (over: Partial<WeeklyInput>): WeeklyInput => ({
  householdId: HH,
  today: TODAY,
  weekStartDay: 7,
  entries: [],
  recipes,
  lines,
  ingredients: buildIngredientFacts([]),
  pantry: [pantryRow({})],
  lists: [],
  items: [],
  sources: [],
  openWeeks: [],
  ...over,
});

type State = { lists: GroceryListRow[]; items: GroceryItemRow[]; sources: GroceryItemSourceRow[] };

function apply(state: State, ops: readonly SaveOp[]): State {
  const tables: Record<string, Map<string, Record<string, unknown>>> = {
    grocery_lists: new Map(state.lists.map((r) => [r.id, r])),
    grocery_items: new Map(state.items.map((r) => [r.id, r])),
    grocery_item_sources: new Map(state.sources.map((r) => [r.id, r])),
  };
  for (const op of ops) {
    const table = tables[op.table];
    if (op.kind === 'insert') table.set(op.id, { ...base, id: op.id, ...op.values });
    else if (op.kind === 'update') table.set(op.id, { ...table.get(op.id), ...op.values });
    else table.set(op.id, { ...table.get(op.id), deleted_at: 'deleted' });
  }
  return {
    lists: [...tables.grocery_lists.values()] as GroceryListRow[],
    items: [...tables.grocery_items.values()] as GroceryItemRow[],
    sources: [...tables.grocery_item_sources.values()] as GroceryItemSourceRow[],
  };
}

describe('weeklyListUpdates (FR-LIST-1, FR-LIST-2)', () => {
  it('creates the week list when a recipe is planned that week, with the plan items', () => {
    const [update] = weeklyListUpdates(input({ entries: [entry('e1', '2026-11-19')] }));
    expect(update).toMatchObject({
      weekStart: THIS_WEEK,
      created: true,
      listId: weekListId(HH, THIS_WEEK),
    });
    expect(update.ops[0]).toEqual({
      kind: 'insert',
      table: 'grocery_lists',
      id: weekListId(HH, THIS_WEEK),
      values: { week_start: THIS_WEEK, is_default: true },
    });
    const items = update.ops.filter((op) => op.table === 'grocery_items' && op.kind === 'insert');
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      values: { ingredient_id: 'ingredient.milk', list_id: update.listId },
    });
    expect(update.needs.staples).toEqual(['ingredient.salt']);
  });

  it('creates the list of a week open in the List tab, even with nothing planned', () => {
    const updates = weeklyListUpdates(input({ openWeeks: [THIS_WEEK] }));
    expect(updates.map((u) => [u.weekStart, u.created, u.ops.length])).toEqual([
      [THIS_WEEK, true, 1],
    ]);
  });

  it('makes no list for a week with only free text, or for past weeks', () => {
    expect(
      weeklyListUpdates(
        input({
          entries: [entry('e1', '2026-11-19', null), entry('e2', '2026-11-10')],
          openWeeks: ['2026-11-08'],
        }),
      ),
    ).toEqual([]);
  });

  it('keeps each week on its own list', () => {
    const updates = weeklyListUpdates(
      input({ entries: [entry('e1', '2026-11-16'), entry('e2', '2026-11-23')] }),
    );
    expect(updates.map((u) => u.weekStart)).toEqual([THIS_WEEK, NEXT_WEEK]);
    expect(new Set(updates.map((u) => u.listId)).size).toBe(2);
  });

  it('follows the household week start', () => {
    const [update] = weeklyListUpdates(
      input({ weekStartDay: 1, entries: [entry('e1', '2026-11-22')] }),
    );
    expect(update.weekStart).toBe('2026-11-16');
  });

  it('writes nothing once the lists match the plan', () => {
    const first = weeklyListUpdates(input({ entries: [entry('e1', '2026-11-19')] }));
    const state = apply(
      { lists: [], items: [], sources: [] },
      first.flatMap((u) => u.ops),
    );
    expect(weeklyListUpdates(input({ entries: [entry('e1', '2026-11-19')], ...state }))).toEqual(
      [],
    );
  });

  it('uses an existing list for the week, whatever its ID', () => {
    const list: GroceryListRow = {
      ...base,
      id: 'made-elsewhere',
      week_start: THIS_WEEK,
      is_default: true,
    };
    const [update] = weeklyListUpdates(
      input({ entries: [entry('e1', '2026-11-19')], lists: [list] }),
    );
    expect(update).toMatchObject({ listId: 'made-elsewhere', created: false });
    expect(update.ops.some((op) => op.table === 'grocery_lists')).toBe(false);
  });

  it('updates the list when the plan changes, with a summary (FR-LIST-3)', () => {
    const first = weeklyListUpdates(input({ entries: [entry('e1', '2026-11-19')] }));
    const state = apply(
      { lists: [], items: [], sources: [] },
      first.flatMap((u) => u.ops),
    );
    const [update] = weeklyListUpdates(input({ entries: [], ...state }));
    expect(update.summary).toEqual({ added: 0, changed: 0, removed: 1 });
  });

  it('leaves "have" ingredients off only for their week (R-PAN-2)', () => {
    const have = pantryRow({
      id: 'p2',
      ingredient_id: 'ingredient.milk',
      status: 'have',
      have_week_start: NEXT_WEEK,
    });
    const updates = weeklyListUpdates(
      input({
        entries: [entry('e1', '2026-11-16'), entry('e2', '2026-11-23')],
        pantry: [pantryRow({}), have],
      }),
    );
    expect(updates.map((u) => u.needs.have)).toEqual([[], ['ingredient.milk']]);
  });

  it('gives the same list ID on every device', () => {
    expect(weekListId(HH, THIS_WEEK)).toBe(weekListId(HH, THIS_WEEK));
    expect(weekListId(HH, THIS_WEEK)).not.toBe(weekListId(HH, NEXT_WEEK));
  });
});

describe('weekPantry', () => {
  it('reads live staples and the week\'s "have" rows, ignoring hidden staples and removed rows', () => {
    const pantry = weekPantry(
      [
        pantryRow({ id: 'a' }),
        pantryRow({ id: 'b', ingredient_id: 'ingredient.flour', status: 'hidden_staple' }),
        pantryRow({ id: 'c', ingredient_id: 'ingredient.sugar', deleted_at: 'x' }),
        pantryRow({
          id: 'd',
          ingredient_id: 'ingredient.milk',
          status: 'have',
          have_week_start: THIS_WEEK,
        }),
        pantryRow({
          id: 'e',
          ingredient_id: 'ingredient.egg',
          status: 'have',
          have_week_start: NEXT_WEEK,
        }),
      ],
      THIS_WEEK,
    );
    expect([...pantry.staples]).toEqual(['ingredient.salt']);
    expect([...pantry.have]).toEqual(['ingredient.milk']);
  });
});
