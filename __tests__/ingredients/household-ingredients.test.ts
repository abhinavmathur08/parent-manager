import '@/features/ingredients/sync';
import { catalogIngredient } from '@/features/ingredients/catalog';
import {
  householdIngredientId,
  type HouseholdIngredientRow,
} from '@/features/ingredients/household';
import { searchIngredients } from '@/features/ingredients/matching';
import { buildIngredients } from '@/features/ingredients/use-ingredients';
import { registeredTables } from '@/lib/sync/registry';

const row = (over: Partial<HouseholdIngredientRow> = {}): HouseholdIngredientRow => ({
  id: 'aaaaaaaa-4444-0000-0000-000000000001',
  household_id: 'hh',
  version: 1,
  created_at: null,
  updated_at: null,
  deleted_at: null,
  name: "Grandma's chutney",
  locale: 'en-US',
  section_id: 'section.condiments',
  default_dimension: 'mass',
  ...over,
});

describe('household ingredients (R-02.2, FR-REC-5)', () => {
  it('registers with the sync layer', () => {
    expect(registeredTables().map((t) => t.name)).toContain('household_ingredients');
  });

  it('uses the ingredient.h.<hex> ID the server publishes', () => {
    expect(householdIngredientId('AAAAAAAA-4444-0000-0000-000000000001')).toBe(
      'ingredient.h.aaaaaaaa444400000000000000000001',
    );
  });

  it('joins the catalog in the name index, so pickers find it', () => {
    const ingredients = buildIngredients('en-US', [row()]);
    const id = householdIngredientId(row().id);
    expect(searchIngredients(ingredients.index, 'chutney')[0]?.ingredientId).toBe(id);
    expect(ingredients.name(id)).toBe("Grandma's chutney");
    expect(ingredients.dimension(id)).toBe('mass');
    expect(ingredients.allergens(id)).toEqual([]);
  });

  it('knows catalog names, dimensions and allergens offline', () => {
    const ingredients = buildIngredients('en-GB', []);
    expect(ingredients.name('ingredient.zucchini')).toBe('courgette');
    expect(ingredients.dimension('ingredient.onion')).toBe('count');
    expect(ingredients.allergens('ingredient.milk')).toContain('allergen.milk');
    expect(catalogIngredient('ingredient.milk')?.sectionId).toBe('section.dairy');
    expect(ingredients.name('ingredient.h.unknown')).toBeNull();
  });
});
