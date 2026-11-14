import type { SaveOp } from '@/features/recipes/draft';
import type { SyncValue } from '@/lib/sync/types';

import { needKey, type Need, type NeedSource } from './engine';
import { stableId } from './stable-id';
import {
  GROCERY_ITEM_SOURCES,
  GROCERY_ITEMS,
  type GroceryItemRow,
  type GroceryItemSourceRow,
} from './tables';

/**
 * The grocery list engine, part 2 (G-01.2): bring a list's rows in line with what the plan
 * needs without undoing what members did (spec R-LIST-4, R-LIST-5, FR-LIST-3, FR-LIST-7).
 *
 * For each ingredient and dimension group, with N the plan's need:
 * - **Covered already:** checked items and items a member deleted keep covering the
 *   `plan_quantity_base` they had. They never change (a checked item stays as it was).
 * - **A user-modified item** keeps its quantity. It takes the rest of the need as its
 *   `plan_quantity_base` and new sources, and gets the "plan changed" hint when that moves.
 * - **Otherwise** the rest of the need goes on one unchecked, unmodified item: updated if
 *   there is one, created if not. So more eggs after eggs were checked off is a new item
 *   for the difference, and a deleted item comes back only for a rise since the deletion.
 * - **Nothing left to cover** (the group's entries removed, or now a staple or "have"):
 *   unchecked, unmodified items are deleted, marked with `plan_quantity_base` 0 so a later
 *   need brings them back. Checked and user-modified items stay.
 * - **Manual items** are never changed, except two manual rows of the same catalog
 *   ingredient (added offline on two devices), which merge into one (R-LIST-5).
 *
 * Pure and deterministic: rows the engine creates get IDs worked out from the list, the
 * group and how many rows the group has had, so two devices recalculating the same list
 * write the same rows (R-LIST-7, NFR-OFF-5).
 */

export type ReconcileInput = {
  listId: string;
  /** What the plan needs this week (`weekNeeds`). */
  needs: readonly Need[];
  /** Every item row of the list on this device, tombstones included. */
  items: readonly GroceryItemRow[];
  /** Every source row of the list's items on this device. */
  sources: readonly GroceryItemSourceRow[];
};

/** What changed, for the summary shown while the list is open (FR-LIST-3). */
export type ReconcileSummary = { added: number; changed: number; removed: number };

export type ReconcileResult = { ops: SaveOp[]; summary: ReconcileSummary };

/** Below this (in g, ml or each) two quantities are the same. */
const EPSILON = 1e-6;

const byId = <T extends { id: string }>(a: T, b: T) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/** The ID of a generated item: the list, its group and how many rows the group has had. */
export function generatedItemId(listId: string, key: string, index: number): string {
  return stableId('grocery_item', listId, key, String(index));
}

/**
 * The ID of the source row linking an item to one entry's recipe line. `index` counts the
 * rows that link has had, so a link removed (a tombstone, which never changes) and needed
 * again gets a new row.
 */
export function itemSourceId(itemId: string, entryId: string, lineId: string, index = 0): string {
  return stableId('grocery_item_source', itemId, entryId, lineId, String(index));
}

/** The group an item belongs to, as `needKey` names it. */
export function itemKey(item: Pick<GroceryItemRow, 'ingredient_id' | 'dimension'>): string | null {
  return item.ingredient_id ? needKey(item.ingredient_id, item.dimension) : null;
}

export function reconcileList(input: ReconcileInput): ReconcileResult {
  const { listId } = input;
  const ops: SaveOp[] = [];
  const summary: ReconcileSummary = { added: 0, changed: 0, removed: 0 };
  const items = input.items.filter((i) => i.list_id === listId);
  const needs = new Map(input.needs.map((n) => [n.key, n]));

  const generated = new Map<string, GroceryItemRow[]>();
  for (const item of items) {
    const key = item.origin === 'plan' ? itemKey(item) : null;
    if (!key) continue;
    const group = generated.get(key);
    if (group) group.push(item);
    else generated.set(key, [item]);
  }
  const sourcesOf = new Map<string, GroceryItemSourceRow[]>();
  for (const source of input.sources) {
    const list = sourcesOf.get(source.item_id);
    if (list) list.push(source);
    else sourcesOf.set(source.item_id, [source]);
  }

  const update = (item: GroceryItemRow, values: Record<string, SyncValue>) => {
    const changed = Object.fromEntries(
      Object.entries(values).filter(([column, value]) => item[column] !== value),
    );
    if (Object.keys(changed).length)
      ops.push({ kind: 'update', table: GROCERY_ITEMS.name, id: item.id, values: changed });
  };
  const remove = (item: GroceryItemRow) => {
    if (item.plan_quantity_base !== 0) update(item, { plan_quantity_base: 0 });
    ops.push({ kind: 'remove', table: GROCERY_ITEMS.name, id: item.id });
    summary.removed += 1;
  };
  const setSources = (itemId: string, wanted: readonly NeedSource[]) => {
    const link = (entryId: string, lineId: string) => `${entryId}|${lineId}`;
    const rows = sourcesOf.get(itemId) ?? [];
    const live = new Map(
      rows
        .filter((r) => !r.deleted_at)
        .map((r) => [link(r.plan_entry_id, r.recipe_ingredient_id), r]),
    );
    for (const source of wanted) {
      const key = link(source.entryId, source.lineId);
      const row = live.get(key);
      live.delete(key);
      if (!row) {
        const index = rows.filter(
          (r) => r.plan_entry_id === source.entryId && r.recipe_ingredient_id === source.lineId,
        ).length;
        ops.push({
          kind: 'insert',
          table: GROCERY_ITEM_SOURCES.name,
          id: itemSourceId(itemId, source.entryId, source.lineId, index),
          values: {
            item_id: itemId,
            plan_entry_id: source.entryId,
            recipe_ingredient_id: source.lineId,
            quantity_base: source.quantityBase,
          },
        });
      } else if (!same(row.quantity_base, source.quantityBase)) {
        ops.push({
          kind: 'update',
          table: GROCERY_ITEM_SOURCES.name,
          id: row.id,
          values: { quantity_base: source.quantityBase },
        });
      }
    }
    for (const row of [...live.values()].sort(byId)) {
      ops.push({ kind: 'remove', table: GROCERY_ITEM_SOURCES.name, id: row.id });
    }
  };
  const create = (key: string, index: number, need: Need, quantity: number | null) => {
    const id = generatedItemId(listId, key, index);
    ops.push({
      kind: 'insert',
      table: GROCERY_ITEMS.name,
      id,
      values: {
        list_id: listId,
        ingredient_id: need.ingredientId,
        custom_name: null,
        dimension: need.dimension,
        quantity_base: quantity,
        display_unit_id: null,
        section_id: need.sectionId,
        origin: 'plan',
        plan_quantity_base: quantity,
        user_modified: false,
        plan_changed: false,
        checked: false,
      },
    });
    setSources(id, need.sources);
    summary.added += 1;
  };

  const keys = [...new Set([...needs.keys(), ...generated.keys()])].sort();
  for (const key of keys) {
    const need = needs.get(key);
    const rows = [...(generated.get(key) ?? [])].sort(byId);
    const live = rows.filter((r) => !r.deleted_at);
    const deleted = rows.filter((r) => r.deleted_at);
    const checked = live.filter((r) => r.checked);
    const modified = live.filter((r) => !r.checked && r.user_modified);
    const plain = live.filter((r) => !r.checked && !r.user_modified);
    const wanted = need?.sources ?? [];

    if (key.endsWith('|none')) {
      // No quantity (R-ING-4): needed or not. A member's deletion has plan_quantity_base null.
      const covered = checked.length > 0 || deleted.some((r) => r.plan_quantity_base === null);
      if (modified[0]) setSources(modified[0].id, wanted);
      if (!need || modified.length || covered) {
        for (const item of plain) remove(item);
        continue;
      }
      const [keep, ...extra] = plain;
      for (const item of extra) remove(item);
      if (keep) setSources(keep.id, wanted);
      else create(key, rows.length, need, null);
      continue;
    }

    const needed = need?.quantityBase ?? 0;
    const [absorber, ...otherModified] = modified;
    const covered = [...checked, ...deleted, ...otherModified].reduce(
      (sum, r) => sum + (r.plan_quantity_base ?? 0),
      0,
    );
    const rest = needed - covered;

    if (absorber) {
      const share = Math.max(0, rest);
      const moved = !same(absorber.plan_quantity_base, share);
      update(absorber, {
        plan_quantity_base: share,
        plan_changed: absorber.plan_changed || moved,
      });
      if (moved && !absorber.plan_changed) summary.changed += 1;
      setSources(absorber.id, wanted);
      for (const item of plain) remove(item);
    } else if (rest > EPSILON && need) {
      const [keep, ...extra] = plain;
      for (const item of extra) remove(item);
      if (keep) {
        if (!same(keep.quantity_base, rest)) summary.changed += 1;
        update(keep, {
          quantity_base: rest,
          plan_quantity_base: rest,
          section_id: need.sectionId,
        });
        setSources(keep.id, wanted);
      } else {
        create(key, rows.length, need, rest);
      }
    } else {
      for (const item of plain) remove(item);
    }
  }

  mergeManualDuplicates(items, ops);
  return { ops, summary };
}

function same(a: number | null, b: number | null): boolean {
  if (a === null || b === null) return a === b;
  return Math.abs(a - b) <= EPSILON;
}

/**
 * R-LIST-5: two live, unchecked manual rows of the same catalog or household ingredient and
 * dimension, such as milk added offline by both partners, merge into the row with the
 * lower ID (the same choice on every device), summing their quantities.
 */
function mergeManualDuplicates(items: readonly GroceryItemRow[], ops: SaveOp[]) {
  const groups = new Map<string, GroceryItemRow[]>();
  for (const item of items) {
    if (item.origin !== 'manual' || item.deleted_at || item.checked) continue;
    const key = itemKey(item);
    if (!key) continue;
    const group = groups.get(key);
    if (group) group.push(item);
    else groups.set(key, [item]);
  }
  for (const key of [...groups.keys()].sort()) {
    const [keep, ...rest] = (groups.get(key) as GroceryItemRow[]).sort(byId);
    if (!rest.length) continue;
    const quantities = [keep, ...rest]
      .map((r) => r.quantity_base)
      .filter((q): q is number => q !== null);
    const total = quantities.length ? quantities.reduce((a, b) => a + b, 0) : null;
    if (!same(keep.quantity_base, total)) {
      ops.push({
        kind: 'update',
        table: GROCERY_ITEMS.name,
        id: keep.id,
        values: { quantity_base: total },
      });
    }
    for (const item of rest) ops.push({ kind: 'remove', table: GROCERY_ITEMS.name, id: item.id });
  }
}
