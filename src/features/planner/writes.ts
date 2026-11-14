import { randomUUID } from 'expo-crypto';
import { useCallback } from 'react';

import { useIngredients } from '@/features/ingredients/use-ingredients';
import { useApplyOps, useRecipeRows } from '@/features/recipes/data';
import { planSave } from '@/features/recipes/draft';
import { findStarter } from '@/features/recipes/starter/library';
import { copyStarter } from '@/features/recipes/starter/view';
import type { AppLocale } from '@/i18n';
import { useSyncWriter } from '@/lib/sync';

import { track } from '@/lib/analytics';
import {
  PLAN_ENTRIES,
  PLAN_ENTRY_PORTIONS,
  portionId,
  type PlanEntryPortionRow,
  type PlanEntryRow,
  type Slot,
} from './tables';
import type { WeekCopy } from './plan';
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
      track('plan_entry_added', {
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

/** Copies an entry, with its portions, to another day or slot (FR-PLAN-7, FR-PLAN-9). */
export async function copyEntry(
  writer: ReturnType<typeof useSyncWriter>,
  entry: PlanEntryRow,
  portions: readonly PlanEntryPortionRow[],
  target: { date: PlanDate; slot: Slot; position: number; leftoverOf?: string | null },
): Promise<string> {
  const id = randomUUID();
  await writer.insert(PLAN_ENTRIES.name, id, {
    date: target.date,
    slot: target.slot,
    position: target.position,
    recipe_id: entry.recipe_id,
    free_text: entry.free_text,
    servings: entry.servings,
    leftover_of_entry_id: target.leftoverOf ?? null,
  });
  for (const portion of portions) {
    if (portion.entry_id !== entry.id || portion.deleted_at) continue;
    await writer.insert(PLAN_ENTRY_PORTIONS.name, portionId(id, portion.person_id), {
      entry_id: id,
      person_id: portion.person_id,
      portions: portion.portions,
      variant: portion.variant,
    });
  }
  return id;
}

/** Long-press actions on an entry (FR-PLAN-7). */
export function useEntryActions() {
  const writer = useSyncWriter();
  return {
    move: async (entry: PlanEntryRow, target: { date: PlanDate; slot: Slot; position: number }) => {
      await writer.update(PLAN_ENTRIES.name, entry.id, {
        date: target.date,
        slot: target.slot,
        position: target.position,
      });
      track('plan_entry_moved', {
        slot_changed: target.slot !== entry.slot,
        day_changed: target.date !== entry.date,
      });
    },
    duplicate: (
      entry: PlanEntryRow,
      portions: readonly PlanEntryPortionRow[],
      target: { date: PlanDate; slot: Slot; position: number },
    ) => copyEntry(writer, entry, portions, target),
    /** Removes entries for good. The server tombstones their portions. */
    remove: async (ids: readonly string[], options: { track?: boolean } = {}) => {
      for (const id of ids) {
        await writer.remove(PLAN_ENTRIES.name, id);
        if (options.track !== false) track('plan_entry_removed');
      }
    },
    writer,
  };
}

/**
 * Sets portions per person on an entry (FR-PLAN-5, FR-PLAN-6). Every person gets a row, so
 * the entry no longer follows the defaults, and the entry's servings become their sum
 * (R-SERV-2). Rows are never deleted; "not eating" is a portion of 0.
 */
export function useSetPortions() {
  const writer = useSyncWriter();
  return useCallback(
    async (
      entry: PlanEntryRow,
      portions: ReadonlyMap<string, { portions: number; variant: 'standard' | 'baby_plate' }>,
      rows: readonly PlanEntryPortionRow[],
    ) => {
      let servings = 0;
      let babyPlate = false;
      let eating = 0;
      for (const [personId, value] of portions) {
        servings += value.portions;
        if (value.portions > 0) eating += 1;
        if (value.variant === 'baby_plate' && value.portions > 0) babyPlate = true;
        const id = portionId(entry.id, personId);
        const existing = rows.find((r) => r.id === id && !r.deleted_at);
        if (!existing) {
          await writer.insert(PLAN_ENTRY_PORTIONS.name, id, {
            entry_id: entry.id,
            person_id: personId,
            portions: value.portions,
            variant: value.variant,
          });
        } else if (existing.portions !== value.portions || existing.variant !== value.variant) {
          await writer.update(PLAN_ENTRY_PORTIONS.name, id, {
            portions: value.portions,
            variant: value.variant,
          });
        }
      }
      if (servings <= 0) throw new Error('Someone has to eat the entry');
      if (servings !== entry.servings) {
        await writer.update(PLAN_ENTRIES.name, entry.id, { servings });
      }
      track('portions_set', { people_count: eating, has_baby_plate: babyPlate });
    },
    [writer],
  );
}

/** Changes an entry's servings directly (FR-PLAN-5). */
export function useSetServings() {
  const writer = useSyncWriter();
  return useCallback(
    (entry: PlanEntryRow, servings: number) =>
      writer.update(PLAN_ENTRIES.name, entry.id, { servings }),
    [writer],
  );
}

/**
 * Writes a week copy (FR-PLAN-9) and returns the new entry IDs. Copies are written in date
 * order, so a leftover link can point at a copy made just before it.
 */
export function useCopyWeek() {
  const writer = useSyncWriter();
  return useCallback(
    async (
      copies: readonly WeekCopy[],
      portions: readonly PlanEntryPortionRow[],
      mode: 'add' | 'replace',
    ): Promise<string[]> => {
      const ids = new Map<string, string>();
      for (const copy of copies) {
        const id = await copyEntry(writer, copy.source, portions, {
          date: copy.date,
          slot: copy.slot,
          position: copy.position,
          leftoverOf: copy.leftoverOfSource ? (ids.get(copy.leftoverOfSource) ?? null) : null,
        });
        ids.set(copy.source.id, id);
      }
      track('week_copied', { entries_count: copies.length, mode });
      return [...ids.values()];
    },
    [writer],
  );
}
