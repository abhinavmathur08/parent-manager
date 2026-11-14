import type { SectionId } from '@/features/ingredients/catalog-ids';
import { inWeek, type PlanDate } from '@/features/planner/week';
import { quantityFactor } from '@/features/planner/plan';
import { quantityBase } from '@/features/recipes/quantity';
import {
  displayQuantity,
  UNITS,
  type Dimension,
  type QuantityPart,
  type UnitId,
  type UnitSystem,
} from '@/i18n';

/**
 * The grocery list engine, part 1 (G-01.1): what a week's plan needs, merged by ingredient
 * (spec section 5.4, R-LIST-1 to R-LIST-3, R-UNIT-1, R-UNIT-2, R-SERV-2 to R-SERV-4,
 * architecture "How the grocery list is built").
 *
 * Pure functions with no side effects, so the list builds offline on the device that made
 * the change and gives the same result on every device for the same inputs (R-LIST-7).
 * Ingredients are compared by ID only, never by display text (R-ING-6). Quantities stay in
 * base units (g, ml or each); the household's unit system is applied only for display.
 */

/** What the engine reads from a plan entry. */
export type EngineEntry = {
  id: string;
  date: string;
  recipe_id: string | null;
  servings: number;
  leftover_of_entry_id: string | null;
  deleted_at: string | null;
};

/** What the engine reads from a recipe. */
export type EngineRecipe = { id: string; servings: number; deleted_at: string | null };

/** What the engine reads from a recipe line. */
export type EngineLine = {
  id: string;
  recipe_id: string;
  ingredient_id: string;
  quantity: number | null;
  unit_id: string | null;
  quantity_base: number | null;
  deleted_at: string | null;
};

/** What the engine needs to know about an ingredient, catalog or household. */
export type IngredientFacts = {
  /** The ingredient's default dimension (FR-REC-6). */
  dimension(id: string): Dimension;
  /** Grams per millilitre, or null when the catalog has none (R-UNIT-2). */
  density(id: string): number | null;
  section(id: string): SectionId;
};

/** The pantry for the list's week (R-LIST-3, R-PAN-2): staples and "have" ingredient IDs. */
export type WeekPantry = { staples: ReadonlySet<string>; have: ReadonlySet<string> };

/**
 * An item's dimension group (R-LIST-2): mass, volume or count, or null for an ingredient
 * that's needed with no quantity ("salt to taste", "a pinch", R-ING-4, R-ING-5).
 */
export type ItemDimension = Dimension | null;

/** One plan entry's recipe line behind an item (FR-LIST-12), in the item's base unit. */
export type NeedSource = { entryId: string; lineId: string; quantityBase: number | null };

/** One item the plan needs: an ingredient in one dimension, with its summed base quantity. */
export type Need = {
  /** `<ingredient ID>|<dimension or "none">`: the same on every device. */
  key: string;
  ingredientId: string;
  dimension: ItemDimension;
  /** Summed base quantity (g, ml or each); null for a no-quantity item. */
  quantityBase: number | null;
  sectionId: SectionId;
  sources: NeedSource[];
};

export type WeekNeeds = {
  /** Needed items in key order. */
  needs: Need[];
  /** Ingredients left off as staples, for the "assumed at home" row (FR-PAN-3). */
  staples: string[];
  /** Ingredients left off as "have" this week (FR-PAN-4). */
  have: string[];
  /** Items made from more than one recipe line, for `list_generated`. */
  mergedCount: number;
};

export type WeekInput = {
  /** Every plan entry the device has, so leftover links to other weeks resolve. */
  entries: readonly EngineEntry[];
  recipes: readonly EngineRecipe[];
  lines: readonly EngineLine[];
  /** The list's week (FR-LIST-1). */
  weekStart: PlanDate;
  ingredients: IngredientFacts;
  pantry: WeekPantry;
};

const NONE = 'none';

/** The key of an ingredient's item in one dimension group. */
export function needKey(ingredientId: string, dimension: ItemDimension): string {
  return `${ingredientId}|${dimension ?? NONE}`;
}

/**
 * Each live entry's servings once leftover links are applied (R-SERV-3). An entry that is
 * "leftovers of" a live entry adds its servings to the start of its chain and needs nothing
 * itself. A link to a removed entry is ignored. Following a chain stops at a loop.
 */
export function effectiveServings(entries: readonly EngineEntry[]): Map<string, number> {
  const live = new Map(entries.filter((e) => !e.deleted_at).map((e) => [e.id, e]));
  const rootOf = (entry: EngineEntry) => {
    const seen = new Set<string>([entry.id]);
    let current = entry;
    for (;;) {
      const next = current.leftover_of_entry_id
        ? live.get(current.leftover_of_entry_id)
        : undefined;
      if (!next || seen.has(next.id)) return current.id;
      seen.add(next.id);
      current = next;
    }
  };
  const servings = new Map<string, number>();
  for (const entry of live.values()) servings.set(entry.id, 0);
  for (const entry of live.values()) {
    const root = rootOf(entry);
    servings.set(root, (servings.get(root) ?? 0) + entry.servings);
  }
  return servings;
}

/** The dimension and base quantity of one line (R-ING-3 to R-ING-5). */
function lineAmount(
  line: EngineLine,
  ingredients: IngredientFacts,
): { dimension: ItemDimension; base: number | null } {
  const base =
    line.quantity_base ??
    quantityBase(line.quantity, line.unit_id, ingredients.dimension(line.ingredient_id));
  if (base === null) return { dimension: null, base: null };
  const unit = line.unit_id
    ? (UNITS[line.unit_id as UnitId] as (typeof UNITS)[UnitId] | undefined)
    : undefined;
  return { dimension: unit ? unit.dimension : 'count', base };
}

const byId = (a: { id: string }, b: { id: string }) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
const compareSources = (a: NeedSource, b: NeedSource) =>
  a.entryId < b.entryId
    ? -1
    : a.entryId > b.entryId
      ? 1
      : a.lineId < b.lineId
        ? -1
        : a.lineId > b.lineId
          ? 1
          : 0;

/**
 * What the week's plan needs (FR-LIST-1, R-LIST-1 to R-LIST-3):
 * 1. Each recipe entry dated in the week asks for its recipe's lines, scaled by its servings
 *    over the recipe's (R-SERV-2), with leftovers applied (R-SERV-3). Free text asks for
 *    nothing (R-SERV-4).
 * 2. Lines are grouped by ingredient and dimension and summed in base units (R-UNIT-1).
 * 3. Mass and volume of one ingredient merge into its default dimension only when the
 *    catalog has a density; otherwise they stay separate items, and count never merges with
 *    either (R-UNIT-2).
 * 4. A no-quantity line shows once per ingredient, and only when nothing measured is
 *    needed of it (R-ING-4).
 * 5. Staples and "have" ingredients are left off and reported (R-LIST-3, FR-PAN-3).
 */
export function weekNeeds(input: WeekInput): WeekNeeds {
  const { ingredients, pantry } = input;
  const servings = effectiveServings(input.entries);
  const recipes = new Map(input.recipes.filter((r) => !r.deleted_at).map((r) => [r.id, r]));
  const linesByRecipe = new Map<string, EngineLine[]>();
  for (const line of input.lines) {
    if (line.deleted_at || !recipes.has(line.recipe_id)) continue;
    const list = linesByRecipe.get(line.recipe_id);
    if (list) list.push(line);
    else linesByRecipe.set(line.recipe_id, [line]);
  }

  // ingredient ID -> dimension group -> sources
  const groups = new Map<string, Map<ItemDimension, NeedSource[]>>();
  const entries = input.entries
    .filter((e) => !e.deleted_at && e.recipe_id && inWeek(e.date, input.weekStart))
    .sort(byId);
  for (const entry of entries) {
    const recipe = recipes.get(entry.recipe_id as string);
    const effective = servings.get(entry.id) ?? 0;
    if (!recipe || effective <= 0) continue;
    const factor = quantityFactor(effective, recipe.servings);
    for (const line of linesByRecipe.get(recipe.id) ?? []) {
      const { dimension, base } = lineAmount(line, ingredients);
      let byDimension = groups.get(line.ingredient_id);
      if (!byDimension) groups.set(line.ingredient_id, (byDimension = new Map()));
      const source = {
        entryId: entry.id,
        lineId: line.id,
        quantityBase: base === null ? null : base * factor,
      };
      const list = byDimension.get(dimension);
      if (list) list.push(source);
      else byDimension.set(dimension, [source]);
    }
  }

  const needs: Need[] = [];
  const staples: string[] = [];
  const have: string[] = [];
  for (const ingredientId of [...groups.keys()].sort()) {
    if (pantry.staples.has(ingredientId)) {
      staples.push(ingredientId);
      continue;
    }
    if (pantry.have.has(ingredientId)) {
      have.push(ingredientId);
      continue;
    }
    const byDimension = mergeByDensity(
      groups.get(ingredientId) as Map<ItemDimension, NeedSource[]>,
      ingredients.dimension(ingredientId),
      ingredients.density(ingredientId),
    );
    const measured = [...byDimension.keys()].some((d) => d !== null);
    for (const [dimension, sources] of byDimension) {
      if (dimension === null && measured) continue;
      needs.push({
        key: needKey(ingredientId, dimension),
        ingredientId,
        dimension,
        quantityBase:
          dimension === null ? null : sources.reduce((sum, s) => sum + (s.quantityBase ?? 0), 0),
        sectionId: ingredients.section(ingredientId),
        sources: dimension === null ? sources.map((s) => ({ ...s, quantityBase: null })) : sources,
      });
    }
  }
  needs.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  for (const need of needs) need.sources.sort(compareSources);
  return {
    needs,
    staples,
    have,
    mergedCount: needs.filter((n) => n.sources.length > 1).length,
  };
}

/**
 * R-UNIT-2: an ingredient with a density and a mass or volume default merges its mass and
 * volume lines into the default dimension (g = ml x density). Count never merges.
 */
function mergeByDensity(
  byDimension: Map<ItemDimension, NeedSource[]>,
  defaultDimension: Dimension,
  density: number | null,
): Map<ItemDimension, NeedSource[]> {
  if (!density || defaultDimension === 'count') return byDimension;
  const other: Dimension = defaultDimension === 'mass' ? 'volume' : 'mass';
  const moving = byDimension.get(other);
  if (!moving) return byDimension;
  const convert = (base: number | null) =>
    base === null ? null : defaultDimension === 'mass' ? base * density : base / density;
  const merged = new Map(byDimension);
  merged.delete(other);
  merged.set(defaultDimension, [
    ...(byDimension.get(defaultDimension) ?? []),
    ...moving.map((s) => ({ ...s, quantityBase: convert(s.quantityBase) })),
  ]);
  return merged;
}

/**
 * How an item's quantity shows in the household's unit system (R-UNIT-3, R-UNIT-4, R-UNIT-5),
 * whatever units the recipes used. Null for a no-quantity item. Stored values never change.
 */
export function itemDisplayParts(
  dimension: ItemDimension,
  quantityBase: number | null,
  system: UnitSystem,
): QuantityPart[] | null {
  if (dimension === null || quantityBase === null || !(quantityBase > 0)) return null;
  return displayQuantity(quantityBase, dimension, system);
}
