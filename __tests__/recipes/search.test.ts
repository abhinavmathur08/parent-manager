import {
  indexRecipe,
  searchRecipes,
  sortRecipes,
  type RecipeEntry,
} from '@/features/recipes/search';
import type { RecipeTag } from '@/features/recipes/tables';

const tagName = (tag: RecipeTag) =>
  ({ 'tag.freezer_friendly': 'Freezer-friendly', 'tag.quick': 'Quick' })[tag as string] ?? tag;

const entry = (over: Partial<RecipeEntry>): RecipeEntry => ({
  id: 'r',
  title: 'Recipe',
  tags: [],
  totalMinutes: null,
  updatedAt: '2026-11-10T00:00:00Z',
  ingredientNames: [],
  ...over,
});

const recipes = [
  entry({
    id: 'chili',
    title: 'Batch chili',
    tags: ['tag.freezer_friendly'],
    ingredientNames: ['kidney beans', 'onion'],
  }),
  entry({
    id: 'oats',
    title: 'Overnight oats',
    tags: ['tag.quick'],
    ingredientNames: ['rolled oats', 'milk'],
  }),
  entry({
    id: 'soup',
    title: 'Courgette soup',
    tags: ['tag.freezer_friendly', 'tag.quick'],
    ingredientNames: ['courgette'],
  }),
].map((r) => indexRecipe(r, tagName));

describe('searchRecipes (FR-REC-10)', () => {
  const ids = (query: string, tags: RecipeTag[] = []) =>
    searchRecipes(recipes, query, tags).map((r) => r.id);

  it('matches titles, ingredient names and tag names', () => {
    expect(ids('chili')).toEqual(['chili']);
    expect(ids('milk')).toEqual(['oats']);
    expect(ids('freezer')).toEqual(['chili', 'soup']);
    expect(ids('')).toEqual(['chili', 'oats', 'soup']);
  });

  it('needs every word, each starting a word, ignoring case and accents', () => {
    expect(ids('OVERNIGHT Milk')).toEqual(['oats']);
    expect(ids('ats')).toEqual([]);
    expect(ids('courgétte')).toEqual(['soup']);
  });

  it('filters by every selected tag', () => {
    expect(ids('', ['tag.quick'])).toEqual(['oats', 'soup']);
    expect(ids('', ['tag.quick', 'tag.freezer_friendly'])).toEqual(['soup']);
    expect(ids('oats', ['tag.freezer_friendly'])).toEqual([]);
  });

  it('searches 500 recipes within 200 ms (NFR-PERF-5)', () => {
    const many = Array.from({ length: 500 }, (_, i) =>
      indexRecipe(
        entry({
          id: String(i),
          title: `Family dinner number ${i}`,
          tags: i % 2 ? ['tag.quick'] : [],
          ingredientNames: Array.from({ length: 12 }, (_, j) => `ingredient ${(i * j) % 97} item`),
        }),
        tagName,
      ),
    );
    const start = performance.now();
    for (const query of ['f', 'fa', 'fam', 'family d', 'ingredient 42', 'zzz']) {
      searchRecipes(many, query, ['tag.quick']);
    }
    expect((performance.now() - start) / 6).toBeLessThan(200);
  });
});

describe('sortRecipes (FR-REC-1)', () => {
  it('puts the most recently changed first, then sorts by title, with unsynced recipes first', () => {
    const sorted = sortRecipes(
      [
        entry({ id: 'old', title: 'B', updatedAt: '2026-11-01T00:00:00Z' }),
        entry({ id: 'new-b', title: 'b', updatedAt: '2026-11-11T00:00:00Z' }),
        entry({ id: 'new-a', title: 'a', updatedAt: '2026-11-11T00:00:00Z' }),
        entry({ id: 'local', title: 'Z', updatedAt: null }),
      ],
      'en-US',
    );
    expect(sorted.map((r) => r.id)).toEqual(['local', 'new-a', 'new-b', 'old']);
  });
});
