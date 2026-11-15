import type { SyncRow, SyncTableDefinition } from '@/lib/sync/types';

import { stableId } from './stable-id';
import type { GroceryItemRow, PurchaseEventRow } from './tables';

/**
 * Frequently bought suggestions (G-09; FR-MEM-3 to FR-MEM-5, R-MEM-2, R-MEM-3), worked out on
 * the device from the household's purchase events, so they work offline. Pure apart from the
 * table definition, so the ranking is tested without a screen.
 */

/** Ingredients a member asked not to see for 90 days (FR-MEM-5). Synced. */
export const FREQUENT_SUGGESTION_HIDES = {
  name: 'frequent_suggestion_hides',
  columns: {
    ingredient_id: 'text',
    hidden_until: 'text',
  },
} as const satisfies SyncTableDefinition;

export type FrequentSuggestionHideRow = SyncRow & {
  ingredient_id: string;
  /** Set by the server: 90 days from the last "don't suggest". */
  hidden_until: string;
};

/** At most this many suggestions (FR-MEM-3, PROPOSED). */
export const MAX_FREQUENT = 8;
/** Purchases count for this long (R-MEM-2, PROPOSED: 8 weeks). */
export const FREQUENT_WINDOW_MS = 56 * 24 * 60 * 60 * 1000;
/** How long "don't suggest" lasts (FR-MEM-5, PROPOSED). */
export const HIDE_MS = 90 * 24 * 60 * 60 * 1000;
/** An item qualifies once it's been bought this many times in the window (R-MEM-2). */
export const MIN_PURCHASES = 2;

/** The ID of an ingredient's "don't suggest" row, the same on every device. */
export function hideId(householdId: string, ingredientId: string, index: number): string {
  return stableId('frequent_suggestion_hide', householdId, ingredientId, String(index));
}

/**
 * The household's frequently bought ingredients, most bought first (R-MEM-2): purchase
 * events in the last 8 weeks, ingredients bought at least twice, ties broken by the most
 * recent purchase. Left out (R-MEM-3): ingredients already unchecked on the current list,
 * staples, and ingredients hidden with "don't suggest". Free-text items have no ingredient
 * ID to count across lists, so they're never suggested (names are never matched as text).
 */
export function frequentlyBought(input: {
  events: readonly PurchaseEventRow[];
  /** The current list's items. */
  items: readonly GroceryItemRow[];
  listId: string;
  staples: ReadonlySet<string>;
  hides: readonly FrequentSuggestionHideRow[];
  now: number;
}): string[] {
  const { now } = input;
  const onList = new Set(
    input.items
      .filter((i) => i.list_id === input.listId && !i.deleted_at && !i.checked && !i.shopped_at)
      .map((i) => i.ingredient_id)
      .filter((id): id is string => id !== null),
  );
  const hidden = new Set(
    input.hides
      .filter((h) => !h.deleted_at && Date.parse(h.hidden_until) > now)
      .map((h) => h.ingredient_id),
  );

  const counts = new Map<string, { count: number; latest: number }>();
  for (const event of input.events) {
    if (event.deleted_at || !event.ingredient_id) continue;
    const at = Date.parse(event.occurred_at);
    if (!Number.isFinite(at) || now - at > FREQUENT_WINDOW_MS) continue;
    const entry = counts.get(event.ingredient_id) ?? { count: 0, latest: 0 };
    entry.count += 1;
    entry.latest = Math.max(entry.latest, at);
    counts.set(event.ingredient_id, entry);
  }

  return [...counts.entries()]
    .filter(
      ([id, { count }]) =>
        count >= MIN_PURCHASES && !onList.has(id) && !input.staples.has(id) && !hidden.has(id),
    )
    .sort(
      ([a, x], [b, y]) => y.count - x.count || y.latest - x.latest || (a < b ? -1 : a > b ? 1 : 0),
    )
    .slice(0, MAX_FREQUENT)
    .map(([id]) => id);
}
