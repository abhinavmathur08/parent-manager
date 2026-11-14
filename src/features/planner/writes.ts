import { randomUUID } from 'expo-crypto';
import { useCallback } from 'react';

import { useIngredients } from '@/features/ingredients/use-ingredients';
import { useApplyOps, useRecipeRows } from '@/features/recipes/data';
import { planSave } from '@/features/recipes/draft';
import { findStarter } from '@/features/recipes/starter/library';
import { copyStarter } from '@/features/recipes/starter/view';
import type { AppLocale } from '@/i18n';
import { useSyncWriter } from '@/lib/sync';

import { trackPlanEvent } from './analytics';
import { PLAN_ENTRIES, type Slot } from './tables';
import type { PlanDate } from './week';

/** What goes into a slot (FR-PLAN-3). */
export type PlanChoice =
  | { kind: 'recipe'; recipeId: string }
  | { kind: 'starter'; key: string }
  | { kind: 'text'; text: string };

export type AddEntry = {
  date: PlanDate;
  slot: Slot;
  position: number;
  servings: number;
  choice: PlanChoice;
  via: 'recent' | 'search';
};

/**
 * Adds an entry through the sync layer, so it shows at once and syncs when online
 * (FR-PLAN-11). A starter recipe is saved as a household copy first, because entries only
 * reference household recipes; an existing copy of the same starter is reused.
 */
export function useAddEntry(locale: AppLocale) {
  const writer = useSyncWriter();
  const apply = useApplyOps();
  const ingredients = useIngredients(locale);
  const { recipes } = useRecipeRows();

  return useCallback(
    async ({ date, slot, position, servings, choice, via }: AddEntry): Promise<string> => {
      let recipeId: string | null = null;
      let freeText: string | null = null;
      if (choice.kind === 'recipe') {
        recipeId = choice.recipeId;
      } else if (choice.kind === 'text') {
        freeText = choice.text.trim();
      } else {
        const copy = recipes.find((r) => !r.deleted_at && r.library_recipe_id === choice.key);
        if (copy) {
          recipeId = copy.id;
        } else {
          const starter = findStarter(choice.key);
          if (!starter) throw new Error(`Unknown starter recipe ${choice.key}`);
          recipeId = randomUUID();
          await apply(
            planSave(null, copyStarter(starter, locale, randomUUID), {
              recipeId,
              locale,
              dimension: (id) => ingredients.dimension(id),
              origin: { sourceType: 'library', libraryRecipeId: starter.key },
            }),
          );
        }
      }
      const id = randomUUID();
      await writer.insert(PLAN_ENTRIES.name, id, {
        date,
        slot,
        position,
        recipe_id: recipeId,
        free_text: freeText,
        servings,
        leftover_of_entry_id: null,
      });
      trackPlanEvent('plan_entry_added', {
        slot,
        source:
          choice.kind === 'recipe'
            ? 'household_recipe'
            : choice.kind === 'starter'
              ? 'starter_recipe'
              : 'free_text',
        via,
      });
      return id;
    },
    [writer, apply, ingredients, recipes, locale],
  );
}
