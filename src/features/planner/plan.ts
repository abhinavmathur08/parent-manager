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
import { addDays, daysBetween, inWeek, type PlanDate } from './week';

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
    (a.created_at ?? '\uffff').localeCompare(b.created_at ?? '\uffff') ||
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

/**
 * R-SERV-1 default servings for a new entry: the sum of the household people's default
 * portions, rounded up to the nearest ½. Null when no one would eat (or people aren't
 * known), so the caller can fall back.
 */
export function defaultServings(people: readonly PlanPerson[]): number | null {
  const total = people.reduce((sum, p) => sum + defaultPortion(p.ageBand).portions, 0);
  return total > 0 ? Math.ceil(total * 2) / 2 : null;
}

/** The position for a new entry at the end of a slot (FR-PLAN-4). */
export function nextPosition(entries: readonly PlanEntryRow[], date: PlanDate, slot: Slot): number {
  const live = entries.filter((e) => !e.deleted_at && e.date === date && e.slot === slot);
  return live.length ? Math.min(999, Math.max(...live.map((e) => e.position)) + 1) : 0;
}

/**
 * Recently planned household recipes, newest use first (FR-PLAN-3), then the most recently
 * changed recipes to fill up to `limit`.
 */
export function recentRecipeIds(
  entries: readonly PlanEntryRow[],
  recipes: readonly { id: string; updated_at: string | null; deleted_at: string | null }[],
  limit: number,
): string[] {
  const live = new Set(recipes.filter((r) => !r.deleted_at).map((r) => r.id));
  const stamp = (value: string | null) => value ?? '\uffff';
  const used = entries
    .filter((e) => !e.deleted_at && e.recipe_id && live.has(e.recipe_id))
    .sort((a, b) => stamp(b.updated_at).localeCompare(stamp(a.updated_at)))
    .map((e) => e.recipe_id as string);
  const changed = recipes
    .filter((r) => !r.deleted_at)
    .sort((a, b) => stamp(b.updated_at).localeCompare(stamp(a.updated_at)))
    .map((r) => r.id);
  return [...new Set([...used, ...changed])].slice(0, limit);
}

/** Whether a person can have a baby plate: the 6 to 12 month band (FR-PLAN-6). */
export function canHaveBabyPlate(ageBand: AgeBand): boolean {
  return ageBand === 'infant_6_12m';
}

/**
 * R-SERV-2: when portions per person are set, the entry's servings are their sum. Null when
 * no one eats, which an entry can't save (servings are above 0).
 */
export function servingsFromPortions(portions: Iterable<PersonPortion>): number | null {
  let total = 0;
  for (const p of portions) total += p.portions;
  return total > 0 ? total : null;
}

/** Whether anyone eats the entry from a baby plate, so the entry says so (FR-PLAN-6). */
export function hasBabyPlate(portions: Iterable<PersonPortion>): boolean {
  for (const p of portions) if (p.variant === 'baby_plate' && p.portions > 0) return true;
  return false;
}

/** R-SERV-2: an entry's quantity factor is its servings over the recipe's. */
export function quantityFactor(entryServings: number, recipeServings: number): number {
  return recipeServings > 0 ? entryServings / recipeServings : 0;
}

/**
 * What an entry asks of each recipe line, in base units (g, ml or each), scaled by R-SERV-2.
 * Lines without a base quantity ("a pinch") stay null. Free-text entries ask for nothing
 * (R-SERV-4). Leftover links (R-SERV-3) are the list engine's job (G-01.1, P-04).
 */
export function entryLineQuantities(
  entry: Pick<PlanEntryRow, 'recipe_id' | 'servings'>,
  recipe: { id: string; servings: number } | undefined,
  lines: readonly {
    recipe_id: string;
    ingredient_id: string;
    quantity_base: number | null;
    deleted_at: string | null;
  }[],
): { ingredientId: string; quantityBase: number | null }[] {
  if (!entry.recipe_id || !recipe || recipe.id !== entry.recipe_id) return [];
  const factor = quantityFactor(entry.servings, recipe.servings);
  return lines
    .filter((l) => l.recipe_id === recipe.id && !l.deleted_at)
    .map((l) => ({
      ingredientId: l.ingredient_id,
      quantityBase: l.quantity_base === null ? null : l.quantity_base * factor,
    }));
}

/** One entry to create when copying a week. */
export type WeekCopy = {
  source: PlanEntryRow;
  date: PlanDate;
  slot: Slot;
  position: number;
  /** The source entry this copy is leftovers of, when that entry is copied too. */
  leftoverOfSource: string | null;
};

/**
 * "Copy last week" (FR-PLAN-9): every live entry of the week starting on `sourceStart`, on
 * the same weekday and slot of the week starting on `targetStart`. Dates move by whole days,
 * so month ends and clock changes don't matter. Copies go after whatever stays in each slot
 * (`existing`). A leftover link survives when its entry is copied too; a link to an entry
 * outside the source week is dropped.
 */
export function planWeekCopy(
  rows: readonly PlanEntryRow[],
  sourceStart: PlanDate,
  targetStart: PlanDate,
  existing: readonly PlanEntryRow[],
): WeekCopy[] {
  const source = weekEntries(rows, sourceStart);
  const copied = new Set(source.map((e) => e.id));
  const shift = daysBetween(sourceStart, targetStart);
  const taken = [...existing];
  return source.map((entry) => {
    const date = addDays(entry.date, shift);
    const position = nextPosition(taken, date, entry.slot);
    taken.push({ ...entry, id: `copy:${entry.id}`, date, position, deleted_at: null });
    return {
      source: entry,
      date,
      slot: entry.slot,
      position,
      leftoverOfSource:
        entry.leftover_of_entry_id && copied.has(entry.leftover_of_entry_id)
          ? entry.leftover_of_entry_id
          : null,
    };
  });
}
