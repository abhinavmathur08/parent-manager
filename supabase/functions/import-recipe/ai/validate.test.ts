import { assertEquals } from 'jsr:@std/assert@1';

import { validateOutput } from './validate.ts';

const line = (overrides: Record<string, unknown> = {}) => ({
  original: '2 eggs',
  quantity: 2,
  unitId: 'unit.each',
  ingredientName: 'egg',
  note: null,
  confidence: 0.9,
  inferred: false,
  ...overrides,
});

const output = (overrides: Record<string, unknown> = {}) => ({
  isRecipe: true,
  title: 'Omelette',
  servings: 1,
  prepMinutes: null,
  cookMinutes: 5,
  ingredients: [line()],
  steps: ['Whisk.', '  ', 'Cook.'],
  tags: ['tag.quick', 'tag.made_up'],
  allergens: ['allergen.egg', 'allergen.unknown'],
  ...overrides,
});

Deno.test('keeps allowed tags and allergens only, and drops empty steps', () => {
  const result = validateOutput(output());
  if (!result.ok) throw new Error('expected a draft');
  assertEquals(result.draft.tags, ['tag.quick']);
  assertEquals(result.draft.allergens, ['allergen.egg']);
  assertEquals(result.draft.steps, ['Whisk.', 'Cook.']);
});

Deno.test('every line keeps a confidence from 0 to 1 (AI-4)', () => {
  const result = validateOutput(
    output({
      ingredients: [
        line({ confidence: 7 }),
        line({ confidence: -1 }),
        line({ quantity: null, unitId: null, original: 'salt' }),
        line({ quantity: null, unitId: 'unit.pinch', original: 'a pinch of salt' }),
        line({ inferred: true, original: 'oil for frying' }),
        line({ unitId: 'unit.bucket' }),
      ],
    }),
  );
  if (!result.ok) throw new Error('expected a draft');
  assertEquals(
    result.draft.ingredients.map((l) => [l.confidence, l.unitId]),
    [
      [1, 'unit.each'],
      [0, 'unit.each'],
      [0.6, null],
      [0.9, 'unit.pinch'],
      [0.4, 'unit.each'],
      [0.6, null],
    ],
  );
});

Deno.test('out-of-range numbers become empty, not invalid', () => {
  const result = validateOutput(
    output({ servings: 0, cookMinutes: 99999, ingredients: [line({ quantity: -2 })] }),
  );
  if (!result.ok) throw new Error('expected a draft');
  assertEquals([result.draft.servings, result.draft.cookMinutes], [null, null]);
  assertEquals(result.draft.ingredients[0].quantity, null);
});

Deno.test('malformed output is invalid, so it is retried', () => {
  for (const bad of [
    null,
    'text',
    {},
    output({ ingredients: 'eggs' }),
    output({ ingredients: [line({ original: '' })] }),
    output({ ingredients: [line({ confidence: 'high' })] }),
    output({ servings: '4' }),
    output({ steps: [3] }),
  ]) {
    assertEquals(validateOutput(bad), { ok: false, reason: 'invalid' });
  }
});

Deno.test('isRecipe false, or nothing usable, is not a recipe', () => {
  assertEquals(validateOutput({ isRecipe: false }), { ok: false, reason: 'not_a_recipe' });
  assertEquals(validateOutput(output({ title: null, ingredients: [], steps: [] })), {
    ok: false,
    reason: 'not_a_recipe',
  });
});

Deno.test('a partial result is still a draft (AI-19)', () => {
  const result = validateOutput(output({ steps: [] }));
  assertEquals(result.ok, true);
});
