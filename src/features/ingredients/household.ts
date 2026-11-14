import type { Dimension } from '@/i18n';
import type { SyncRow, SyncTableDefinition } from '@/lib/sync/types';

import type { SectionId } from './catalog-ids';

/**
 * A household's own ingredients (FR-REC-5, R-ING-1), written on the device so "add as new
 * ingredient" works offline. The server publishes each row to `ingredients` and
 * `ingredient_names` (migration 20261112110000_household_ingredients_sync.sql).
 */
export const HOUSEHOLD_INGREDIENTS = {
  name: 'household_ingredients',
  columns: {
    name: 'text',
    locale: 'text',
    section_id: 'text',
    default_dimension: 'text',
  },
} as const satisfies SyncTableDefinition;

export type HouseholdIngredientRow = SyncRow & {
  name: string;
  locale: string;
  section_id: SectionId;
  default_dimension: Dimension;
};

/** The ingredient ID for a household ingredient row: `ingredient.h.` and its UUID as hex (R-01.1). */
export function householdIngredientId(rowId: string): string {
  return `ingredient.h.${rowId.replace(/-/g, '').toLowerCase()}`;
}
