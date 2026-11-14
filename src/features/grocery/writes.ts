import { useCallback } from 'react';

import { useOnline } from '@/hooks/use-online';
import { track } from '@/lib/analytics';
import { useSyncWriter } from '@/lib/sync';

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
