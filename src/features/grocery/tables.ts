import type { SectionId } from '@/features/ingredients/catalog-ids';
import type { Dimension } from '@/i18n';
import type { SyncRow, SyncTableDefinition } from '@/lib/sync/types';

/**
 * The grocery tables in the household sync layer (architecture section 3.2, spec section 5.4).
 * Plain definitions with no app imports, so the two-device harness can use them too.
 */
export const GROCERY_LISTS = {
  name: 'grocery_lists',
  columns: {
    week_start: 'text',
    is_default: 'boolean',
  },
} as const satisfies SyncTableDefinition;

export const GROCERY_ITEMS = {
  name: 'grocery_items',
  columns: {
    list_id: 'text',
    ingredient_id: 'text',
    custom_name: 'text',
    dimension: 'text',
    quantity_base: 'real',
    display_unit_id: 'text',
    section_id: 'text',
    origin: 'text',
    plan_quantity_base: 'real',
    user_modified: 'boolean',
    plan_changed: 'boolean',
    checked: 'boolean',
    checked_at: 'text',
    checked_by: 'text',
    updated_by: 'text',
    shopped_at: 'text',
  },
} as const satisfies SyncTableDefinition;

export const GROCERY_ITEM_SOURCES = {
  name: 'grocery_item_sources',
  columns: {
    item_id: 'text',
    plan_entry_id: 'text',
    recipe_ingredient_id: 'text',
    quantity_base: 'real',
  },
} as const satisfies SyncTableDefinition;

/** Purchase memory (FR-MEM-1, R-MEM-1): at most one live event per item, set by the device. */
export const PURCHASE_EVENTS = {
  name: 'purchase_events',
  columns: {
    list_id: 'text',
    item_id: 'text',
    ingredient_id: 'text',
    dimension: 'text',
    quantity_base: 'real',
    occurred_at: 'text',
    source: 'text',
    recorded_by: 'text',
  },
} as const satisfies SyncTableDefinition;

export const GROCERY_TABLES = [
  GROCERY_LISTS,
  GROCERY_ITEMS,
  GROCERY_ITEM_SOURCES,
  PURCHASE_EVENTS,
] as const;

export type GroceryListRow = SyncRow & {
  /** The first day of the list's week, `YYYY-MM-DD` (FR-LIST-1). */
  week_start: string;
  is_default: boolean;
};

export type ItemOrigin = 'plan' | 'manual';

export type GroceryItemRow = SyncRow & {
  list_id: string;
  /** A catalog or household ingredient, or null for a free-text item. */
  ingredient_id: string | null;
  /** The name of a free-text item, or a member's rename of an ingredient item (FR-LIST-7). */
  custom_name: string | null;
  /** Null for an item with no quantity. */
  dimension: Dimension | null;
  /** In g, ml or each. Null for an item with no quantity. */
  quantity_base: number | null;
  /** A unit a member chose to see the quantity in; null shows the household's system. */
  display_unit_id: string | null;
  section_id: SectionId;
  origin: ItemOrigin;
  /**
   * How much of the plan's need this item covers, in its base unit (R-LIST-4). Kept on a
   * member's deletion, so the plan only brings the item back when it needs more than that;
   * 0 on a deletion by recalculation. Null for manual items and no-quantity items.
   */
  plan_quantity_base: number | null;
  user_modified: boolean;
  /** The plan changed after a member edited the item (R-LIST-4, PROPOSED hint). */
  plan_changed: boolean;
  checked: boolean;
  checked_at: string | null;
  checked_by: string | null;
  /** The member whose write the server last took (G-04.1), for the partner-activity banner. */
  updated_by: string | null;
  /** When "finish shopping" moved the item to the week's history (FR-LIST-10); set by the server. */
  shopped_at: string | null;
};

export type GroceryItemSourceRow = SyncRow & {
  item_id: string;
  plan_entry_id: string;
  recipe_ingredient_id: string;
  /** What this entry's line adds, in the item's base unit; null for no quantity. */
  quantity_base: number | null;
};

export type PurchaseSource = 'checked_off' | 'confirmed' | 'receipt';

export type PurchaseEventRow = SyncRow & {
  list_id: string;
  item_id: string;
  /** The ingredient, or null for a free-text item, which the item ID stands for. */
  ingredient_id: string | null;
  dimension: Dimension | null;
  /** In g, ml or each; null for no quantity. */
  quantity_base: number | null;
  occurred_at: string;
  source: PurchaseSource;
  /** The member who bought it; set by the server. */
  recorded_by: string | null;
};
