import { useMemo } from 'react';

import {
  HOUSEHOLD_INGREDIENTS,
  type HouseholdIngredientRow,
} from '@/features/ingredients/household';
import { PANTRY_ITEMS, type PantryItemRow } from '@/features/pantry/tables';
import { useSyncedRows } from '@/lib/sync';

import { buildIngredientFacts } from './facts';
import {
  GROCERY_ITEM_SOURCES,
  GROCERY_ITEMS,
  GROCERY_LISTS,
  PURCHASE_EVENTS,
  type GroceryItemRow,
  type GroceryItemSourceRow,
  type GroceryListRow,
  type PurchaseEventRow,
} from './tables';

/** The household's lists, items, sources, pantry and purchases from the local copy (FR-LIST-11). */
export function useGroceryRows() {
  const lists = useSyncedRows<GroceryListRow>(GROCERY_LISTS.name);
  const items = useSyncedRows<GroceryItemRow>(GROCERY_ITEMS.name);
  const sources = useSyncedRows<GroceryItemSourceRow>(GROCERY_ITEM_SOURCES.name);
  const pantry = useSyncedRows<PantryItemRow>(PANTRY_ITEMS.name);
  const purchases = useSyncedRows<PurchaseEventRow>(PURCHASE_EVENTS.name);
  return {
    lists: lists.rows,
    items: items.rows,
    sources: sources.rows,
    pantry: pantry.rows,
    purchases: purchases.rows,
    loading:
      lists.loading || items.loading || sources.loading || pantry.loading || purchases.loading,
  };
}

/** Ingredient facts for the list: the bundled catalog plus the household's own ingredients. */
export function useListIngredientFacts() {
  const { rows, loading } = useSyncedRows<HouseholdIngredientRow>(HOUSEHOLD_INGREDIENTS.name);
  const facts = useMemo(() => buildIngredientFacts(rows), [rows]);
  return { facts, loading };
}
