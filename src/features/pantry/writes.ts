import { useCallback } from 'react';

import { useApplyOps } from '@/features/recipes/data';
import { track } from '@/lib/analytics';
import { useSyncWriter } from '@/lib/sync';

import { insertStable, planAddStaple, planRemoveStaple, planUndoHave, stapleId } from './pantry';
import { PANTRY_ITEMS, type PantryItemRow } from './tables';

/**
 * Pantry writes through the sync layer (G-03.2), so they show at once, work offline and reach
 * partners within seconds (FR-PAN-6). The server refuses staple changes from caregivers.
 */

/** Adds a staple (FR-PAN-2). Returns false when it was one already. */
export function useAddStaple(householdId: string) {
  const writer = useSyncWriter();
  const apply = useApplyOps();
  return useCallback(
    async (ingredientId: string, rows: readonly PantryItemRow[]) => {
      const planned = planAddStaple({ ingredientId, rows });
      if (!planned) return false;
      if (planned.kind === 'revive') await apply([planned.op]);
      else {
        await insertStable(
          writer,
          PANTRY_ITEMS.name,
          (index) => stapleId(householdId, ingredientId, index),
          planned.values,
        );
      }
      track('staple_added', { is_catalog_ingredient: !ingredientId.startsWith('ingredient.h.') });
      return true;
    },
    [apply, writer, householdId],
  );
}

/** Removes a staple (FR-PAN-2): kept as `hidden_staple`. */
export function useRemoveStaple() {
  const apply = useApplyOps();
  return useCallback(
    async (row: PantryItemRow) => {
      const ops = planRemoveStaple(row);
      if (!ops.length) return;
      await apply(ops);
      track('staple_removed');
    },
    [apply],
  );
}

/** Undoes "have" (FR-PAN-5), which puts the item back on the list. */
export function useUndoHave() {
  const apply = useApplyOps();
  return useCallback(
    async (row: PantryItemRow) => {
      const ops = planUndoHave(row);
      if (!ops.length) return;
      await apply(ops);
      track('have_undone');
    },
    [apply],
  );
}
