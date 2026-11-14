import { PANTRY_ITEMS, type PantryItemRow } from '@/features/pantry/tables';
import { SLOTS, type Slot } from '@/features/planner/tables';
import type { SaveOp } from '@/features/recipes/draft';
import { isMeasured, unitChoices } from '@/features/recipes/units';
import {
  UNITS,
  type Dimension,
  type QuantityPart,
  type Region,
  type UnitId,
  type UnitSystem,
} from '@/i18n';

import { amountBase, type AddAmount } from './add-item';
import { stableId } from './stable-id';
import { GROCERY_ITEMS, type GroceryItemRow, type GroceryItemSourceRow } from './tables';
import { itemQuantity } from './view';

/**
 * Item detail (G-02.3, S-15): editing an item (FR-LIST-7), its sources (FR-LIST-12) and
 * "I already have this" (FR-PAN-4). Pure, so the rules are tested without a screen.
 */

export type EditField = 'quantity' | 'unit' | 'name';

/**
 * The units an item can be edited into. A plan item keeps its dimension, because the list
 * engine matches it to the plan by ingredient and dimension (R-LIST-2); a count has no unit.
 * A manual item can take any measured unit, or none.
 */
export function editUnits(
  item: Pick<GroceryItemRow, 'origin' | 'dimension'>,
  system: UnitSystem,
  region: Region,
): UnitId[] {
  const { primary, more } = unitChoices(system, region);
  const measured = [...primary, ...more].filter((id): id is UnitId => isMeasured(id));
  if (item.origin === 'manual') {
    return primary.filter((id): id is UnitId => isMeasured(id) && id !== 'unit.each');
  }
  if (item.dimension === null || item.dimension === 'count') return [];
  return measured.filter((id) => UNITS[id].dimension === item.dimension && id !== 'unit.each');
}

/** Whether the item's amount can be edited: a plan item with no quantity can't get one. */
export function canEditAmount(item: Pick<GroceryItemRow, 'origin' | 'dimension'>): boolean {
  return item.origin === 'manual' || item.dimension !== null;
}

/** The amount to prefill: the quantity as shown, in one unit (null unit for a count). */
export function editAmount(
  item: Pick<GroceryItemRow, 'dimension' | 'quantity_base' | 'display_unit_id'>,
  system: UnitSystem,
): AddAmount | null {
  const parts: QuantityPart[] | null = itemQuantity(item, system);
  if (!parts || item.quantity_base === null) return null;
  const unitId = parts[0].unitId;
  if (unitId === 'unit.each') return { quantity: parts[0].value, unitId: null };
  // "1 lb 4 oz" edits as 1.25 lb.
  const value = Math.round((item.quantity_base / UNITS[unitId].toBase) * 100) / 100;
  return { quantity: value, unitId };
}

/**
 * The write for an edit (FR-LIST-7): only what changed, and the item becomes user-modified,
 * so recalculation keeps it (R-LIST-4); the "plan changed" hint is cleared, since the member
 * has just looked at it. An ingredient item renamed back to nothing shows its ingredient's
 * name again. Returns null when nothing changed.
 */
export function planItemEdit(
  item: GroceryItemRow,
  edit: {
    /** The name typed, or undefined when the name field wasn't changed. */
    name?: string;
    amount: AddAmount | null;
    amountEdited: boolean;
  },
): { op: SaveOp; fields: EditField[] } | null {
  const values: Record<string, string | number | boolean | null> = {};
  const fields: EditField[] = [];

  if (edit.name !== undefined) {
    const name = edit.name.trim();
    const customName = item.ingredient_id ? name || null : name;
    if (customName !== item.custom_name && (customName || item.ingredient_id)) {
      values.custom_name = customName;
      fields.push('name');
    }
  }

  if (edit.amountEdited && canEditAmount(item)) {
    const next = edit.amount ? amountBase(edit.amount) : null;
    const dimension: Dimension | null = next?.dimension ?? null;
    if (item.origin === 'manual' || dimension === item.dimension) {
      const base = next?.base ?? null;
      const unit = edit.amount?.unitId ?? null;
      const quantityChanged =
        base === null || item.quantity_base === null
          ? base !== item.quantity_base
          : Math.abs(base - item.quantity_base) > 1e-6;
      if (quantityChanged) {
        values.quantity_base = base;
        values.dimension = dimension;
        fields.push('quantity');
      }
      if (unit !== item.display_unit_id) {
        values.display_unit_id = unit;
        fields.push('unit');
      }
    }
  }

  if (!fields.length) return null;
  values.user_modified = true;
  values.plan_changed = false;
  return { op: { kind: 'update', table: GROCERY_ITEMS.name, id: item.id, values }, fields };
}

/**
 * Removing an item. A member's deletion of a plan item keeps the `plan_quantity_base` it
 * covered, so the plan brings it back only when it needs more (FR-LIST-7, R-LIST-4).
 */
export function planItemDelete(item: GroceryItemRow): SaveOp[] {
  return [{ kind: 'remove', table: GROCERY_ITEMS.name, id: item.id }];
}

/** The ID of a "have" row, the same on every device; `index` counts earlier rows for it. */
export function haveId(
  householdId: string,
  ingredientId: string,
  weekStart: string,
  index: number,
): string {
  return stableId('pantry_have', householdId, ingredientId, weekStart, String(index));
}

/**
 * "I already have this" (FR-PAN-4, R-PAN-2): records "have" for the list's week, then takes
 * the item off the list. The item is removed as recalculation would remove it
 * (`plan_quantity_base` 0), so undoing "have" in the pantry puts a plan item back
 * (FR-PAN-5). An ingredient already marked "have" that week gets no second row.
 */
export function planHave(input: {
  householdId: string;
  item: GroceryItemRow;
  weekStart: string;
  pantry: readonly PantryItemRow[];
}): SaveOp[] {
  const { item, weekStart } = input;
  if (!item.ingredient_id) return [];
  const rows = input.pantry.filter(
    (r) =>
      r.status === 'have' &&
      r.ingredient_id === item.ingredient_id &&
      r.have_week_start === weekStart,
  );
  const ops: SaveOp[] = [];
  if (!rows.some((r) => !r.deleted_at)) {
    ops.push({
      kind: 'insert',
      table: PANTRY_ITEMS.name,
      id: haveId(input.householdId, item.ingredient_id, weekStart, rows.length),
      values: { ingredient_id: item.ingredient_id, status: 'have', have_week_start: weekStart },
    });
  }
  if (item.plan_quantity_base !== 0 && item.origin === 'plan') {
    ops.push({
      kind: 'update',
      table: GROCERY_ITEMS.name,
      id: item.id,
      values: { plan_quantity_base: 0 },
    });
  }
  ops.push({ kind: 'remove', table: GROCERY_ITEMS.name, id: item.id });
  return ops;
}

/** One source of an item (FR-LIST-12): which planned meal and recipe line it comes from. */
export type ItemSourceView = {
  id: string;
  date: string;
  slot: Slot;
  /** The recipe's title, or null if the device doesn't have the recipe. */
  recipeTitle: string | null;
  /** What the line adds, in the item's base unit; null for no quantity. */
  quantityBase: number | null;
};

const SLOT_ORDER = new Map<Slot, number>(SLOTS.map((slot, i) => [slot, i]));

/** An item's live sources, by day and slot. Sources whose entry is gone are left out. */
export function itemSources(
  itemId: string,
  sources: readonly GroceryItemSourceRow[],
  entries: readonly {
    id: string;
    date: string;
    slot: Slot;
    recipe_id: string | null;
    deleted_at: string | null;
  }[],
  recipes: readonly { id: string; title: string; deleted_at: string | null }[],
): ItemSourceView[] {
  const entryById = new Map(entries.filter((e) => !e.deleted_at).map((e) => [e.id, e]));
  const titles = new Map(recipes.filter((r) => !r.deleted_at).map((r) => [r.id, r.title]));
  return sources
    .filter((s) => s.item_id === itemId && !s.deleted_at && entryById.has(s.plan_entry_id))
    .map((s) => {
      const entry = entryById.get(s.plan_entry_id)!;
      return {
        id: s.id,
        date: entry.date,
        slot: entry.slot,
        recipeTitle: entry.recipe_id ? (titles.get(entry.recipe_id) ?? null) : null,
        quantityBase: s.quantity_base,
      };
    })
    .sort(
      (a, b) =>
        a.date.localeCompare(b.date) ||
        (SLOT_ORDER.get(a.slot) ?? 0) - (SLOT_ORDER.get(b.slot) ?? 0) ||
        (a.id < b.id ? -1 : 1),
    );
}
