import {
  buildNameIndex,
  catalogIndexInput,
  loadParserVocabulary,
} from '@/features/ingredients/matching';
import { LOW_CONFIDENCE, needsReview, normalizeDraft } from '@/features/import/normalize';
import type { ImportedDraft, ImportedLine } from '@/features/import/types';
import type { AppLocale, Region } from '@/i18n';

const catalog = require('../../supabase/catalog/ingredients.json');

function options(locale: AppLocale, region: Region) {
  const input = catalogIndexInput(catalog, locale);
  let n = 0;
  return {
    index: buildNameIndex(locale, input.ingredients, input.names),
    vocabulary: loadParserVocabulary(locale),
    region,
    newId: () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`,
  };
}

const line = (overrides: Partial<ImportedLine>): ImportedLine => ({
  original: '',
  quantity: null,
  unitId: null,
  ingredientName: null,
  note: null,
  confidence: 0.9,
  ...overrides,
});

const draft = (ingredients: ImportedLine[], extra: Partial<ImportedDraft> = {}): ImportedDraft => ({
  title: 'Soup',
  servings: 4,
  prepMinutes: 10,
  cookMinutes: null,
  ingredients,
  steps: ['Chop.', 'Simmer.'],
  tags: ['tag.quick', 'tag.unknown'],
  allergens: ['allergen.tree_nut', 'allergen.nope'],
  ...extra,
});

describe('normalizeDraft', () => {
  it('matches model names to catalog IDs and keeps the model unit and quantity', () => {
    const { recipe, lines } = normalizeDraft(
      draft([
        line({
          original: '2 tbsp extra virgin olive oil',
          quantity: 2,
          unitId: 'unit.tbsp_au',
          ingredientName: 'olive oil',
        }),
        line({
          original: '3 eggs, beaten',
          quantity: 3,
          unitId: 'unit.each',
          ingredientName: 'egg',
          note: 'beaten',
        }),
      ]),
      options('en-AU', 'AU'),
    );
    expect(
      recipe.lines.map((l) => [l.ingredientId, l.quantity, l.unitId, l.rawText, l.note]),
    ).toEqual([
      ['ingredient.olive_oil', 2, 'unit.tbsp_au', '2 tbsp extra virgin olive oil', null],
      ['ingredient.egg', 3, 'unit.each', '3 eggs, beaten', 'beaten'],
    ]);
    expect(Object.values(lines).map((l) => [l.confidence, l.unmatched])).toEqual([
      [0.9, false],
      [0.9, false],
    ]);
  });

  it('turns an unknown ingredient into a new household ingredient, highlighted (FR-AI-6)', () => {
    const { recipe, lines } = normalizeDraft(
      draft([
        line({
          original: '200 g zorblax paste',
          quantity: 200,
          unitId: 'unit.g',
          ingredientName: 'zorblax paste',
        }),
      ]),
      options('en-GB', 'GB'),
    );
    const [only] = recipe.lines;
    expect(only.ingredientId).toMatch(/^ingredient\.h\.[0-9a-f]{32}$/);
    expect(recipe.newIngredients).toEqual([
      expect.objectContaining({
        ingredientId: only.ingredientId,
        name: 'zorblax paste',
        sectionId: 'section.other',
        dimension: 'mass',
      }),
    ]);
    expect(lines[only.id]).toEqual({
      original: '200 g zorblax paste',
      confidence: 0,
      unmatched: true,
    });
    expect(needsReview(lines[only.id])).toBe(true);
  });

  it('parses embedded-data lines on the device, with a confidence from the match', () => {
    const { recipe, lines } = normalizeDraft(
      draft([line({ original: '1 1/2 cups whole milk', confidence: 0 })]),
      options('en-US', 'US'),
    );
    expect(recipe.lines[0]).toEqual(
      expect.objectContaining({
        ingredientId: 'ingredient.milk',
        quantity: 1.5,
        unitId: 'unit.cup_us',
      }),
    );
    expect(lines[recipe.lines[0].id].confidence).toBeGreaterThanOrEqual(LOW_CONFIDENCE);
  });

  it('a counted line without a model unit takes unit.each from the matcher', () => {
    const { recipe } = normalizeDraft(
      draft([line({ original: '2 onions', quantity: 2, ingredientName: 'onion' })]),
      options('en-US', 'US'),
    );
    expect(recipe.lines[0].unitId).toBe('unit.each');
  });

  it('a low model confidence stays low after a good match', () => {
    const { lines } = normalizeDraft(
      draft([line({ original: 'butter', ingredientName: 'butter', confidence: 0.6 })]),
      options('en-US', 'US'),
    );
    expect(needsReview(Object.values(lines)[0])).toBe(true);
  });

  it('fills the form and keeps only known tags and allergens', () => {
    const review = normalizeDraft(draft([], { servings: 400 }), {
      ...options('en-US', 'US'),
      sourceUrl: 'https://example.com/soup',
    });
    expect(review.recipe).toEqual(
      expect.objectContaining({
        title: 'Soup',
        servings: 24,
        prepMinutes: '10',
        cookMinutes: '',
        tags: ['tag.quick'],
        sourceUrl: 'https://example.com/soup',
      }),
    );
    expect(review.recipe.steps.map((s) => s.text)).toEqual(['Chop.', 'Simmer.']);
    expect(review.sourceAllergens).toEqual(['allergen.tree_nut']);
  });
});
