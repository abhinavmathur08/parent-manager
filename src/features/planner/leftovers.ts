import { compareEntries } from './plan';
import { SLOTS, type PlanEntryRow, type Slot } from './tables';
import { addDays, startOfWeek, type PlanDate, type WeekStart } from './week';

/**
 * Leftover links (P-04, FR-PLAN-8, R-SERV-3). Entry B can be "leftovers of" an earlier entry A
 * in B's week or the week before. The list engine then scales A by A's servings plus B's and
 * asks nothing of B. A link never points at a later entry, so links can't form a loop.
 */

type Placed = Pick<PlanEntryRow, 'date' | 'slot'>;

const SLOT_ORDER = new Map<Slot, number>(SLOTS.map((slot, i) => [slot, i]));

/** Whether `a` comes before `b`: an earlier day, or an earlier slot the same day. */
export function isEarlier(a: Placed, b: Placed): boolean {
  if (a.date !== b.date) return a.date < b.date;
  return (SLOT_ORDER.get(a.slot) ?? 0) < (SLOT_ORDER.get(b.slot) ?? 0);
}

/** The first day an entry on `date` can link back to: the start of the week before its own. */
export function earliestLinkDate(date: PlanDate, weekStart: WeekStart): PlanDate {
  return addDays(startOfWeek(date, weekStart), -7);
}

/** Whether `entry` (as placed) may be leftovers of `target`. */
export function canLink(
  entry: Placed & { id: string },
  target: Placed & { id: string; deleted_at: string | null },
  weekStart: WeekStart,
): boolean {
  return (
    target.id !== entry.id &&
    !target.deleted_at &&
    isEarlier(target, entry) &&
    target.date >= earliestLinkDate(entry.date, weekStart)
  );
}

/** The entries `entry` can be leftovers of, nearest first. */
export function leftoverCandidates(
  entry: PlanEntryRow,
  entries: readonly PlanEntryRow[],
  weekStart: WeekStart,
): PlanEntryRow[] {
  return entries
    .filter((target) => canLink(entry, target, weekStart))
    .sort((a, b) => compareEntries(b, a));
}

/** The live entry `entry` is leftovers of, or null when it isn't linked or the link is broken. */
export function leftoverSource(
  entry: PlanEntryRow,
  entries: readonly PlanEntryRow[],
  weekStart: WeekStart,
): PlanEntryRow | null {
  if (!entry.leftover_of_entry_id) return null;
  const target = entries.find((e) => e.id === entry.leftover_of_entry_id);
  return target && canLink(entry, target, weekStart) ? target : null;
}

/**
 * The entries whose leftover link breaks if `moved` goes to `to`: its own link, and links to it
 * from entries that would no longer come after it (or would be more than a week after its week).
 */
export function linksBrokenByMove(
  moved: PlanEntryRow,
  to: Placed,
  entries: readonly PlanEntryRow[],
  weekStart: WeekStart,
): string[] {
  const placed = { ...moved, ...to };
  const broken: string[] = [];
  if (moved.leftover_of_entry_id) {
    const target = entries.find((e) => e.id === moved.leftover_of_entry_id);
    if (!target || !canLink(placed, target, weekStart)) broken.push(moved.id);
  }
  for (const entry of entries) {
    if (entry.deleted_at || entry.leftover_of_entry_id !== moved.id) continue;
    if (!canLink(entry, placed, weekStart)) broken.push(entry.id);
  }
  return broken;
}
