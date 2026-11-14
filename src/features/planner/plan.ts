import type { AllergenCode } from '@/features/ingredients/catalog-ids';
import type { AgeBand } from '@/features/people/codes';
import { allergenMatches, type AllergenMatch } from '@/features/recipes/scale';

import {
  BABY_PLATE_PORTION,
  SLOTS,
  type PlanEntryPortionRow,
  type PlanEntryRow,
  type PortionVariant,
  type Slot,
} from './tables';
import { inWeek, type PlanDate } from './week';

/** What the planner needs to know about someone the household feeds. */
export type PlanPerson = {
  id: string;
  displayName: string;
  ageBand: AgeBand;
  allergies: readonly AllergenCode[];
};

export type PersonPortion = { portions: number; variant: PortionVariant };

/**
 * R-SERV-1 default portions by age band (PROPOSED): adults and older children 1, preschool
 * and toddler ½, a baby plate (¼) from 6 to 12 months, and nothing under 6 months or while
 * expecting.
 */
export function defaultPortion(ageBand: AgeBand): PersonPortion {
  switch (ageBand) {
    case 'adult':
    case 'older_child':
      return { portions: 1, variant: 'standard' };
    case 'preschool':
    case 'toddler':
      return { portions: 0.5, variant: 'standard' };
    case 'infant_6_12m':
      return { portions: BABY_PLATE_PORTION, variant: 'baby_plate' };
    case 'infant_0_6m':
    case 'expecting':
      return { portions: 0, variant: 'standard' };
  }
}

/** Each person's portion on an entry: the one set on the entry, or their default (FR-PLAN-6). */
export function portionsFor(
  entryId: string,
  people: readonly PlanPerson[],
  portionRows: readonly PlanEntryPortionRow[],
): Map<string, PersonPortion> {
  const set = new Map(
    portionRows
      .filter((row) => row.entry_id === entryId && !row.deleted_at)
      .map((row) => [row.person_id, { portions: row.portions, variant: row.variant }]),
  );
  return new Map(people.map((p) => [p.id, set.get(p.id) ?? defaultPortion(p.ageBand)]));
}

/**
 * Allergen markers for an entry (FR-PLAN-11, FR-REC-9): allergens in the planned recipe for
 * people whose portion is above 0. Free-text entries have none.
 */
export function entryAllergens(
  entry: Pick<PlanEntryRow, 'id' | 'recipe_id'>,
  ingredientIdsOf: (recipeId: string) => readonly string[],
  allergensOf: (ingredientId: string) => readonly AllergenCode[],
  people: readonly PlanPerson[],
  portionRows: readonly PlanEntryPortionRow[],
): AllergenMatch[] {
  if (!entry.recipe_id) return [];
  const portions = portionsFor(entry.id, people, portionRows);
  const eating = people.filter((p) => (portions.get(p.id)?.portions ?? 0) > 0);
  return allergenMatches(ingredientIdsOf(entry.recipe_id), allergensOf, eating);
}

const SLOT_ORDER = new Map<Slot, number>(SLOTS.map((slot, i) => [slot, i]));

/** Entries in display order: by date, slot, position, then oldest first. */
export function compareEntries(a: PlanEntryRow, b: PlanEntryRow): number {
  return (
    a.date.localeCompare(b.date) ||
    (SLOT_ORDER.get(a.slot) ?? 0) - (SLOT_ORDER.get(b.slot) ?? 0) ||
    a.position - b.position ||
    (a.created_at ?? '￿').localeCompare(b.created_at ?? '￿') ||
    a.id.localeCompare(b.id)
  );
}

/** The live entries of the week starting on `start`, in display order. */
export function weekEntries(rows: readonly PlanEntryRow[], start: PlanDate): PlanEntryRow[] {
  return rows.filter((row) => !row.deleted_at && inWeek(row.date, start)).sort(compareEntries);
}

/** The entries of one day's slot, in display order. */
export function slotEntries(
  entries: readonly PlanEntryRow[],
  date: PlanDate,
  slot: Slot,
): PlanEntryRow[] {
  return entries.filter((e) => e.date === date && e.slot === slot);
}
