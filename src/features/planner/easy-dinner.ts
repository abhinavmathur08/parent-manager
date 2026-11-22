/**
 * Easy dinners on busy days (B-01.3, FR2-BUSY-2, D-18). Pure, so it works offline and is
 * tested without screens.
 *
 * On a busy day, an empty dinner offers "add an easy dinner", and a dinner that's a recipe that
 * isn't an easy meal and takes over 30 minutes offers "swap for an easy meal". The sheet lists
 * up to 5 easy meals: leftovers of an earlier entry first, then household recipes, then
 * starter recipes, avoiding recipes planned in the 7 days before (PROPOSED).
 */
import type { BusyReason } from '@/features/calendar/busy';
import { STARTER_RECIPES, type StarterRecipe } from '@/features/recipes/starter/library';
import { hasTag, type RecipeRow } from '@/features/recipes/tables';

import { leftoverCandidates } from './leftovers';
import { slotEntries } from './plan';
import type { PlanEntryRow } from './tables';
import { addDays, type PlanDate, type WeekStart } from './week';

export const EASY_DINNER_LIMITS = {
  /** A recipe slower than this, not tagged easy, offers a swap. */
  swapOverMinutes: 30,
  /** Recipes planned this many days before aren't suggested again. */
  recentDays: 7,
  candidates: 5,
} as const;

type Tagged = { tags: readonly string[] | null };

/** An easy meal: tagged quick or no-cook (FR-REC-7 tags, compared by ID). */
export function isEasy(recipe: Tagged): boolean {
  return hasTag(recipe, 'tag.quick') || hasTag(recipe, 'tag.no_cook');
}

export type EasyOffer = { mode: 'add' } | { mode: 'swap'; entry: PlanEntryRow };

/** What a day's dinner offers, if anything (FR2-BUSY-2). Never changes the plan. */
export function easyOffer(
  day: { busy: boolean; reason: BusyReason | null } | null,
  date: PlanDate,
  entries: readonly PlanEntryRow[],
  recipeOf: (id: string) => RecipeRow | undefined,
): EasyOffer | null {
  if (!day?.busy) return null;
  const dinners = slotEntries(entries, date, 'dinner');
  if (dinners.length === 0) return { mode: 'add' };
  // Any easy dinner, free text (takeout) or leftovers means dinner is already handled.
  const handled = dinners.some((entry) => {
    if (!entry.recipe_id || entry.leftover_of_entry_id) return true;
    const recipe = recipeOf(entry.recipe_id);
    if (!recipe) return true;
    const minutes = (recipe.prep_minutes ?? 0) + (recipe.cook_minutes ?? 0);
    return isEasy(recipe) || minutes <= EASY_DINNER_LIMITS.swapOverMinutes;
  });
  return handled ? null : { mode: 'swap', entry: dinners[0] };
}

export type EasyCandidate =
  | { source: 'leftovers'; key: string; entry: PlanEntryRow; recipeId: string }
  | { source: 'household'; key: string; recipe: RecipeRow }
  | { source: 'starter'; key: string; starter: StarterRecipe };

/** Up to 5 easy meals for a day's dinner, leftovers first (FR2-BUSY-2). */
export function easyCandidates(input: {
  date: PlanDate;
  /** Every live entry the device has, so leftovers can reach the week before. */
  entries: readonly PlanEntryRow[];
  recipes: readonly RecipeRow[];
  weekStart: WeekStart;
  /** The dinner being swapped out, if any. */
  replacing?: PlanEntryRow | null;
}): EasyCandidate[] {
  const { date, entries, recipes, weekStart, replacing } = input;
  const live = recipes.filter((recipe) => !recipe.deleted_at);
  const liveIds = new Set(live.map((recipe) => recipe.id));
  const from = addDays(date, -EASY_DINNER_LIMITS.recentDays);
  const recent = new Set(
    entries
      .filter((e) => !e.deleted_at && e.recipe_id && e.date >= from && e.date < date)
      .map((e) => e.recipe_id as string),
  );
  if (replacing?.recipe_id) recent.add(replacing.recipe_id);
  const out: EasyCandidate[] = [];
  const used = new Set<string>();

  // Leftovers of an earlier entry: cooked already, so easy whatever the recipe.
  // Only the new dinner's place matters for a link.
  const dinner = { id: '', date, slot: 'dinner' } as PlanEntryRow;
  const leftovers = leftoverCandidates(dinner, entries, weekStart);
  for (const entry of leftovers) {
    if (!entry.recipe_id || !liveIds.has(entry.recipe_id) || used.has(entry.recipe_id)) continue;
    if (entry.id === replacing?.id || entry.recipe_id === replacing?.recipe_id) continue;
    used.add(entry.recipe_id);
    out.push({
      source: 'leftovers',
      key: `leftovers:${entry.id}`,
      entry,
      recipeId: entry.recipe_id,
    });
  }

  // Household recipes, most recently changed first (never sorted by title).
  const household = live
    .filter((recipe) => isEasy(recipe) && !recent.has(recipe.id) && !used.has(recipe.id))
    .sort(
      (a, b) => (b.updated_at ?? '').localeCompare(a.updated_at ?? '') || a.id.localeCompare(b.id),
    );
  for (const recipe of household) {
    used.add(recipe.id);
    out.push({ source: 'household', key: `household:${recipe.id}`, recipe });
  }

  // Starter recipes the household hasn't saved a copy of (a copy is listed above, or recent).
  const copied = new Set(live.flatMap((recipe) => recipe.library_recipe_id ?? []));
  for (const starter of STARTER_RECIPES) {
    if (!isEasy(starter) || copied.has(starter.key)) continue;
    out.push({ source: 'starter', key: `starter:${starter.key}`, starter });
  }

  return out.slice(0, EASY_DINNER_LIMITS.candidates);
}
