import {
  effectiveServings,
  itemDisplayParts,
  needKey,
  weekNeeds,
  type EngineEntry,
  type EngineLine,
  type EngineRecipe,
  type IngredientFacts,
  type WeekInput,
} from '@/features/grocery/engine';
import { buildIngredientFacts } from '@/features/grocery/facts';
import { formatQuantity, type Dimension } from '@/i18n';

const WEEK = '2026-11-15';

const entry = (over: Partial<EngineEntry> & { id: string }): EngineEntry => ({
  date: '2026-11-16',
  recipe_id: 'r1',
  servings: 4,
  leftover_of_entry_id: null,
  deleted_at: null,
  ...over,
});
const recipe = (id: string, servings = 4): EngineRecipe => ({ id, servings, deleted_at: null });
let lineSeq = 0;
const line = (
  recipeId: string,
  ingredientId: string,
  quantity: number | null,
  unitId: string | null,
  quantityBase: number | null,
): EngineLine => ({
  id: `l${++lineSeq}`,
  recipe_id: recipeId,
  ingredient_id: ingredientId,
  quantity,
  unit_id: unitId,
  quantity_base: quantityBase,
  deleted_at: null,
});

const facts = (
  over: Record<string, { dimension: Dimension; density?: number }> = {},
): IngredientFacts => ({
  dimension: (id) => over[id]?.dimension ?? 'count',
  density: (id) => over[id]?.density ?? null,
  section: () => 'section.other',
});

const noPantry = { staples: new Set<string>(), have: new Set<string>() };

const input = (over: Partial<WeekInput>): WeekInput => ({
  entries: [],
  recipes: [],
  lines: [],
  weekStart: WEEK,
  ingredients: buildIngredientFacts([]),
  pantry: noPantry,
  ...over,
});

describe('weekNeeds', () => {
  it('merges "1 cup" and "2 cups" of milk into 3 cups for a US household (spec 3.8)', () => {
    const result = weekNeeds(
      input({
        entries: [entry({ id: 'e1', recipe_id: 'r1' }), entry({ id: 'e2', recipe_id: 'r2' })],
        recipes: [recipe('r1'), recipe('r2')],
        lines: [
          line('r1', 'ingredient.milk', 1, 'unit.cup_us', 236.588),
          line('r2', 'ingredient.milk', 2, 'unit.cup_us', 473.176),
        ],
      }),
    );
    expect(result.needs).toHaveLength(1);
    const milk = result.needs[0];
    expect(milk).toMatchObject({
      key: 'ingredient.milk|volume',
      dimension: 'volume',
      sectionId: 'section.dairy',
    });
    expect(milk.sources.map((s) => s.entryId)).toEqual(['e1', 'e2']);
    const parts = itemDisplayParts(milk.dimension, milk.quantityBase, 'us_customary');
    expect(parts).toEqual([{ value: 3, unitId: 'unit.cup_us' }]);
    expect(formatQuantity(parts!, 'en-US')).toBe('3 cups');
    expect(result.mergedCount).toBe(1);
  });

  it('shows the same stored quantity in the metric system for display only (R-UNIT-5)', () => {
    const result = weekNeeds(
      input({
        entries: [entry({ id: 'e1' })],
        recipes: [recipe('r1')],
        lines: [line('r1', 'ingredient.milk', 3, 'unit.cup_us', 709.764)],
      }),
    );
    const milk = result.needs[0];
    expect(milk.quantityBase).toBeCloseTo(709.764);
    expect(itemDisplayParts(milk.dimension, milk.quantityBase, 'metric')).toEqual([
      { value: 700, unitId: 'unit.ml' },
    ]);
  });

  it('keeps mass and volume separate when the ingredient has no density (R-UNIT-2)', () => {
    const result = weekNeeds(
      input({
        ingredients: facts({ 'ingredient.x': { dimension: 'mass' } }),
        entries: [entry({ id: 'e1' })],
        recipes: [recipe('r1')],
        lines: [
          line('r1', 'ingredient.x', 200, 'unit.g', 200),
          line('r1', 'ingredient.x', 2, 'unit.tbsp_us', 29.5736),
        ],
      }),
    );
    expect(result.needs.map((n) => n.key)).toEqual(['ingredient.x|mass', 'ingredient.x|volume']);
    expect(result.needs[0].quantityBase).toBe(200);
    expect(result.needs[1].quantityBase).toBeCloseTo(29.5736);
  });

  it('merges mass and volume into the default dimension when a density exists (R-UNIT-2)', () => {
    const result = weekNeeds(
      input({
        ingredients: facts({ 'ingredient.butter': { dimension: 'mass', density: 0.96 } }),
        entries: [entry({ id: 'e1' })],
        recipes: [recipe('r1')],
        lines: [
          line('r1', 'ingredient.butter', 200, 'unit.g', 200),
          line('r1', 'ingredient.butter', 100, 'unit.ml', 100),
        ],
      }),
    );
    expect(result.needs).toHaveLength(1);
    expect(result.needs[0].key).toBe('ingredient.butter|mass');
    expect(result.needs[0].quantityBase).toBeCloseTo(296);
  });

  it('never merges count with mass, even with a density (R-UNIT-2)', () => {
    const result = weekNeeds(
      input({
        ingredients: facts({ 'ingredient.x': { dimension: 'mass', density: 1 } }),
        entries: [entry({ id: 'e1' })],
        recipes: [recipe('r1')],
        lines: [
          line('r1', 'ingredient.x', 200, 'unit.g', 200),
          line('r1', 'ingredient.x', 2, null, 2),
        ],
      }),
    );
    expect(result.needs.map((n) => n.key)).toEqual(['ingredient.x|count', 'ingredient.x|mass']);
  });

  it('scales by entry servings over recipe servings (R-SERV-2)', () => {
    const result = weekNeeds(
      input({
        entries: [entry({ id: 'e1', servings: 6 })],
        recipes: [recipe('r1', 4)],
        lines: [line('r1', 'ingredient.egg', 2, null, 2)],
      }),
    );
    expect(result.needs[0].quantityBase).toBe(3);
    expect(result.needs[0].sources).toEqual([
      { entryId: 'e1', lineId: expect.any(String), quantityBase: 3 },
    ]);
  });

  it('rounds counts up for shopping (R-UNIT-3)', () => {
    expect(itemDisplayParts('count', 2.25, 'metric')).toEqual([{ value: 3, unitId: 'unit.each' }]);
  });

  it('leaves out entries outside the week, removed entries and free text (FR-LIST-1, R-SERV-4)', () => {
    const result = weekNeeds(
      input({
        entries: [
          entry({ id: 'before', date: '2026-11-14' }),
          entry({ id: 'after', date: '2026-11-22' }),
          entry({ id: 'gone', deleted_at: '2026-11-16T00:00:00Z' }),
          entry({ id: 'text', recipe_id: null }),
          entry({ id: 'last-day', date: '2026-11-21' }),
        ],
        recipes: [recipe('r1')],
        lines: [line('r1', 'ingredient.egg', 4, null, 4)],
      }),
    );
    expect(result.needs).toHaveLength(1);
    expect(result.needs[0].sources.map((s) => s.entryId)).toEqual(['last-day']);
  });

  it('ignores removed recipes and removed lines', () => {
    const removed = {
      ...line('r1', 'ingredient.milk', 1, 'unit.cup_us', 236.588),
      deleted_at: 'x',
    };
    const result = weekNeeds(
      input({
        entries: [entry({ id: 'e1' }), entry({ id: 'e2', recipe_id: 'r2' })],
        recipes: [recipe('r1'), { ...recipe('r2'), deleted_at: 'x' }],
        lines: [removed, line('r2', 'ingredient.egg', 2, null, 2)],
      }),
    );
    expect(result.needs).toEqual([]);
  });

  it('works out a base quantity the server has not filled in yet (R-ING-3)', () => {
    const result = weekNeeds(
      input({
        entries: [entry({ id: 'e1' })],
        recipes: [recipe('r1')],
        lines: [line('r1', 'ingredient.milk', 2, 'unit.cup_us', null)],
      }),
    );
    expect(result.needs[0].quantityBase).toBeCloseTo(473.176);
  });

  it('shows a no-quantity line once, and only when nothing measured is needed (R-ING-4, R-ING-5)', () => {
    const result = weekNeeds(
      input({
        ingredients: facts({ 'ingredient.parsley': { dimension: 'mass' } }),
        entries: [entry({ id: 'e1' }), entry({ id: 'e2', recipe_id: 'r2' })],
        recipes: [recipe('r1'), recipe('r2')],
        lines: [
          line('r1', 'ingredient.parsley', null, null, null),
          line('r2', 'ingredient.parsley', 1, 'unit.pinch', null),
          line('r1', 'ingredient.lemon', null, null, null),
          line('r2', 'ingredient.lemon', 1, null, 1),
        ],
      }),
    );
    expect(result.needs.map((n) => [n.key, n.quantityBase])).toEqual([
      ['ingredient.lemon|count', 1],
      ['ingredient.parsley|none', null],
    ]);
    expect(result.needs[1].sources).toHaveLength(2);
    expect(itemDisplayParts(null, null, 'metric')).toBeNull();
  });

  it('leaves out staples and "have" ingredients and reports them (R-LIST-3, FR-PAN-3)', () => {
    const result = weekNeeds(
      input({
        entries: [entry({ id: 'e1' }), entry({ id: 'e2', recipe_id: 'r2' })],
        recipes: [recipe('r1'), recipe('r2')],
        lines: [
          line('r1', 'ingredient.salt', 1, 'unit.tsp_us', 4.93),
          line('r2', 'ingredient.salt', 1, 'unit.tsp_us', 4.93),
          line('r1', 'ingredient.milk', 1, 'unit.cup_us', 236.588),
          line('r1', 'ingredient.egg', 2, null, 2),
        ],
        pantry: { staples: new Set(['ingredient.salt']), have: new Set(['ingredient.milk']) },
      }),
    );
    expect(result.needs.map((n) => n.key)).toEqual(['ingredient.egg|count']);
    expect(result.staples).toEqual(['ingredient.salt']);
    expect(result.have).toEqual(['ingredient.milk']);
  });

  it('is deterministic whatever order the rows arrive in (R-LIST-7)', () => {
    const entries = [entry({ id: 'e2', recipe_id: 'r2' }), entry({ id: 'e1' })];
    const recipes = [recipe('r1'), recipe('r2')];
    const lines = [
      line('r2', 'ingredient.milk', 2, 'unit.cup_us', 473.176),
      line('r1', 'ingredient.egg', 2, null, 2),
      line('r1', 'ingredient.milk', 1, 'unit.cup_us', 236.588),
    ];
    const a = weekNeeds(input({ entries, recipes, lines }));
    const b = weekNeeds(
      input({
        entries: [...entries].reverse(),
        recipes: [...recipes].reverse(),
        lines: [...lines].reverse(),
      }),
    );
    expect(b).toEqual(a);
  });

  it('builds a 21-entry week of 15 lines each within 100 ms (NFR-PERF-4)', () => {
    const ids = ['milk', 'egg', 'butter', 'onion', 'cheddar', 'olive_oil', 'flour', 'sugar'];
    const recipes = Array.from({ length: 21 }, (_, i) => recipe(`r${i}`));
    const lines = recipes.flatMap((r, i) =>
      Array.from({ length: 15 }, (_, j) => {
        const id = `ingredient.${ids[(i + j) % ids.length]}${j % 3 === 0 ? '' : `_${j}`}`;
        return j % 2
          ? line(r.id, id, 100, 'unit.g', 100)
          : line(r.id, id, 1, 'unit.cup_us', 236.588);
      }),
    );
    const entries = recipes.map((r, i) =>
      entry({
        id: `e${i}`,
        recipe_id: r.id,
        date: `2026-11-${String(15 + (i % 7)).padStart(2, '0')}`,
      }),
    );
    const args = input({ entries, recipes, lines });
    weekNeeds(args);
    const runs = Array.from({ length: 20 }, () => {
      const start = performance.now();
      weekNeeds(args);
      return performance.now() - start;
    }).sort((x, y) => x - y);
    expect(runs[18]).toBeLessThan(100);
  });
});

describe('effectiveServings (R-SERV-3)', () => {
  it('adds leftovers to the start of the chain, which then need nothing themselves', () => {
    const servings = effectiveServings([
      entry({ id: 'a', servings: 4 }),
      entry({ id: 'b', servings: 2, leftover_of_entry_id: 'a' }),
      entry({ id: 'c', servings: 1, leftover_of_entry_id: 'b' }),
    ]);
    expect(Object.fromEntries(servings)).toEqual({ a: 7, b: 0, c: 0 });
  });

  it('ignores a link to a removed entry and survives a loop', () => {
    const servings = effectiveServings([
      entry({ id: 'a', servings: 4, deleted_at: 'x' }),
      entry({ id: 'b', servings: 2, leftover_of_entry_id: 'a' }),
      entry({ id: 'c', servings: 1, leftover_of_entry_id: 'd' }),
      entry({ id: 'd', servings: 1, leftover_of_entry_id: 'c' }),
    ]);
    expect(servings.get('b')).toBe(2);
    expect((servings.get('c') ?? 0) + (servings.get('d') ?? 0)).toBe(2);
  });

  it('needs nothing for leftovers of an entry in an earlier week', () => {
    const result = weekNeeds(
      input({
        entries: [
          entry({ id: 'a', date: '2026-11-14' }),
          entry({ id: 'b', date: '2026-11-15', leftover_of_entry_id: 'a' }),
        ],
        recipes: [recipe('r1')],
        lines: [line('r1', 'ingredient.egg', 2, null, 2)],
      }),
    );
    expect(result.needs).toEqual([]);
  });
});

describe('needKey', () => {
  it('names a no-quantity group "none"', () => {
    expect(needKey('ingredient.salt', null)).toBe('ingredient.salt|none');
  });
});
