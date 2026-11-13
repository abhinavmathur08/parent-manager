import { useMemo } from 'react';

import { useRecipeRows } from '@/features/recipes/data';
import { useSyncedRows } from '@/lib/sync';

import { weekEntries } from './plan';
import {
  PLAN_ENTRIES,
  PLAN_ENTRY_PORTIONS,
  type PlanEntryPortionRow,
  type PlanEntryRow,
} from './tables';
import type { PlanDate } from './week';

/** The household's plan from the local copy, so it reads offline (FR-PLAN-11, NFR-OFF-1). */
export function usePlanRows() {
  const entries = useSyncedRows<PlanEntryRow>(PLAN_ENTRIES.name);
  const portions = useSyncedRows<PlanEntryPortionRow>(PLAN_ENTRY_PORTIONS.name);
  return {
    entries: entries.rows,
    portions: portions.rows,
    loading: entries.loading || portions.loading,
  };
}

/**
 * One week's entries, with what's needed to show them: recipe titles and each recipe's
 * ingredient IDs for allergen markers.
 */
export function usePlanWeek(start: PlanDate) {
  const { entries, portions, loading } = usePlanRows();
  const recipes = useRecipeRows();
  const week = useMemo(() => weekEntries(entries, start), [entries, start]);
  const titles = useMemo(
    () => new Map(recipes.recipes.filter((r) => !r.deleted_at).map((r) => [r.id, r.title])),
    [recipes.recipes],
  );
  const ingredientIds = useMemo(() => {
    const byRecipe = new Map<string, string[]>();
    for (const line of recipes.lines) {
      if (line.deleted_at) continue;
      byRecipe.set(line.recipe_id, [...(byRecipe.get(line.recipe_id) ?? []), line.ingredient_id]);
    }
    return byRecipe;
  }, [recipes.lines]);
  return {
    all: entries,
    entries: week,
    portions,
    titles,
    ingredientIdsOf: (recipeId: string) => ingredientIds.get(recipeId) ?? [],
    loading: loading || recipes.loading,
  };
}
