import { randomUUID } from 'expo-crypto';
import { useCallback } from 'react';

import { insertStable } from '@/features/pantry/pantry';
import { PANTRY_ITEMS, type PantryItemRow } from '@/features/pantry/tables';
import { useApplyOps } from '@/features/recipes/data';

import { useOnline } from '@/hooks/use-online';
import { track } from '@/lib/analytics';
import { useSyncWriter } from '@/lib/sync';

import { planAddItem, type AddAmount, type AddChoice, type AddResult } from './add-item';
import { haveId, planHave, planItemDelete, planItemEdit } from './detail';
import { GROCERY_ITEMS, type GroceryItemRow } from './tables';

/** Unchecking within this long counts as undoing a mistake (FR-LIST-8, PROPOSED). */
export const UNDO_WINDOW_MS = 10 * 60 * 1000;

/**
 * Checks an item off or back on through the sync layer, so it shows at once and works
 * offline (FR-LIST-8, FR-LIST-11, NFR-PERF-2). The server records who and when.
 */
export function useToggleItem() {
  const writer = useSyncWriter();
  const online = useOnline();
  return useCallback(
    async (item: GroceryItemRow, checked: boolean, now: number = Date.now()) => {
      await writer.update(GROCERY_ITEMS.name, item.id, { checked });
      if (checked) {
        track('list_item_checked', { offline: !online, section_id: item.section_id });
      } else {
        const at = item.checked_at ? Date.parse(item.checked_at) : NaN;
        track('list_item_unchecked', {
          within_undo_window: Number.isFinite(at) && now - at <= UNDO_WINDOW_MS,
        });
      }
    },
    [writer, online],
  );
}

/**
 * Adds a manual item (FR-LIST-6): a new row, or the amount merged into the same ingredient
 * already on the list (R-LIST-5). Returns what happened, for the confirmation.
 */
export function useAddItem() {
  const apply = useApplyOps();
  return useCallback(
    async (input: {
      listId: string;
      items: readonly GroceryItemRow[];
      choice: AddChoice;
      amount: AddAmount | null;
      source: 'typed' | 'suggestion_catalog' | 'assumed_at_home';
    }): Promise<AddResult> => {
      const result = planAddItem({ ...input, newId: randomUUID() });
      if (result.kind !== 'exists') await apply([result.op]);
      track('list_item_added', {
        source: input.source,
        merged_into_existing: result.kind !== 'insert',
      });
      if (input.source === 'assumed_at_home') track('staple_added_to_list');
      return result;
    },
    [apply],
  );
}

/** Saves an edit from item detail (FR-LIST-7): the item becomes user-modified. */
export function useEditItem() {
  const apply = useApplyOps();
  return useCallback(
    async (item: GroceryItemRow, edit: Parameters<typeof planItemEdit>[1]) => {
      const planned = planItemEdit(item, edit);
      if (!planned) return false;
      await apply([planned.op]);
      for (const field of planned.fields) track('list_item_edited', { field });
      return true;
    },
    [apply],
  );
}

/** "I already have this" from item detail (FR-PAN-4): "have" for the week, item off the list. */
export function useMarkHave(householdId: string) {
  const apply = useApplyOps();
  const writer = useSyncWriter();
  return useCallback(
    async (item: GroceryItemRow, weekStart: string, pantry: readonly PantryItemRow[]) => {
      for (const op of planHave({ householdId, item, weekStart, pantry })) {
        // An undone "have" left a tombstone under the first ID, so a second "have" for the
        // same ingredient and week takes the next one (G-03.2).
        if (op.kind === 'insert' && op.table === PANTRY_ITEMS.name && item.ingredient_id) {
          const ingredientId = item.ingredient_id;
          await insertStable(
            writer,
            op.table,
            (index) => haveId(householdId, ingredientId, weekStart, index),
            op.values as Record<string, string>,
          );
        } else {
          await apply([op]);
        }
      }
      track('have_marked', { surface: 'list' });
    },
    [apply, writer, householdId],
  );
}

/** Deletes an item (FR-LIST-7). The caller holds it back behind the undo bar first. */
export function useDeleteItem() {
  const apply = useApplyOps();
  return useCallback(
    async (item: GroceryItemRow) => {
      await apply(planItemDelete(item));
      track('list_item_deleted', { origin: item.origin });
    },
    [apply],
  );
}
