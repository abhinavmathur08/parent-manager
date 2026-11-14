import {
  compareEntries,
  defaultPortion,
  defaultServings,
  nextPosition,
  recentRecipeIds,
  entryAllergens,
  portionsFor,
  weekEntries,
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
