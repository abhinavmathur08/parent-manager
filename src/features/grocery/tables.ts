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

export const GROCERY_TABLES = [GROCERY_LISTS, GROCERY_ITEMS, GROCERY_ITEM_SOURCES] as const;

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
};

export type GroceryItemSourceRow = SyncRow & {
  item_id: string;
  plan_entry_id: string;
  recipe_ingredient_id: string;
  /** What this entry's line adds, in the item's base unit; null for no quantity. */
  quantity_base: number | null;
};
