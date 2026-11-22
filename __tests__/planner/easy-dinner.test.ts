import { easyCandidates, easyOffer, isEasy } from '@/features/planner/easy-dinner';
import type { PlanEntryRow } from '@/features/planner/tables';
import type { RecipeRow } from '@/features/recipes/tables';

const base = (id: string) => ({
  id,
  household_id: 'hh',
  version: 1,
  created_at: null,
  updated_at: null,
  deleted_at: null,
});

const recipe = (id: string, over: Partial<RecipeRow> = {}): RecipeRow => ({
  ...base(id),
  title: id,
  servings: 4,
  prep_minutes: 10,
  cook_minutes: 40,
  tags: [],
  notes: null,
  source_type: 'manual',
  source_url: null,
  library_recipe_id: null,
  content_locale: 'en-US',
  created_by: null,
  updated_by: null,
  ...over,
});

const entry = (id: string, date: string, over: Partial<PlanEntryRow> = {}): PlanEntryRow =>
  ({
    ...base(id),
    date,
    slot: 'dinner',
    position: 0,
    recipe_id: null,
    free_text: null,
    servings: 2,
    leftover_of_entry_id: null,
    ...over,
  }) as PlanEntryRow;

const BUSY = { busy: true, reason: 'dinner' as const };
const WED = '2026-12-02';

describe('isEasy', () => {
  it('is a quick or no-cook recipe, by tag ID', () => {
    expect(isEasy({ tags: ['tag.quick'] })).toBe(true);
    expect(isEasy({ tags: ['tag.no_cook'] })).toBe(true);
    expect(isEasy({ tags: ['tag.batch_prep'] })).toBe(false);
    expect(isEasy({ tags: null })).toBe(false);
  });
});

describe('easyOffer (FR2-BUSY-2)', () => {
  const slow = recipe('slow');
  const quick = recipe('quick', { tags: ['tag.quick'] });
  const short = recipe('short', { prep_minutes: 10, cook_minutes: 15 });
  const byId = new Map([slow, quick, short].map((r) => [r.id, r]));
  const recipeOf = (id: string) => byId.get(id);

  it('offers nothing on a day that is not busy', () => {
    expect(easyOffer({ busy: false, reason: null }, WED, [], recipeOf)).toBeNull();
    expect(easyOffer(null, WED, [], recipeOf)).toBeNull();
  });

  it('offers an easy dinner when dinner is empty, even if lunch is planned', () => {
    const lunch = entry('lunch', WED, { slot: 'lunch', recipe_id: 'slow' });
    expect(easyOffer(BUSY, WED, [lunch], recipeOf)).toEqual({ mode: 'add' });
  });

  it('offers a swap for a slow recipe that is not easy', () => {
    const dinner = entry('d', WED, { recipe_id: 'slow' });
    expect(easyOffer(BUSY, WED, [dinner], recipeOf)).toEqual({ mode: 'swap', entry: dinner });
  });

  it('leaves an easy, short, free-text or leftovers dinner alone', () => {
    for (const dinner of [
      entry('a', WED, { recipe_id: 'quick' }),
      entry('b', WED, { recipe_id: 'short' }),
      entry('c', WED, { free_text: 'Takeout' }),
      entry('d', WED, { recipe_id: 'slow', leftover_of_entry_id: 'x' }),
    ]) {
      expect(easyOffer(BUSY, WED, [dinner], recipeOf)).toBeNull();
    }
  });
});

describe('easyCandidates (FR2-BUSY-2)', () => {
  it('lists leftovers first, then household recipes, then starters, at most 5', () => {
    const recipes = [
      recipe('stew'),
      recipe('wraps', { tags: ['tag.quick'], updated_at: '2026-11-02T00:00:00Z' }),
      recipe('salad', { tags: ['tag.no_cook'], updated_at: '2026-11-03T00:00:00Z' }),
    ];
    const monday = entry('mon', '2026-11-30', { recipe_id: 'stew' });
    const list = easyCandidates({ date: WED, entries: [monday], recipes, weekStart: 7 });
    expect(list).toHaveLength(5);
    expect(list.map((c) => c.source)).toEqual([
      'leftovers',
      'household',
      'household',
      'starter',
      'starter',
    ]);
    expect(list[0]).toMatchObject({ source: 'leftovers', recipeId: 'stew', entry: monday });
    // Most recently changed first, never by title.
    expect(list.slice(1, 3).map((c) => c.source === 'household' && c.recipe.id)).toEqual([
      'salad',
      'wraps',
    ]);
    for (const c of list.slice(3)) {
      expect(c.source === 'starter' && isEasy(c.starter)).toBe(true);
    }
  });

  it('skips recipes planned in the 7 days before, and the dinner being swapped', () => {
    const recipes = [
      recipe('wraps', { tags: ['tag.quick'] }),
      recipe('salad', { tags: ['tag.quick'] }),
      recipe('toast', { tags: ['tag.quick'] }),
    ];
    const entries = [
      // Twelve days before: not recent, and before the week leftovers can reach.
      entry('old', '2026-11-20', { slot: 'lunch', recipe_id: 'toast' }),
      // Last Friday, dinner: recent, so not a household suggestion.
      entry('fri', '2026-11-27', { recipe_id: 'wraps' }),
    ];
    const replacing = entry('wed', WED, { recipe_id: 'salad' });
    const list = easyCandidates({ date: WED, entries, recipes, weekStart: 7, replacing });
    const household = list.flatMap((c) => (c.source === 'household' ? [c.recipe.id] : []));
    expect(household).toEqual(['toast']);
    // Leftovers of last Friday's dinner are still easy.
    expect(list[0]).toMatchObject({ source: 'leftovers', recipeId: 'wraps' });
  });

  it("doesn't list a starter the household already has a copy of", () => {
    const copy = recipe('copy', {
      tags: ['tag.quick'],
      library_recipe_id: 'starter.overnight_oats',
    });
    const list = easyCandidates({ date: WED, entries: [], recipes: [copy], weekStart: 7 });
    expect(list[0]).toMatchObject({ source: 'household' });
    expect(
      list.some((c) => c.source === 'starter' && c.starter.key === 'starter.overnight_oats'),
    ).toBe(false);
  });
});
