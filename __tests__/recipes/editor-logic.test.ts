import { loadParserVocabulary } from '@/features/ingredients/matching';
import { buildIngredients } from '@/features/ingredients/use-ingredients';
import {
  draftFromRecipe,
  emptyDraft,
  parseMinutes,
  planSave,
  validateDraft,
  type RecipeDraft,
  type SavedRecipe,
} from '@/features/recipes/draft';
import { formatLine } from '@/features/recipes/format-line';
import { parseQuantityText, quantityToText } from '@/features/recipes/quantity-text';
import { ingredientWords, quickAddLine } from '@/features/recipes/quick-add';
import type { RecipeIngredientRow, RecipeRow, RecipeStepRow } from '@/features/recipes/tables';
import { unitChoices } from '@/features/recipes/units';
import { i18n } from '@/i18n';

const t = i18n.getFixedT('en-US');

describe('parseQuantityText (FR-REC-5)', () => {
  it.each([
    ['2', 2],
    ['1/2', 0.5],
    ['1 1/2', 1.5],
    ['1½', 1.5],
    [' 3/4 ', 0.75],
    ['2.5', 2.5],
  ])('reads %p as %p', (text, value) => {
    expect(parseQuantityText(text, 'en-US')).toBe(value);
  });

  it('is null when empty and undefined when not a quantity', () => {
    expect(parseQuantityText('  ', 'en-US')).toBeNull();
    expect(parseQuantityText('lots', 'en-US')).toBeUndefined();
    expect(parseQuantityText('1/0', 'en-US')).toBeUndefined();
    expect(parseQuantityText('0', 'en-US')).toBeUndefined();
  });

  it('follows the locale decimal separator', () => {
    expect(parseQuantityText('2,5', 'de-DE')).toBe(2.5);
    expect(parseQuantityText('2,5', 'en-US')).toBeUndefined();
  });

  it('writes stored amounts back as editable text', () => {
    expect(quantityToText(1.5, 'en-US')).toBe('1 1/2');
    expect(quantityToText(0.25, 'en-US')).toBe('1/4');
    expect(quantityToText(2, 'en-US')).toBe('2');
    expect(quantityToText(2.4, 'en-US')).toBe('2.4');
    expect(quantityToText(null, 'en-US')).toBe('');
  });
});

describe('unitChoices (FR-REC-5)', () => {
  it('puts the household unit system first, with regional sizes', () => {
    expect(unitChoices('us_customary', 'US').primary.slice(0, 3)).toEqual([
      'unit.tsp_us',
      'unit.tbsp_us',
      'unit.cup_us',
    ]);
    const au = unitChoices('metric', 'AU');
    expect(au.primary).toContain('unit.tbsp_au');
    expect(au.primary).not.toContain('unit.tbsp_metric');
    expect(au.more).toContain('unit.cup_us');
    expect(unitChoices('metric', 'GB').primary).toContain('unit.tbsp_metric');
  });
});

describe('quick add (FR-REC-5)', () => {
  const ingredients = buildIngredients('en-US', []);
  const options = {
    index: ingredients.index,
    vocabulary: loadParserVocabulary('en-US'),
    region: 'US' as const,
  };

  it('adds a line whose ingredient is found by name, with mixed numbers', () => {
    const { line, confident } = quickAddLine('1 1/2 cups whole milk, warm', options, 'id-1');
    expect(confident).toBe(true);
    expect(line).toMatchObject({
      id: 'id-1',
      ingredientId: 'ingredient.milk',
      quantity: 1.5,
      unitId: 'unit.cup_us',
      note: 'warm',
    });
  });

  it('opens the sheet for an unknown ingredient, keeping the amount and the name', () => {
    const { line, confident, searchText } = quickAddLine(
      '2 tbsp grandmas chutney',
      options,
      'id-2',
    );
    expect(confident).toBe(false);
    expect(line).toMatchObject({ quantity: 2, unitId: 'unit.tbsp_us' });
    expect(searchText).toBe('grandmas chutney');
  });

  it('finds the ingredient words after the amount and unit', () => {
    expect(ingredientWords('1 1/2 cups of zaatar, toasted', options.vocabulary, 'US')).toBe(
      'zaatar',
    );
  });
});

describe('formatLine', () => {
  it('formats amounts through the locale helpers', () => {
    const line = {
      ingredientId: 'ingredient.milk',
      quantity: 1.5,
      unitId: 'unit.cup_us',
      note: 'warm',
    };
    expect(formatLine(line, { name: 'milk', locale: 'en-US', t })).toBe('1½ cups milk, warm');
    expect(
      formatLine(
        { ...line, quantity: 2, unitId: 'unit.each', note: null },
        { name: 'onions', locale: 'en-US', t },
      ),
    ).toBe('2 onions');
    expect(
      formatLine(
        { ...line, quantity: null, unitId: 'unit.pinch', note: null },
        { name: 'salt', locale: 'en-US', t },
      ),
    ).toBe('a pinch salt');
    expect(
      formatLine(
        { ...line, quantity: null, unitId: null, note: null },
        { name: 'salt', locale: 'en-US', t },
      ),
    ).toBe('salt');
  });

  it('uses plurals from the catalog for more than one', () => {
    const ingredients = buildIngredients('en-US', []);
    expect(ingredients.nameFor('ingredient.onion', 2)).toBe('onions');
    expect(ingredients.nameFor('ingredient.onion', 1)).toBe('onion');
  });
});

describe('validateDraft (FR-REC-4)', () => {
  const valid: RecipeDraft = { ...emptyDraft(), title: 'Soup' };

  it('needs a title of at most 120 characters', () => {
    expect(validateDraft(valid)).toEqual({});
    expect(validateDraft({ ...valid, title: '  ' }).title).toBe(
      'recipes.editor.errors.titleRequired',
    );
    expect(validateDraft({ ...valid, title: 'x'.repeat(121) }).title).toBe(
      'recipes.editor.errors.titleLong',
    );
  });

  it('checks minutes, the link and the limits', () => {
    expect(parseMinutes('')).toBeNull();
    expect(parseMinutes('45')).toBe(45);
    expect(parseMinutes('1441')).toBeUndefined();
    const errors = validateDraft({
      ...valid,
      prepMinutes: 'ten',
      sourceUrl: 'example.com',
      lines: Array.from({ length: 101 }, (_, i) => ({
        id: String(i),
        ingredientId: 'ingredient.salt',
        quantity: null,
        unitId: null,
        rawText: null,
        note: null,
        optional: false,
      })),
    });
    expect(Object.keys(errors).sort()).toEqual(['lines', 'prepMinutes', 'sourceUrl']);
  });
});

describe('planSave', () => {
  const context = {
    recipeId: 'r1',
    locale: 'en-US',
    dimension: (id: string) => buildIngredients('en-US', []).dimension(id),
  };
  const base = {
    household_id: 'hh',
    version: 1,
    created_at: null,
    updated_at: null,
    deleted_at: null,
  };

  it('writes new ingredients first, then the recipe, its lines and steps', () => {
    const draft: RecipeDraft = {
      ...emptyDraft(),
      title: ' Flatbread ',
      prepMinutes: '10',
      lines: [
        {
          id: 'l1',
          ingredientId: 'ingredient.flour',
          quantity: 2,
          unitId: 'unit.cup_us',
          rawText: null,
          note: null,
          optional: false,
        },
        {
          id: 'l2',
          ingredientId: 'ingredient.h.abc',
          quantity: 1,
          unitId: 'unit.tbsp_us',
          rawText: null,
          note: null,
          optional: false,
        },
      ],
      steps: [
        { id: 's1', text: 'Mix.' },
        { id: 's2', text: '   ' },
      ],
      newIngredients: [
        {
          rowId: 'n1',
          ingredientId: 'ingredient.h.abc',
          name: " Za'atar ",
          sectionId: 'section.spices',
          dimension: 'volume',
        },
        {
          rowId: 'n2',
          ingredientId: 'ingredient.h.unused',
          name: 'Unused',
          sectionId: 'section.other',
          dimension: 'count',
        },
      ],
    };
    const ops = planSave(null, draft, context);
    expect(ops.map((o) => `${o.kind} ${o.table} ${o.id}`)).toEqual([
      'insert household_ingredients n1',
      'insert recipes r1',
      'insert recipe_ingredients l1',
      'insert recipe_ingredients l2',
      'insert recipe_steps s1',
    ]);
    expect(ops[0]).toMatchObject({
      values: { name: "Za'atar", locale: 'en-US', section_id: 'section.spices' },
    });
    expect(ops[1]).toMatchObject({
      values: {
        title: 'Flatbread',
        prep_minutes: 10,
        cook_minutes: null,
        source_type: 'manual',
        content_locale: 'en-US',
      },
    });
    expect(ops[3]).toMatchObject({ values: { recipe_id: 'r1', position: 1 } });
    expect(ops[3]).toMatchObject({ values: { quantity_base: expect.closeTo(14.7868, 3) } });
  });

  it('writes only what changed when editing', () => {
    const saved: SavedRecipe = {
      recipe: {
        ...base,
        id: 'r1',
        title: 'Soup',
        servings: 4,
        prep_minutes: null,
        cook_minutes: 30,
        tags: ['tag.batch_prep'],
        notes: null,
        source_type: 'manual',
        source_url: null,
        library_recipe_id: null,
        content_locale: 'en-US',
        created_by: null,
        updated_by: null,
      } as RecipeRow,
      lines: [
        {
          ...base,
          id: 'l1',
          recipe_id: 'r1',
          position: 0,
          ingredient_id: 'ingredient.onion',
          quantity: 2,
          unit_id: null,
          quantity_base: 2,
          raw_text: null,
          note: null,
          optional: false,
        },
        {
          ...base,
          id: 'l2',
          recipe_id: 'r1',
          position: 1,
          ingredient_id: 'ingredient.salt',
          quantity: null,
          unit_id: null,
          quantity_base: null,
          raw_text: null,
          note: null,
          optional: false,
        },
      ] as RecipeIngredientRow[],
      steps: [
        { ...base, id: 's1', recipe_id: 'r1', position: 0, text: 'Simmer.' },
      ] as RecipeStepRow[],
    };
    const draft = draftFromRecipe(saved);
    expect(planSave(saved, draft, context)).toEqual([]);

    draft.servings = 6;
    draft.lines = [{ ...draft.lines[0], quantity: 3 }];
    draft.steps = [...draft.steps, { id: 's2', text: 'Serve.' }];
    expect(planSave(saved, draft, context)).toEqual([
      { kind: 'update', table: 'recipes', id: 'r1', values: { servings: 6 } },
      { kind: 'remove', table: 'recipe_ingredients', id: 'l2' },
      {
        kind: 'update',
        table: 'recipe_ingredients',
        id: 'l1',
        values: { quantity: 3, quantity_base: 3 },
      },
      {
        kind: 'insert',
        table: 'recipe_steps',
        id: 's2',
        values: { recipe_id: 'r1', position: 1, text: 'Serve.' },
      },
    ]);
  });
});
