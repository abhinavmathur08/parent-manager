import type { SyncRow, SyncTableDefinition } from '@/lib/sync/types';

/**
 * The pantry in the household sync layer (G-03.1, architecture section 3.2): staples, which
 * the list leaves off (FR-PAN-3), and "have" for one list week (FR-PAN-4, R-PAN-2). Plain
 * definitions with no app imports, so the two-device harness can use them too.
 */
export const PANTRY_ITEMS = {
  name: 'pantry_items',
  columns: {
    ingredient_id: 'text',
    status: 'text',
    have_week_start: 'text',
  },
} as const satisfies SyncTableDefinition;

export type PantryStatus = 'staple' | 'have' | 'hidden_staple';

export type PantryItemRow = SyncRow & {
  ingredient_id: string;
  status: PantryStatus;
  /** The list week a "have" applies to, `YYYY-MM-DD`; null for staples. */
  have_week_start: string | null;
};

/** The week's pantry for the list engine: live staples, and "have" for that week only. */
export function weekPantry(
  rows: readonly PantryItemRow[],
  weekStart: string,
): { staples: Set<string>; have: Set<string> } {
  const staples = new Set<string>();
  const have = new Set<string>();
  for (const row of rows) {
    if (row.deleted_at) continue;
    if (row.status === 'staple') staples.add(row.ingredient_id);
    else if (row.status === 'have' && row.have_week_start === weekStart)
      have.add(row.ingredient_id);
  }
  return { staples, have };
}
