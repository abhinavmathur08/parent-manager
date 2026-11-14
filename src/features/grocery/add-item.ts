import type { SectionId } from '@/features/ingredients/catalog-ids';
import type { SaveOp } from '@/features/recipes/draft';
import { UNITS, type Dimension, type UnitId } from '@/i18n';

import { GROCERY_ITEMS, type GroceryItemRow } from './tables';

/**
 * Adding an item by hand (G-02.2, FR-LIST-6, R-LIST-5, R-LIST-6). Pure, so the merge rules
 * are tested without a screen.
 */

/** What the member picked: a catalog or household ingredient, or text as typed. */
export type AddChoice =
  | { kind: 'ingredient'; ingredientId: string; sectionId: SectionId }
  | { kind: 'text'; name: string; sectionId: SectionId };

/** An optional amount: the number typed and its unit (null for a plain count). */
export type AddAmount = { quantity: number; unitId: UnitId | null };

export type AddResult =
  /** A new manual row. */
  | { kind: 'insert'; op: SaveOp }
  /** The amount went onto an item already on the list. */
  | { kind: 'merge'; op: SaveOp; itemId: string }
  /** The ingredient is already on the list and no amount was given, so nothing changes. */
  | { kind: 'exists'; itemId: string };

/** An amount in base units (R-ING-3). No unit means a count ("2 milk" is two cartons). */
export function amountBase(amount: AddAmount): { dimension: Dimension; base: number } {
  if (!amount.unitId) return { dimension: 'count', base: amount.quantity };
  const unit = UNITS[amount.unitId];
  return { dimension: unit.dimension, base: amount.quantity * unit.toBase };
}

/**
 * Works out the write for a manual item:
 * - **Text** is always its own row, in the section the member chose (R-LIST-5, R-LIST-6).
 * - **An ingredient already on the list, unchecked, in the same dimension** gets the amount
 *   added. A generated item becomes user-modified, so recalculation keeps the new quantity
 *   (R-LIST-5); a manual one just grows.
 * - **An ingredient already on the list with no amount given** changes nothing.
 * - **Otherwise** a new manual row, with the unit kept for display.
 * Checked items and items without a quantity are never merged into: what's in the cart was
 * bought, and a no-quantity item belongs to the plan's "to taste" line.
 */
export function planAddItem(input: {
  listId: string;
  items: readonly GroceryItemRow[];
  choice: AddChoice;
  amount: AddAmount | null;
  newId: string;
}): AddResult {
  const { choice, amount } = input;
  const measured = amount ? amountBase(amount) : null;
  const insert = (): AddResult => ({
    kind: 'insert',
    op: {
      kind: 'insert',
      table: GROCERY_ITEMS.name,
      id: input.newId,
      values: {
        list_id: input.listId,
        ingredient_id: choice.kind === 'ingredient' ? choice.ingredientId : null,
        custom_name: choice.kind === 'text' ? choice.name.trim() : null,
        dimension: measured?.dimension ?? null,
        quantity_base: measured?.base ?? null,
        display_unit_id: amount?.unitId ?? null,
        section_id: choice.sectionId,
        origin: 'manual',
        plan_quantity_base: null,
        user_modified: false,
        plan_changed: false,
        checked: false,
      },
    },
  });
  if (choice.kind === 'text') return insert();

  const open = input.items
    .filter(
      (i) =>
        i.list_id === input.listId &&
        !i.deleted_at &&
        !i.checked &&
        i.ingredient_id === choice.ingredientId,
    )
    // Generated items first, then the oldest row, the same choice on every device.
    .sort((a, b) =>
      a.origin !== b.origin ? (a.origin === 'plan' ? -1 : 1) : a.id < b.id ? -1 : 1,
    );
  if (!measured) {
    return open.length ? { kind: 'exists', itemId: open[0].id } : insert();
  }
  const target = open.find((i) => i.dimension === measured.dimension && i.quantity_base !== null);
  if (!target) return insert();
  return {
    kind: 'merge',
    itemId: target.id,
    op: {
      kind: 'update',
      table: GROCERY_ITEMS.name,
      id: target.id,
      values:
        target.origin === 'plan'
          ? { quantity_base: (target.quantity_base ?? 0) + measured.base, user_modified: true }
          : { quantity_base: (target.quantity_base ?? 0) + measured.base },
    },
  };
}
