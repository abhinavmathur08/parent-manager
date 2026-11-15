import { PLAN_ENTRIES } from '@/features/planner/tables';
import type { PlanDate } from '@/features/planner/week';

import type { SaveOp } from './draft';
import { RECIPES } from './tables';

/** What deleting a recipe needs to know about a plan entry. */
export type DeletionEntry = {
  id: string;
  date: string;
  recipe_id: string | null;
  free_text: string | null;
  deleted_at: string | null;
};

export type RecipeDeletion = {
  /** Every live entry that plans the recipe, past or upcoming. */
  affected: number;
  /** Live entries dated in the current week or later (FR-REC-11): the number the user sees. */
  upcoming: number;
  /** Writes, in order: each live entry that plans the recipe keeps its title, then the recipe goes. */
  ops: SaveOp[];
};

/**
 * Deleting a recipe (FR-REC-11, R-02.3). Every live entry that plans it, past or upcoming,
 * keeps the recipe's title as free text, so the plan isn't left with gaps and free text adds
 * nothing to the list (R-SERV-4). The recipe itself is a tombstone, so it syncs and an offline
 * device can't bring it back; the server tombstones its lines and steps, and snapshots any
 * entry that still points at it (a partner's offline add, for example).
 *
 * `from` is the first day of the current week: entries from then on count as upcoming.
 */
export function planRecipeDeletion(
  recipe: { id: string; title: string },
  entries: readonly DeletionEntry[],
  from: PlanDate,
): RecipeDeletion {
  const using = entries.filter((e) => !e.deleted_at && e.recipe_id === recipe.id);
  const ops: SaveOp[] = using.map((entry) => ({
    kind: 'update',
    table: PLAN_ENTRIES.name,
    id: entry.id,
    values: { recipe_id: null, free_text: entry.free_text ?? recipe.title },
  }));
  ops.push({ kind: 'remove', table: RECIPES.name, id: recipe.id });
  return { affected: using.length, upcoming: using.filter((e) => e.date >= from).length, ops };
}
