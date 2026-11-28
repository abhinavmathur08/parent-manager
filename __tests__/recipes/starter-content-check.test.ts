import catalog from '../../supabase/catalog/ingredients.json';

const {
  validate,
  reviewSheet,
  recipeAllergens,
  TAGS,
  NEW_PARENT_TAGS: SCRIPT_NEW_PARENT_TAGS,
  UNITS: SCRIPT_UNITS,
  DONENESS,
  INFANT_BANNED,
} = require('../../scripts/starter-recipes.js');

import { NEW_PARENT_TAGS } from '@/features/recipes/starter/library';
import { RECIPE_TAGS } from '@/features/recipes/tables';
import { UNITS, UNMEASURED_UNITS } from '@/i18n';

type Line = { ingredientId: string; quantity: number | null; unitId: string | null };
type Text = {
  title?: string;
  steps?: string[];
  notes?: string;
  lineNotes?: Record<string, string>;
};

const KEY = 'starter.test';

function recipe(lines: Line[], tags = ['tag.quick']) {
  return {
    version: 1,
    recipes: [{ key: KEY, servings: 2, prepMinutes: 5, cookMinutes: 10, tags, lines }],
  };
}

function texts(us: Text, gb: Text | null = null, au: Text | null = null) {
  return {
    'en-US': { [KEY]: { title: 'Test', ...us } },
    'en-GB': gb ? { [KEY]: gb } : {},
    'en-AU': au ? { [KEY]: au } : {},
  };
}

const line = (
  ingredientId: string,
  quantity: number | null = 1,
  unitId: string | null = 'unit.each',
) => ({
  ingredientId,
  quantity,
  unitId,
});
const steps = (...s: string[]) => ({ steps: s });
const errors = (data: object, text: object, records = {}) =>
  validate(data, text, catalog, records) as string[];

describe('starter recipe content check (R-04.2, D-8)', () => {
  it('accepts a well-formed recipe', () => {
    expect(errors(recipe([line('ingredient.banana')]), texts(steps('Peel and eat.')))).toEqual([]);
  });

  it('keeps its tag and unit lists in step with the app', () => {
    expect(TAGS).toEqual([...RECIPE_TAGS]);
    expect(SCRIPT_NEW_PARENT_TAGS).toEqual([...NEW_PARENT_TAGS]);
    for (const [unit, dimension] of Object.entries(SCRIPT_UNITS)) {
      if (dimension === null) expect(UNMEASURED_UNITS).toContain(unit);
      else expect(UNITS[unit as keyof typeof UNITS].dimension).toBe(dimension);
    }
  });

  it('names only catalog ingredients in its rules', () => {
    const ids = new Set(catalog.ingredients.map((i) => i.id));
    const ruled = [
      ...Object.values(DONENESS).flatMap((r: any) => r.ingredients),
      ...INFANT_BANNED.flatMap((r: any) => r.ingredients),
    ];
    expect(ruled.filter((id: string) => !ids.has(id))).toEqual([]);
  });

  it('fails on an ingredient without a catalog ID', () => {
    expect(errors(recipe([line('ingredient.unicorn')]), texts(steps('Mix.')))).toEqual([
      "starter.test line 0: ingredient.unicorn isn't a catalog ingredient ID",
    ]);
  });

  it('fails on a unit that is not a base unit, or the wrong dimension', () => {
    expect(
      errors(recipe([line('ingredient.milk', 1, 'unit.cup_us')]), texts(steps('Pour.'))),
    ).toEqual([expect.stringContaining("unit unit.cup_us isn't a base unit")]);
    expect(
      errors(recipe([line('ingredient.banana', 100, 'unit.g')]), texts(steps('Mash.'))),
    ).toEqual(['starter.test line 0: ingredient.banana is measured by count, not mass']);
    // Mass for a volume ingredient is fine when the catalog has its density.
    expect(errors(recipe([line('ingredient.salt', 5, 'unit.g')]), texts(steps('Add.')))).toEqual(
      [],
    );
  });

  it('fails on a recipe with no new-parent tag', () => {
    expect(
      errors(recipe([line('ingredient.banana')], ['tag.kid_friendly']), texts(steps('Peel.'))),
    ).toEqual(['starter.test: no new-parent tag (FR-REC-2)']);
  });

  describe('safe doneness', () => {
    const chicken = recipe([line('ingredient.chicken_thigh', 500, 'unit.g')]);

    it('fails on poultry without a safe internal temperature', () => {
      const e = errors(chicken, texts(steps('Roast until golden.')));
      expect(e).toHaveLength(3);
      expect(e[0]).toBe(
        'starter.test (en-US): cooks poultry with no safe doneness cue ({temp:74})',
      );
      expect(errors(chicken, texts(steps('Roast until it reads {temp:63}.')))).toHaveLength(3);
    });

    it('accepts poultry cooked to temperature, and checks every locale', () => {
      expect(errors(chicken, texts(steps('Roast until it reads {temp:74}.')))).toEqual([]);
      expect(
        errors(chicken, texts(steps('Roast until it reads {temp:74}.'), steps('Roast it.'))),
      ).toEqual(['starter.test (en-GB): cooks poultry with no safe doneness cue ({temp:74})']);
    });

    it('accepts a visible cue for fish and eggs', () => {
      const fish = recipe([line('ingredient.salmon', 400, 'unit.g')]);
      expect(errors(fish, texts(steps('Bake until it flakes easily.')))).toEqual([]);
      const eggs = recipe([line('ingredient.egg', 2)]);
      expect(errors(eggs, texts(steps('Stir until just set.')))).toEqual([]);
      expect(errors(eggs, texts(steps('Fry briefly.')))[0]).toMatch(/cooks egg with no safe/);
    });

    it('asks more of whole cuts in infant recipes', () => {
      const beef = (tags: string[]) => recipe([line('ingredient.beef_stew', 500, 'unit.g')], tags);
      const text = texts(steps('Simmer until it reads {temp:63}.'));
      expect(errors(beef(['tag.batch_prep']), text)).toEqual([]);
      expect(errors(beef(['tag.toddler']), text)[0]).toMatch(/whole meat .*\{temp:71\}/);
    });
  });

  describe('infant feeding rules', () => {
    const baby = (lines: Line[], tags = ['tag.baby_led_weaning']) => recipe(lines, tags);

    it.each([
      ['ingredient.honey', /honey/],
      ['ingredient.almonds', /whole nuts/],
      ['ingredient.salt', /added salt/],
      ['ingredient.bacon', /processed meat/],
    ])('fails on %s', (id, why) => {
      const e = errors(baby([line(id, 5, 'unit.g')]), texts(steps('Serve.')));
      expect(e.some((m) => why.test(m))).toBe(true);
    });

    it('bans added sugar for babies but not toddlers', () => {
      const sugar = [line('ingredient.sugar', 5, 'unit.g')];
      expect(errors(baby(sugar), texts(steps('Mix.')))[0]).toMatch(/added sugar/);
      expect(errors(baby(sugar, ['tag.toddler']), texts(steps('Mix.')))).toEqual([]);
    });

    it('needs grapes quartered lengthways in every locale', () => {
      const grapes = baby([line('ingredient.grape', 50, 'unit.g')]);
      expect(errors(grapes, texts(steps('Serve.')))).toHaveLength(3);
      expect(
        errors(grapes, texts({ ...steps('Serve.'), lineNotes: { '0': 'quartered lengthways' } })),
      ).toEqual([]);
    });

    it('needs low-salt stock', () => {
      const stock = baby([line('ingredient.vegetable_stock', 500, 'unit.ml')]);
      expect(errors(stock, texts(steps('Simmer.')))[0]).toMatch(/low-salt/);
      expect(errors(stock, texts({ ...steps('Simmer.'), lineNotes: { '0': 'low-salt' } }))).toEqual(
        [],
      );
    });

    it('fails on salt or honey in the text', () => {
      const e = errors(
        baby([line('ingredient.banana')]),
        texts(steps('Boil in salted water.', 'Drizzle with honey.')),
      );
      expect(e.filter((m) => m.startsWith('starter.test (en-US)'))).toEqual([
        'starter.test (en-US): an infant recipe mentions added salt: "Boil in salted water."',
        'starter.test (en-US): an infant recipe mentions honey: "Drizzle with honey."',
      ]);
      expect(errors(recipe([line('ingredient.banana')]), texts(steps('Add honey.')))).toEqual([]);
    });
  });

  describe('text', () => {
    const banana = recipe([line('ingredient.banana')]);

    it('fails on text for an unknown recipe or field', () => {
      const text = texts(steps('Peel.'));
      text['en-GB'] = { 'starter.gone': { title: 'Gone' } } as never;
      (text['en-US'][KEY] as Record<string, unknown>).photo = 'x.jpg';
      expect(errors(banana, text)).toEqual([
        'starter.test: unknown en-US field photo',
        'starter.gone: en-GB text for an unknown recipe',
      ]);
    });

    it('fails on amounts and written-out temperatures, and bad tokens', () => {
      expect(errors(banana, texts(steps('Add 2 cups of milk.')))[0]).toMatch(/an amount/);
      expect(errors(banana, texts(steps('Bake at 180°C.')))[0]).toMatch(/temperature/);
      expect(errors(banana, texts(steps('Bake at {oven:900}.')))[0]).toMatch(/out of range/);
      expect(errors(banana, texts(steps('Bake at {gas:4}.')))[0]).toMatch(/unknown token/);
    });

    it('fails when UK or Australian text keeps a US word', () => {
      const e = errors(banana, texts(steps('Top with yogurt and cilantro.')));
      expect(e).toEqual([
        'starter.test (en-GB): uses the US word "yogurt" (en-GB: yoghurt)',
        'starter.test (en-GB): uses the US word "cilantro" (en-GB: coriander)',
        'starter.test (en-AU): uses the US word "yogurt" (en-AU: yoghurt)',
        'starter.test (en-AU): uses the US word "cilantro" (en-AU: coriander)',
      ]);
      const own = steps('Top with yoghurt and coriander.');
      expect(errors(banana, texts(steps('Top with yogurt and cilantro.'), own, own))).toEqual([]);
    });

    it('fails on a line note for a line that does not exist', () => {
      expect(errors(banana, texts({ ...steps('Peel.'), lineNotes: { '3': 'sliced' } }))).toContain(
        "starter.test (en-US): a line note for line 3, which doesn't exist",
      );
    });
  });

  describe('review sheet', () => {
    const data = recipe(
      [line('ingredient.egg', 2), line('ingredient.milk', 50, 'unit.ml')],
      ['tag.toddler'],
    );
    const text = texts(steps('Whisk, then cook until set.'));

    it('lists allergens from the catalog', () => {
      expect(recipeAllergens(data.recipes[0], catalog)).toEqual(['allergen.egg', 'allergen.milk']);
      expect(reviewSheet(data, text, catalog)).toContain(
        '| Test (`starter.test`) | toddler | egg, milk | yes |  |  |',
      );
    });

    it('fills in review records, and rejects unknown ones', () => {
      const records = { [KEY]: { testCooked: 'Sam, 2026-12-03', healthReview: 'Lee, 2026-12-05' } };
      expect(errors(data, text, records)).toEqual([]);
      expect(reviewSheet(data, text, catalog, records)).toContain(
        '| yes | Sam, 2026-12-03 | Lee, 2026-12-05 |',
      );
      expect(errors(data, text, { 'starter.gone': { testCooked: 'Sam' } })).toEqual([
        'starter.gone: a review record for an unknown recipe',
      ]);
      const grown = recipe([line('ingredient.banana')]);
      expect(errors(grown, texts(steps('Peel.')), { [KEY]: { healthReview: 'Lee' } })).toEqual([
        'starter.test: only baby-led weaning and toddler recipes get a health review',
      ]);
    });
  });
});
