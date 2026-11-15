import type { GroceryItemRow } from './tables';

/**
 * Shopping together (G-04.1, FR-LIST-9): when another member last changed the list, for the
 * "someone else is updating the list" banner. Pure, so it's tested without a screen.
 */

/** How long the banner stays after another member's change (FR-LIST-9, PROPOSED). */
export const PARTNER_ACTIVITY_MS = 60_000;

/**
 * How far the server's clock may be from this device's. Server times decide only whether a
 * change is recent enough to count at all; how long the banner stays is timed on the device.
 */
const CLOCK_SKEW_MS = 2 * 60_000;

/** What the last look at the list saw: each item's version. */
export type ListSnapshot = ReadonlyMap<string, number>;

export function listSnapshot(items: readonly GroceryItemRow[], listId: string): ListSnapshot {
  return new Map(items.filter((i) => i.list_id === listId).map((i) => [i.id, i.version]));
}

/**
 * The device time of the newest change by another member, or null for none.
 * - **First look** (`previous` null): items another member wrote in the last minute by the
 *   server's clock, so opening the list mid-shop shows the banner. The server time is taken
 *   as it is, but never later than now.
 * - **After that:** any item whose version moved on since the last look, written by another
 *   member, counts as changed now, as long as the server's time for it is recent (a device
 *   coming back online pulls old changes too).
 */
export function partnerChangeAt(input: {
  previous: ListSnapshot | null;
  items: readonly GroceryItemRow[];
  listId: string;
  /** The signed-in member. */
  me: string | null;
  now: number;
}): number | null {
  const { previous, now } = input;
  let latest: number | null = null;
  for (const item of input.items) {
    if (item.list_id !== input.listId || !item.updated_by || item.updated_by === input.me) {
      continue;
    }
    const server = item.updated_at ? Date.parse(item.updated_at) : NaN;
    if (!Number.isFinite(server)) continue;
    let at: number | null = null;
    if (previous === null) {
      const seen = Math.min(server, now);
      if (now - seen < PARTNER_ACTIVITY_MS) at = seen;
    } else if (
      (previous.get(item.id) ?? -1) < item.version &&
      now - server < PARTNER_ACTIVITY_MS + CLOCK_SKEW_MS
    ) {
      at = now;
    }
    if (at !== null && (latest === null || at > latest)) latest = at;
  }
  return latest;
}
