import '@/features/recipes/sync';
import { quantityBase } from '@/features/recipes/quantity';
import { RECIPE_TABLES } from '@/features/recipes/tables';
import { registeredTables, validateDefinition } from '@/lib/sync/registry';

describe('recipe sync tables (R-02.1)', () => {
  it('are valid sync table definitions', () => {
    for (const table of RECIPE_TABLES) expect(() => validateDefinition(table)).not.toThrow();
  });

  it('register with the sync layer when the module loads', () => {
    expect(registeredTables().map((t) => t.name)).toEqual(
      expect.arrayContaining(['recipes', 'recipe_ingredients', 'recipe_steps']),
    );
  });
});

describe('quantityBase (R-ING-3 to R-ING-5)', () => {
  it('converts a measured unit to base units', () => {
    expect(quantityBase(1.5, 'unit.cup_us', 'volume')).toBeCloseTo(354.882, 3);
    expect(quantityBase(2, 'unit.tbsp_au', 'volume')).toBe(40);
    expect(quantityBase(250, 'unit.g', 'mass')).toBe(250);
  });

  it('counts a count ingredient with no unit', () => {
    expect(quantityBase(2, null, 'count')).toBe(2);
  });

  it('has no base quantity for "to taste", a pinch or no quantity', () => {
    expect(quantityBase(200, null, 'mass')).toBeNull();
    expect(quantityBase(1, 'unit.pinch', 'mass')).toBeNull();
    expect(quantityBase(null, 'unit.g', 'mass')).toBeNull();
  });
});
