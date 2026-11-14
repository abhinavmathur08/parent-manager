import { useEffect, useSyncExternalStore } from 'react';

import type { PlanDate } from '@/features/planner/week';

import type { ReconcileSummary } from './reconcile';

/**
 * Small in-memory channels between the list keeper (mounted with the tabs) and the List
 * screen: which weeks are open on screen (FR-LIST-2), and what the last recalculation of a
 * list changed (the FR-LIST-3 summary). Nothing here is stored.
 */

const open = new Map<PlanDate, number>();
let openSnapshot: readonly PlanDate[] = [];
const openListeners = new Set<() => void>();

function setOpen(week: PlanDate, delta: number) {
  const count = (open.get(week) ?? 0) + delta;
  if (count > 0) open.set(week, count);
  else open.delete(week);
  openSnapshot = [...open.keys()].sort();
  for (const listener of openListeners) listener();
}

/** Marks a week's list as open on screen, so the keeper creates it (FR-LIST-2). */
export function useOpenListWeek(week: PlanDate | null): void {
  useEffect(() => {
    if (!week) return;
    setOpen(week, 1);
    return () => setOpen(week, -1);
  }, [week]);
}

/** The weeks open on screen. */
export function useOpenListWeeks(): readonly PlanDate[] {
  return useSyncExternalStore(
    (notify) => {
      openListeners.add(notify);
      return () => openListeners.delete(notify);
    },
    () => openSnapshot,
  );
}

export type ListUpdated = {
  /** The list recalculated, or null when "Regenerate" found nothing to change. */
  listId: string | null;
  summary: ReconcileSummary;
  /** The member asked for it ("Regenerate"), rather than a change to the plan. */
  regenerated: boolean;
};

const updateListeners = new Set<(update: ListUpdated) => void>();

/** Tells the List screen that this device just recalculated a list. */
export function emitListUpdated(update: ListUpdated): void {
  for (const listener of updateListeners) listener(update);
}

/** Listens for recalculations of the lists the screen shows. */
export function onListUpdated(listener: (update: ListUpdated) => void): () => void {
  updateListeners.add(listener);
  return () => {
    updateListeners.delete(listener);
  };
}

const regenerateListeners = new Set<() => void>();

/** Asks the keeper to recalculate now ("Regenerate", FR-LIST-3), with the same rules. */
export function requestRegenerate(): void {
  for (const listener of regenerateListeners) listener();
}

export function onRegenerate(listener: () => void): () => void {
  regenerateListeners.add(listener);
  return () => {
    regenerateListeners.delete(listener);
  };
}
