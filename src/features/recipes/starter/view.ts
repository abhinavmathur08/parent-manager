import type { RecipeDraft } from '../draft';
import type { RecipeView } from '../recipe-detail';
import type { RecipeEntry } from '../search';
import { starterText, type StarterRecipe } from './library';

const total = (r: StarterRecipe) =>
  r.prepMinutes === null && r.cookMinutes === null
    ? null
    : (r.prepMinutes ?? 0) + (r.cookMinutes ?? 0);

/** A starter recipe as recipe detail (S-17) shows it: read-only (FR-REC-3). */
export function starterView(recipe: StarterRecipe, locale: string): RecipeView {
  const text = starterText(recipe, locale);
  return {
    id: recipe.key,
    title: text.title,
    servings: recipe.servings,
    prepMinutes: recipe.prepMinutes,
    cookMinutes: recipe.cookMinutes,
    tags: recipe.tags,
    notes: text.notes ?? null,
    sourceType: 'library',
    sourceUrl: null,
    lines: recipe.lines.map((line, i) => ({
      id: `${recipe.key}:${i}`,
      ingredientId: line.ingredientId,
      quantity: line.quantity,
      unitId: line.unitId,
      note: line.note ?? null,
      optional: false,
    })),
    steps: text.steps.map((step, i) => ({ id: `${recipe.key}:step:${i}`, text: step })),
  };
}

/** A starter recipe on the Recipes tab, for its card and search. */
export function starterEntry(
  recipe: StarterRecipe,
  locale: string,
  ingredientName: (id: string) => string | null,
): RecipeEntry {
  return {
    id: recipe.key,
    title: starterText(recipe, locale).title,
    tags: recipe.tags,
    totalMinutes: total(recipe),
    updatedAt: null,
    ingredientNames: recipe.lines.flatMap((l) => ingredientName(l.ingredientId) ?? []),
  };
}

/**
 * "Save a copy" (FR-REC-3): an ordinary household draft with new IDs for every line and
 * step, so the copy is editable and independent of the starter. Saved with
 * `source_type = 'library'` and the starter's key in `library_recipe_id`.
 */
export function copyStarter(
  recipe: StarterRecipe,
  locale: string,
  newId: () => string,
): RecipeDraft {
  const text = starterText(recipe, locale);
  return {
    title: text.title,
    servings: recipe.servings,
    prepMinutes: recipe.prepMinutes === null ? '' : String(recipe.prepMinutes),
    cookMinutes: recipe.cookMinutes === null ? '' : String(recipe.cookMinutes),
    tags: [...recipe.tags],
    notes: text.notes ?? '',
    sourceUrl: '',
    lines: recipe.lines.map((line) => ({
      id: newId(),
      ingredientId: line.ingredientId,
      quantity: line.quantity,
      unitId: line.unitId,
      rawText: null,
      note: line.note ?? null,
      optional: false,
    })),
    steps: text.steps.map((step) => ({ id: newId(), text: step })),
    newIngredients: [],
  };
}
