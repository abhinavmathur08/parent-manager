import type { Dimension } from '@/i18n';

import seed from '../../../supabase/catalog/ingredients.json';
import type { AllergenCode, SectionId } from './catalog-ids';
import { catalogIndexInput, type IngredientInfo, type IngredientNames } from './matching';

/**
 * The ingredient catalog on the device, from the same seed file the database is built from
 * (supabase/catalog/ingredients.json, R-01.2). Bundling it lets the recipe editor, search and
 * allergen notices work offline. New catalog rows reach the app with the next release.
 */
export type CatalogIngredient = {
  id: string;
  sectionId: SectionId;
  dimension: Dimension;
  allergens: readonly AllergenCode[];
};

type SeedIngredient = (typeof seed.ingredients)[number];

const byId = new Map<string, CatalogIngredient>(
  seed.ingredients.map((i: SeedIngredient) => [
    i.id,
    {
      id: i.id,
      sectionId: i.section as SectionId,
      dimension: i.dimension as Dimension,
      allergens: i.allergens as AllergenCode[],
    },
  ]),
);

export function catalogIngredient(id: string): CatalogIngredient | undefined {
  return byId.get(id);
}

const inputs = new Map<string, { ingredients: IngredientInfo[]; names: IngredientNames[] }>();

/** The catalog's names in one locale, ready for `buildNameIndex`. Cached per locale. */
export function catalogNames(locale: string) {
  let input = inputs.get(locale);
  if (!input) {
    input = catalogIndexInput(seed, locale);
    inputs.set(locale, input);
  }
  return input;
}
