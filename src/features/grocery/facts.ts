import { catalogIngredient } from '@/features/ingredients/catalog';
import type { AllergenCode } from '@/features/ingredients/catalog-ids';
import {
  householdIngredientId,
  type HouseholdIngredientRow,
} from '@/features/ingredients/household';

import type { IngredientFacts } from './engine';

export type ListIngredientFacts = IngredientFacts & {
  allergens(id: string): readonly AllergenCode[];
};

/**
 * Ingredient facts for the list engine from the bundled catalog and the household's own
 * ingredients (R-ING-1, R-LIST-6). An ID the device doesn't know yet counts as a "count"
 * ingredient in the "other" section until it syncs.
 */
export function buildIngredientFacts(
  householdRows: readonly HouseholdIngredientRow[],
): ListIngredientFacts {
  const own = new Map(
    householdRows.filter((r) => !r.deleted_at).map((r) => [householdIngredientId(r.id), r]),
  );
  return {
    dimension: (id) =>
      catalogIngredient(id)?.dimension ?? own.get(id)?.default_dimension ?? 'count',
    density: (id) => catalogIngredient(id)?.density ?? null,
    section: (id) => catalogIngredient(id)?.sectionId ?? own.get(id)?.section_id ?? 'section.other',
    allergens: (id) => catalogIngredient(id)?.allergens ?? [],
  };
}
