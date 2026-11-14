import { randomUUID } from 'expo-crypto';
import { useCallback } from 'react';

import { useApplyOps } from '@/features/recipes/data';

import { useOnline } from '@/hooks/use-online';
import { track } from '@/lib/analytics';
import { useSyncWriter } from '@/lib/sync';

import { planAddItem, type AddAmount, type AddChoice, type AddResult } from './add-item';
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
      source: 'typed' | 'suggestion_catalog';
    }): Promise<AddResult> => {
      const result = planAddItem({ ...input, newId: randomUUID() });
      if (result.kind !== 'exists') await apply([result.op]);
      track('list_item_added', {
        source: input.source,
        merged_into_existing: result.kind !== 'insert',
      });
      return result;
    },
    [apply],
  );
}
