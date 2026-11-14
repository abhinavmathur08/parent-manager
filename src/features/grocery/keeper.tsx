import { useEffect, useMemo, useRef } from 'react';

import { useHousehold } from '@/features/household/membership';
import { usePlanRows } from '@/features/planner/data';
import { todayIn } from '@/features/planner/week';
import { useApplyOps, useRecipeRows } from '@/features/recipes/data';
import { track } from '@/lib/analytics';
import { reportError } from '@/lib/crash-reporting';
import { useSyncStatus } from '@/lib/sync';

import { useGroceryRows, useListIngredientFacts } from './data';
import { emitListUpdated, useOpenListWeeks } from './list-events';
import { weeklyListUpdates, type WeeklyInput } from './weekly';

/** How long to wait for a burst of changes (a week copy, a pull) to settle. */
const SETTLE_MS = 250;

/**
 * Keeps this week's and later weeks' lists in line with the plan, the recipes and the
 * pantry (FR-LIST-2, FR-LIST-3, R-LIST-4). It runs on the device, offline too, and writes
 * ordinary rows that sync (R-LIST-7). It waits while the local copy is still loading or a
 * sync is pulling rows in, so it never works from half a household. Mounted once, with
 * the tabs.
 */
export function GroceryListKeeper() {
  useGroceryKeeper();
  return null;
}

function useGroceryKeeper() {
  const { state } = useHousehold();
  const status = useSyncStatus();
  const plan = usePlanRows();
  const recipes = useRecipeRows();
  const grocery = useGroceryRows();
  const { facts, loading: factsLoading } = useListIngredientFacts();
  const openWeeks = useOpenListWeeks();
  const apply = useApplyOps();

  const membership = state.status === 'member' ? state.membership : null;
  const ready =
    membership !== null &&
    !status.firstLoad &&
    (status.state === 'idle' || status.state === 'offline') &&
    !plan.loading &&
    !recipes.loading &&
    !grocery.loading &&
    !factsLoading;

  const input = useMemo<WeeklyInput | null>(
    () =>
      ready && membership
        ? {
            householdId: membership.householdId,
            today: todayIn(membership.timezone ?? null),
            weekStartDay: membership.weekStart,
            entries: plan.entries,
            recipes: recipes.recipes,
            lines: recipes.lines,
            ingredients: facts,
            pantry: grocery.pantry,
            lists: grocery.lists,
            items: grocery.items,
            sources: grocery.sources,
            openWeeks,
          }
        : null,
    [
      ready,
      membership,
      plan.entries,
      recipes.recipes,
      recipes.lines,
      facts,
      grocery.pantry,
      grocery.lists,
      grocery.items,
      grocery.sources,
      openWeeks,
    ],
  );
  const latest = useRef<WeeklyInput | null>(null);
  useEffect(() => {
    latest.current = input;
  }, [input]);
  const queue = useRef<Promise<void>>(Promise.resolve());
  // The rows the last writes were worked out from. Until the local copy has re-read the
  // list's rows, working them out again would repeat those writes.
  const written = useRef<WeeklyInput | null>(null);

  useEffect(() => {
    if (!input) return;
    const timer = setTimeout(() => {
      queue.current = queue.current.then(async () => {
        // Work from the newest rows, which may have moved on while this waited.
        const now = latest.current;
        const last = written.current;
        if (!now) return;
        if (
          last &&
          last.lists === now.lists &&
          last.items === now.items &&
          last.sources === now.sources
        ) {
          return;
        }
        try {
          const updates = weeklyListUpdates(now);
          if (updates.length) written.current = now;
          for (const update of updates) {
            await apply(update.ops);
            const { needs } = update;
            track('list_generated', {
              item_count: needs.needs.length,
              merged_count: needs.mergedCount,
              staples_excluded_count: needs.staples.length,
              have_excluded_count: needs.have.length,
              trigger: update.created ? 'auto' : 'plan_change',
            });
            emitListUpdated({ listId: update.listId, summary: update.summary });
          }
        } catch (error) {
          reportError(error);
        }
      });
    }, SETTLE_MS);
    return () => clearTimeout(timer);
  }, [input, apply]);
}
