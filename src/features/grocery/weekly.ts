import { weekPantry, type PantryItemRow } from '@/features/pantry/tables';
import { startOfWeek, type PlanDate, type WeekStart } from '@/features/planner/week';
import type { SaveOp } from '@/features/recipes/draft';

import {
  weekNeeds,
  type EngineEntry,
  type EngineLine,
  type EngineRecipe,
  type IngredientFacts,
  type WeekNeeds,
} from './engine';
import { reconcileList, type ReconcileSummary } from './reconcile';
import { stableId } from './stable-id';
import {
  GROCERY_LISTS,
  type GroceryItemRow,
  type GroceryItemSourceRow,
  type GroceryListRow,
} from './tables';

/**
 * The weekly list (G-01.3, FR-LIST-1, FR-LIST-2): which weeks have a list, and the writes
 * that bring each list in line with the plan (R-LIST-4). Pure, so it can be tested and gives
 * the same writes on every device for the same rows (R-LIST-7).
 */

/** The ID of a household's default list for a week, the same on every device. */
export function weekListId(householdId: string, weekStart: PlanDate): string {
  return stableId('grocery_list', householdId, weekStart);
}

export type WeeklyInput = {
  householdId: string;
  /** Today in the household's timezone. */
  today: PlanDate;
  weekStartDay: WeekStart;
  entries: readonly EngineEntry[];
  recipes: readonly EngineRecipe[];
  lines: readonly EngineLine[];
  ingredients: IngredientFacts;
  pantry: readonly PantryItemRow[];
  lists: readonly GroceryListRow[];
  items: readonly GroceryItemRow[];
  sources: readonly GroceryItemSourceRow[];
  /** Weeks that need a list now, such as the week the List tab shows (FR-LIST-2). */
  openWeeks: readonly PlanDate[];
};

export type ListUpdate = {
  weekStart: PlanDate;
  listId: string;
  /** Whether this update creates the list. */
  created: boolean;
  ops: SaveOp[];
  summary: ReconcileSummary;
  needs: WeekNeeds;
};

/**
 * The writes for every list from this week on. A week gets its list the first time it's
 * open in the List tab or has a planned recipe (FR-LIST-2); past weeks are history and are
 * left alone. Only lists with something to write are returned.
 */
export function weeklyListUpdates(input: WeeklyInput): ListUpdate[] {
  const current = startOfWeek(input.today, input.weekStartDay);
  const lists = new Map<PlanDate, GroceryListRow>();
  for (const list of input.lists) {
    if (!list.deleted_at && list.is_default && list.week_start >= current) {
      lists.set(list.week_start, list);
    }
  }
  const weeks = new Set<PlanDate>(lists.keys());
  for (const week of input.openWeeks) if (week >= current) weeks.add(week);
  for (const entry of input.entries) {
    if (!entry.deleted_at && entry.recipe_id && entry.date >= current) {
      weeks.add(startOfWeek(entry.date, input.weekStartDay));
    }
  }

  const updates: ListUpdate[] = [];
  for (const weekStart of [...weeks].sort()) {
    const existing = lists.get(weekStart);
    const listId = existing?.id ?? weekListId(input.householdId, weekStart);
    const needs = weekNeeds({
      entries: input.entries,
      recipes: input.recipes,
      lines: input.lines,
      weekStart,
      ingredients: input.ingredients,
      pantry: weekPantry(input.pantry, weekStart),
    });
    const { ops, summary } = reconcileList({
      listId,
      needs: needs.needs,
      items: input.items,
      sources: input.sources,
    });
    const created = !existing;
    if (created) {
      ops.unshift({
        kind: 'insert',
        table: GROCERY_LISTS.name,
        id: listId,
        values: { week_start: weekStart, is_default: true },
      });
    }
    if (ops.length) updates.push({ weekStart, listId, created, ops, summary, needs });
  }
  return updates;
}
