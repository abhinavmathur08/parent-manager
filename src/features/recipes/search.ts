import { normalize } from '@/features/ingredients/matching';

import type { RecipeTag } from './tables';

/** What the Recipes tab needs from a recipe to show and find it. */
export type RecipeEntry = {
  id: string;
  title: string;
  tags: readonly RecipeTag[];
  totalMinutes: number | null;
  /** Newer first. Null for a recipe the server hasn't stamped yet, which counts as newest. */
  updatedAt: string | null;
  /** Ingredient names in the household's locale, for search. */
  ingredientNames: readonly string[];
};

export type SearchableRecipe = RecipeEntry & { haystack: string[] };

/**
 * Folds a recipe's title, ingredient names and tag names into words once, so each
 * keystroke only compares strings (FR-REC-10, NFR-PERF-5: 500 recipes within 200 ms).
 * Tag names come from the locale, so a search for "freezer" finds freezer-friendly recipes.
 */
export function indexRecipe(
  entry: RecipeEntry,
  tagName: (tag: RecipeTag) => string,
): SearchableRecipe {
  const text = [entry.title, ...entry.ingredientNames, ...entry.tags.map(tagName)].join(' ');
  return { ...entry, haystack: normalize(text).split(' ').filter(Boolean) };
}

/**
 * Recipes matching every word of the query (each word starts a word in the recipe) and
 * every selected tag. Display text is matched here only to find recipes, never to merge or
 * compare data (R-ING-6).
 */
export function searchRecipes<T extends SearchableRecipe>(
  recipes: readonly T[],
  query: string,
  tags: readonly RecipeTag[],
): T[] {
  const words = normalize(query).split(' ').filter(Boolean);
  return recipes.filter(
    (recipe) =>
      tags.every((tag) => recipe.tags.includes(tag)) &&
      words.every((word) => recipe.haystack.some((w) => w.startsWith(word))),
  );
}

/** Most recently changed first, then by title in the locale's order (FR-REC-1). */
export function sortRecipes<T extends RecipeEntry>(recipes: readonly T[], locale: string): T[] {
  const collator = new Intl.Collator(locale, { sensitivity: 'base' });
  return [...recipes].sort((a, b) => {
    if (a.updatedAt !== b.updatedAt) {
      if (a.updatedAt === null) return -1;
      if (b.updatedAt === null) return 1;
      return a.updatedAt < b.updatedAt ? 1 : -1;
    }
    return collator.compare(a.title, b.title);
  });
}
