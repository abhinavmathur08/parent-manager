import {
  compareEntries,
  canHaveBabyPlate,
  defaultPortion,
  entryLineQuantities,
  hasBabyPlate,
  quantityFactor,
  servingsFromPortions,
  defaultServings,
  nextPosition,
  planWeekCopy,
  recentRecipeIds,
  entryAllergens,
  portionsFor,
  weekEntries,
  type PersonPortion,
  type PlanPerson,
} from '@/features/planner/plan';
import type { PlanEntryPortionRow, PlanEntryRow } from '@/features/planner/tables';

const base = {
  household_id: 'hh',
  version: 1,
  created_at: null,
  updated_at: null,
  deleted_at: null,
};
const entry = (over: Partial<PlanEntryRow>): PlanEntryRow => ({
  ...base,
  id: 'e1',
  date: '2026-11-16',
  slot: 'dinner',
  position: 0,
  recipe_id: 'r1',
  free_text: null,
  servings: 2,
  leftover_of_entry_id: null,
  ...over,
});

const people: PlanPerson[] = [
  { id: 'p1', displayName: 'Alex', ageBand: 'adult', allergies: [] },
  { id: 'p2', displayName: 'Mia', ageBand: 'toddler', allergies: ['allergen.milk'] },
  { id: 'p3', displayName: 'Baby', ageBand: 'infant_0_6m', allergies: ['allergen.egg'] },
];

const allergensOf = (id: string) =>
  id === 'ingredient.milk'
    ? (['allergen.milk'] as const)
    : id === 'ingredient.egg'
      ? (['allergen.egg'] as const)
      : [];
const ingredientIdsOf = () => ['ingredient.milk', 'ingredient.egg', 'ingredient.onion'];

describe('default portions (R-SERV-1)', () => {
  it('follows the age bands', () => {
    expect(defaultPortion('adult')).toEqual({ portions: 1, variant: 'standard' });
    expect(defaultPortion('older_child').portions).toBe(1);
    expect(defaultPortion('preschool').portions).toBe(0.5);
    expect(defaultPortion('toddler').portions).toBe(0.5);
    expect(defaultPortion('infant_6_12m')).toEqual({ portions: 0.25, variant: 'baby_plate' });
    expect(defaultPortion('infant_0_6m').portions).toBe(0);
    expect(defaultPortion('expecting').portions).toBe(0);
  });

  it('uses portions set on the entry over the defaults', () => {
    const rows: PlanEntryPortionRow[] = [
      { ...base, id: 'x', entry_id: 'e1', person_id: 'p1', portions: 2, variant: 'standard' },
      { ...base, id: 'y', entry_id: 'e2', person_id: 'p2', portions: 0, variant: 'standard' },
    ];
    const portions = portionsFor('e1', people, rows);
    expect(portions.get('p1')?.portions).toBe(2);
    expect(portions.get('p2')?.portions).toBe(0.5);
  });
});

describe('allergen markers (FR-PLAN-11)', () => {
  it('marks allergens for people who eat the entry, and not for those who do not', () => {
    // The baby under 6 months has a portion of 0 by default, so egg isn't marked.
    expect(entryAllergens(entry({}), ingredientIdsOf, allergensOf, people, [])).toEqual([
      { allergen: 'allergen.milk', people: ['Mia'] },
    ]);
  });

  it('drops the marker when that person is set to 0', () => {
    const rows: PlanEntryPortionRow[] = [
      { ...base, id: 'x', entry_id: 'e1', person_id: 'p2', portions: 0, variant: 'standard' },
    ];
    expect(entryAllergens(entry({}), ingredientIdsOf, allergensOf, people, rows)).toEqual([]);
  });

  it('has none for free text', () => {
    const free = entry({ recipe_id: null, free_text: 'Takeout' });
    expect(entryAllergens(free, ingredientIdsOf, allergensOf, people, [])).toEqual([]);
  });
});

describe('week entries (FR-PLAN-1, FR-PLAN-4)', () => {
  it('keeps the week, drops removed entries and orders by day, slot and position', () => {
    const rows = [
      entry({ id: 'a', date: '2026-11-17', slot: 'lunch' }),
      entry({ id: 'b', date: '2026-11-16', slot: 'dinner', position: 1 }),
      entry({ id: 'c', date: '2026-11-16', slot: 'breakfast' }),
      entry({ id: 'd', date: '2026-11-16', slot: 'dinner', position: 0 }),
      entry({ id: 'e', date: '2026-11-22' }),
      entry({ id: 'f', date: '2026-11-18', deleted_at: '2026-11-10T00:00:00Z' }),
    ];
    expect(weekEntries(rows, '2026-11-15').map((e) => e.id)).toEqual(['c', 'd', 'b', 'a']);
    expect(compareEntries(rows[0], rows[0])).toBe(0);
  });
});

describe('adding entries (FR-PLAN-3 to FR-PLAN-5)', () => {
  it('defaults servings to the people, rounded up to the nearest ½ (R-SERV-1)', () => {
    // 1 + ½ + 0 = 1.5.
    expect(defaultServings(people)).toBe(1.5);
    // 1 + ¼ (baby plate) rounds up to 1.5.
    expect(defaultServings([people[0], { ...people[1], ageBand: 'infant_6_12m' }])).toBe(1.5);
    expect(defaultServings([people[2]])).toBeNull();
    expect(defaultServings([])).toBeNull();
  });

  it("puts a new entry after the slot's last live entry", () => {
    const rows = [
      entry({ id: 'a', position: 0 }),
      entry({ id: 'b', position: 3, deleted_at: '2026-11-10T00:00:00Z' }),
      entry({ id: 'c', position: 1 }),
      entry({ id: 'd', slot: 'lunch', position: 5 }),
    ];
    expect(nextPosition(rows, '2026-11-16', 'dinner')).toBe(2);
    expect(nextPosition(rows, '2026-11-17', 'dinner')).toBe(0);
  });

  it('lists recently planned recipes first, then recently changed ones', () => {
    const recipes = [
      { id: 'r1', updated_at: '2026-11-01T00:00:00Z', deleted_at: null },
      { id: 'r2', updated_at: '2026-11-11T00:00:00Z', deleted_at: null },
      { id: 'r3', updated_at: '2026-11-05T00:00:00Z', deleted_at: null },
      { id: 'gone', updated_at: '2026-11-12T00:00:00Z', deleted_at: '2026-11-12T00:00:00Z' },
    ];
    const rows = [
      entry({ id: 'a', recipe_id: 'r1', updated_at: '2026-11-09T00:00:00Z' }),
      entry({ id: 'b', recipe_id: 'r3', updated_at: '2026-11-10T00:00:00Z' }),
      entry({ id: 'c', recipe_id: 'gone', updated_at: '2026-11-12T00:00:00Z' }),
    ];
    expect(recentRecipeIds(rows, recipes, 3)).toEqual(['r3', 'r1', 'r2']);
    expect(recentRecipeIds([], recipes, 2)).toEqual(['r2', 'r3']);
  });
});

describe('portions and servings (FR-PLAN-6, R-SERV-2)', () => {
  const recipe = { id: 'r1', servings: 4 };
  const lines = [
    { recipe_id: 'r1', ingredient_id: 'ingredient.pasta', quantity_base: 400, deleted_at: null },
    { recipe_id: 'r1', ingredient_id: 'ingredient.salt', quantity_base: null, deleted_at: null },
    { recipe_id: 'r1', ingredient_id: 'ingredient.gone', quantity_base: 50, deleted_at: 'x' },
    { recipe_id: 'r2', ingredient_id: 'ingredient.rice', quantity_base: 100, deleted_at: null },
  ];
  const pasta = (portions: Map<string, PersonPortion>) =>
    entryLineQuantities(
      { recipe_id: 'r1', servings: servingsFromPortions(portions.values()) ?? 0 },
      recipe,
      lines,
    );

  it('offers a baby plate only from 6 to 12 months', () => {
    expect(canHaveBabyPlate('infant_6_12m')).toBe(true);
    expect(canHaveBabyPlate('infant_0_6m')).toBe(false);
    expect(canHaveBabyPlate('toddler')).toBe(false);
  });

  it('makes servings the sum of portions, and needs someone eating', () => {
    const portions = [
      { portions: 1, variant: 'standard' as const },
      { portions: 0.5, variant: 'standard' as const },
      { portions: 0.25, variant: 'baby_plate' as const },
    ];
    expect(servingsFromPortions(portions)).toBe(1.75);
    expect(hasBabyPlate(portions)).toBe(true);
    expect(servingsFromPortions([{ portions: 0, variant: 'standard' }])).toBeNull();
    expect(hasBabyPlate([{ portions: 1, variant: 'standard' }])).toBe(false);
  });

  it('changes list quantities when portions change', () => {
    const portions = new Map<string, PersonPortion>([
      ['adult', { portions: 1, variant: 'standard' }],
      ['toddler', { portions: 0.5, variant: 'standard' }],
    ]);
    // 1.5 servings of a 4-serving recipe: 400 g x 0.375.
    expect(pasta(portions)).toEqual([
      { ingredientId: 'ingredient.pasta', quantityBase: 150 },
      { ingredientId: 'ingredient.salt', quantityBase: null },
    ]);
    portions.set('adult', { portions: 2, variant: 'standard' });
    portions.set('baby', { portions: 0.25, variant: 'baby_plate' });
    // 2.75 servings: 400 g x 0.6875.
    expect(pasta(portions)[0].quantityBase).toBe(275);
    portions.set('toddler', { portions: 0, variant: 'standard' });
    expect(pasta(portions)[0].quantityBase).toBe(225);
  });

  it('asks nothing of free text or a missing recipe (R-SERV-4)', () => {
    expect(entryLineQuantities({ recipe_id: null, servings: 2 }, recipe, lines)).toEqual([]);
    expect(entryLineQuantities({ recipe_id: 'r1', servings: 2 }, undefined, lines)).toEqual([]);
    expect(quantityFactor(2, 0)).toBe(0);
  });
});

describe('copy last week (FR-PLAN-9)', () => {
  it('keeps weekday and slot across a month end and a clock change', () => {
    // US clocks went back on 1 November 2026; the source week crosses into November.
    const rows = [
      entry({ id: 'a', date: '2026-10-25', slot: 'dinner' }),
      entry({ id: 'b', date: '2026-10-31', slot: 'lunch' }),
      entry({ id: 'c', date: '2026-10-31', slot: 'dinner', position: 1 }),
      entry({ id: 'd', date: '2026-11-01', slot: 'dinner' }),
    ];
    const copies = planWeekCopy(rows, '2026-10-25', '2026-11-01', []);
    expect(copies.map((c) => [c.source.id, c.date, c.slot, c.position])).toEqual([
      ['a', '2026-11-01', 'dinner', 0],
      ['b', '2026-11-07', 'lunch', 0],
      ['c', '2026-11-07', 'dinner', 0],
    ]);
  });

  it('adds after what this week already has', () => {
    const rows = [
      entry({ id: 'a', date: '2026-11-09', slot: 'dinner' }),
      entry({ id: 'kept', date: '2026-11-16', slot: 'dinner', position: 0 }),
    ];
    const copies = planWeekCopy(rows, '2026-11-08', '2026-11-15', [rows[1]]);
    expect(copies).toHaveLength(1);
    expect(copies[0]).toMatchObject({ date: '2026-11-16', position: 1 });
  });

  it('keeps leftover links inside the week and drops ones that point outside', () => {
    const rows = [
      entry({ id: 'old', date: '2026-11-07' }),
      entry({ id: 'a', date: '2026-11-09', slot: 'dinner' }),
      entry({ id: 'b', date: '2026-11-10', slot: 'lunch', leftover_of_entry_id: 'a' }),
      entry({ id: 'c', date: '2026-11-08', slot: 'lunch', leftover_of_entry_id: 'old' }),
    ];
    const copies = planWeekCopy(rows, '2026-11-08', '2026-11-15', []);
    expect(copies.map((c) => [c.source.id, c.leftoverOfSource])).toEqual([
      ['c', null],
      ['a', null],
      ['b', 'a'],
    ]);
  });
});
