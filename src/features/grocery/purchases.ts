import type { SaveOp } from '@/features/recipes/draft';

import { stableId } from './stable-id';
import {
  GROCERY_ITEMS,
  PURCHASE_EVENTS,
  type GroceryItemRow,
  type PurchaseEventRow,
  type PurchaseSource,
} from './tables';

/**
 * Purchase events and "finish shopping" (G-04.2; FR-LIST-8, FR-LIST-10, FR-MEM-1, FR-MEM-2,
 * R-MEM-1). Events come only from check-offs and "finish shopping" in the app, at most one
 * live event per item. Pure, so the rules are tested without a screen.
 */

/** Unchecking within this long deletes the check-off's purchase event (FR-LIST-8, PROPOSED). */
export const UNDO_WINDOW_MS = 10 * 60 * 1000;

/**
 * The ID of an item's purchase event, the same on every device, so two partners checking the
 * same item off offline write one event. `index` skips IDs this device already holds (an
 * event deleted by an uncheck). The server keeps any other second event as a tombstone.
 */
export function purchaseEventId(itemId: string, index: number): string {
  return stableId('purchase_event', itemId, String(index));
}

/** An event to insert; its ID comes from `purchaseEventId`. */
export type NewPurchaseEvent = { itemId: string; values: Record<string, string | number | null> };

function liveEvent(
  item: Pick<GroceryItemRow, 'id'>,
  events: readonly PurchaseEventRow[],
): PurchaseEventRow | undefined {
  return events.find((e) => e.item_id === item.id && !e.deleted_at);
}

function newEvent(item: GroceryItemRow, source: PurchaseSource, now: number): NewPurchaseEvent {
  return {
    itemId: item.id,
    values: {
      list_id: item.list_id,
      item_id: item.id,
      ingredient_id: item.ingredient_id,
      dimension: item.quantity_base !== null ? item.dimension : null,
      quantity_base: item.quantity_base,
      occurred_at: new Date(now).toISOString(),
      source,
    },
  };
}

/** Checking an item off records a purchase, unless the item already has one (FR-MEM-1). */
export function planCheckEvent(
  item: GroceryItemRow,
  events: readonly PurchaseEventRow[],
  now: number,
): NewPurchaseEvent | null {
  return liveEvent(item, events) ? null : newEvent(item, 'checked_off', now);
}

/**
 * Unchecking within 10 minutes of the purchase is a mistake, so its event goes (FR-LIST-8,
 * R-MEM-1). Later, the purchase stands.
 */
export function planUncheckEvent(
  item: GroceryItemRow,
  events: readonly PurchaseEventRow[],
  now: number,
): SaveOp[] {
  const event = liveEvent(item, events);
  if (!event) return [];
  const at = Date.parse(event.occurred_at);
  if (!Number.isFinite(at) || now - at > UNDO_WINDOW_MS) return [];
  return [{ kind: 'remove', table: PURCHASE_EVENTS.name, id: event.id }];
}

/** The list's items that the List tab shows: live, and not yet moved to history. */
export function onListItems(items: readonly GroceryItemRow[], listId: string): GroceryItemRow[] {
  return items.filter((i) => i.list_id === listId && !i.deleted_at && !i.shopped_at);
}

export type FinishShopping = {
  /** Purchase events for checked items that don't have one yet (FR-LIST-10). */
  events: NewPurchaseEvent[];
  /** Moves the checked items to the week's history. */
  ops: SaveOp[];
  checkedCount: number;
  uncheckedCount: number;
  membersWhoChecked: number;
};

/**
 * "Finish shopping" (FR-LIST-10): records a purchase for each checked item that has none,
 * and moves the checked items into the week's history. Unchecked items stay on the list.
 */
export function planFinishShopping(input: {
  listId: string;
  items: readonly GroceryItemRow[];
  events: readonly PurchaseEventRow[];
  now: number;
}): FinishShopping {
  const showing = onListItems(input.items, input.listId);
  const checked = showing.filter((i) => i.checked);
  const stamp = new Date(input.now).toISOString();
  return {
    events: checked
      .filter((i) => !liveEvent(i, input.events))
      .map((i) => newEvent(i, 'confirmed', input.now)),
    ops: checked.map((i) => ({
      kind: 'update',
      table: GROCERY_ITEMS.name,
      id: i.id,
      // The server replaces the time with its own (20261116110000_finish_shopping.sql).
      values: { shopped_at: stamp },
    })),
    checkedCount: checked.length,
    uncheckedCount: showing.length - checked.length,
    membersWhoChecked: new Set(checked.map((i) => i.checked_by).filter(Boolean)).size,
  };
}
