import { useMemo } from 'react';

import type { Dimension } from '@/i18n';
import { useSyncedRows } from '@/lib/sync';

import { catalogIngredient, catalogNames } from './catalog';
import type { AllergenCode } from './catalog-ids';
import {
  HOUSEHOLD_INGREDIENTS,
  householdIngredientId,
  type HouseholdIngredientRow,
} from './household';
import { buildNameIndex, type IngredientInfo, type NameIndex } from './matching';

export type Ingredients = {
  /** The locale's name index: the catalog plus the household's own ingredients (R-ING-6). */
  index: NameIndex;
  /** The ingredient's name in the locale, or null for an ID the device doesn't know yet. */
  name(id: string): string | null;
  /** The name to show next to an amount: the plural for more than one, where there is one. */
  nameFor(id: string, count: number | null): string | null;
  /** Its default dimension, which decides whether a line without a unit is a count (FR-REC-6). */
  dimension(id: string): Dimension;
  allergens(id: string): readonly AllergenCode[];
};

/** Builds the lookups from the catalog and the household's rows. Pure, for tests. */
export function buildIngredients(
  locale: string,
  householdRows: readonly HouseholdIngredientRow[],
): Ingredients {
  const catalog = catalogNames(locale);
  const own: IngredientInfo[] = householdRows.map((row) => ({
    id: householdIngredientId(row.id),
    defaultDimension: row.default_dimension,
    householdId: row.household_id,
  }));
  const index = buildNameIndex(
    locale,
    [...catalog.ingredients, ...own],
    [
      ...catalog.names,
      ...householdRows.map((row) => ({
        ingredientId: householdIngredientId(row.id),
        name: row.name,
        plural: null,
        synonyms: [],
      })),
    ],
  );
  const plurals = new Map(catalog.names.map((n) => [n.ingredientId, n.plural]));
  const name = (id: string) => index.displayName.get(id) ?? null;
  return {
    index,
    name,
    nameFor: (id, count) => ((count ?? 0) > 1 ? plurals.get(id) : null) ?? name(id),
    dimension: (id) =>
      index.info.get(id)?.defaultDimension ?? catalogIngredient(id)?.dimension ?? 'count',
    allergens: (id) => catalogIngredient(id)?.allergens ?? [],
  };
}

/** The ingredients the household can use, offline, for pickers, display and allergen checks. */
export function useIngredients(locale: string): Ingredients {
  const { rows } = useSyncedRows<HouseholdIngredientRow>(HOUSEHOLD_INGREDIENTS.name);
  return useMemo(() => buildIngredients(locale, rows), [locale, rows]);
}
