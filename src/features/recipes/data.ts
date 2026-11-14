import { useCallback, useMemo } from 'react';

import { useSyncedRows, useSyncWriter } from '@/lib/sync';

import type { SaveOp, SavedRecipe } from './draft';
import type { RecipeView } from './recipe-detail';
import {
  RECIPE_INGREDIENTS,
  RECIPE_STEPS,
  RECIPES,
  type RecipeIngredientRow,
  type RecipeRow,
  type RecipeStepRow,
} from './tables';

/** The household's recipes, lines and steps from the local copy, so they read offline (FR-REC-12). */
export function useRecipeRows() {
  const recipes = useSyncedRows<RecipeRow>(RECIPES.name);
  const lines = useSyncedRows<RecipeIngredientRow>(RECIPE_INGREDIENTS.name);
  const steps = useSyncedRows<RecipeStepRow>(RECIPE_STEPS.name);
  return {
    recipes: recipes.rows,
    lines: lines.rows,
    steps: steps.rows,
    loading: recipes.loading || lines.loading || steps.loading,
  };
}

/** One household recipe with its lines and steps, or null once loaded if it doesn't exist. */
export function useRecipe(id: string | undefined): {
  saved: SavedRecipe | null;
  loading: boolean;
} {
  const { recipes, lines, steps, loading } = useRecipeRows();
  const saved = useMemo(() => {
    const recipe = id ? recipes.find((r) => r.id === id) : undefined;
    if (!recipe) return null;
    return {
      recipe,
      lines: lines.filter((l) => l.recipe_id === id),
      steps: steps.filter((s) => s.recipe_id === id),
    };
  }, [id, recipes, lines, steps]);
  return { saved, loading };
}

/** Applies save operations through the sync layer, in order (H-06.3). */
export function useApplyOps() {
  const writer = useSyncWriter();
  return useCallback(
    async (ops: readonly SaveOp[]) => {
      for (const op of ops) {
        if (op.kind === 'remove') await writer.remove(op.table, op.id);
        else if (op.kind === 'insert') await writer.insert(op.table, op.id, op.values);
        else await writer.update(op.table, op.id, op.values);
      }
    },
    [writer],
  );
}

/** A saved household recipe as recipe detail (S-17) shows it. */
export function viewFromSaved({ recipe, lines, steps }: SavedRecipe): RecipeView {
  const byPosition = <T extends { position: number }>(rows: readonly T[]) =>
    [...rows].sort((a, b) => a.position - b.position);
  return {
    id: recipe.id,
    title: recipe.title,
    servings: recipe.servings,
    prepMinutes: recipe.prep_minutes,
    cookMinutes: recipe.cook_minutes,
    tags: recipe.tags,
    notes: recipe.notes,
    sourceType: recipe.source_type,
    sourceUrl: recipe.source_url,
    lines: byPosition(lines).map((l) => ({
      id: l.id,
      ingredientId: l.ingredient_id,
      quantity: l.quantity,
      unitId: l.unit_id,
      note: l.note,
      optional: l.optional,
    })),
    steps: byPosition(steps).map((s) => ({ id: s.id, text: s.text })),
  };
}
