import {
  buildNameIndex,
  catalogIndexInput,
  loadParserVocabulary,
  normalize,
  parseIngredientLine,
  resolveUnitKey,
  searchIngredients,
  type IngredientInfo,
  type IngredientNames,
  type NameIndex,
} from '@/features/ingredients/matching';
import { SUPPORTED_LOCALES, type AppLocale, type Region } from '@/i18n';

const catalog = require('../../supabase/catalog/ingredients.json');
const seedScript = require('../../scripts/catalog-seed.js');

const REGION: Record<AppLocale, Region> = { 'en-US': 'US', 'en-GB': 'GB', 'en-AU': 'AU' };

const indexFor = (
  locale: AppLocale,
  extra?: { ingredients: IngredientInfo[]; names: IngredientNames[] },
) => {
  const input = catalogIndexInput(catalog, locale);
  return buildNameIndex(
    locale,
    [...input.ingredients, ...(extra?.ingredients ?? [])],
    [...input.names, ...(extra?.names ?? [])],
  );
};
const indexes = Object.fromEntries(SUPPORTED_LOCALES.map((l) => [l, indexFor(l)])) as Record<
  AppLocale,
  NameIndex
>;

const parse = (text: string, locale: AppLocale = 'en-US', region: Region = REGION[locale]) =>
  parseIngredientLine(text, {
    index: indexes[locale],
    vocabulary: loadParserVocabulary(locale),
    region,
  });
const ids = (index: NameIndex, query: string) =>
  searchIngredients(index, query).map((r) => r.ingredientId);

describe('normalize', () => {
  it('ignores case, accents and punctuation', () => {
    expect(normalize('Crème Fraîche')).toBe('creme fraiche');
    expect(normalize("Confectioners' Sugar")).toBe('confectioners sugar');
    expect(normalize('  All-Purpose   FLOUR ')).toBe('all purpose flour');
  });

  it('folds exactly like the catalog check, so both agree on collisions', () => {
    for (const item of catalog.ingredients) {
      for (const n of Object.values(item.names) as IngredientNames[]) {
        for (const term of [n.name, n.plural, ...n.synonyms].filter(Boolean) as string[]) {
          expect(normalize(term)).toBe(seedScript.normalize(term));
        }
      }
    }
  });
});

describe('searchIngredients (FR-REC-5, FR-LIST-6)', () => {
  it.each(SUPPORTED_LOCALES)('finds courgette and zucchini as one ID in %s', (locale) => {
    expect(ids(indexes[locale], 'courgette')[0]).toBe('ingredient.zucchini');
    expect(ids(indexes[locale], 'zucchini')[0]).toBe('ingredient.zucchini');
  });

  it("shows the locale's own name for the matched ID", () => {
    const [gb] = searchIngredients(indexes['en-GB'], 'zucchini');
    const [us] = searchIngredients(indexes['en-US'], 'courgette');
    expect(gb.displayName).toBe('courgette');
    expect(us.displayName).toBe('zucchini');
  });

  it('lists each ingredient once, however many of its words match', () => {
    const results = searchIngredients(indexes['en-US'], 'milk', { limit: 50 });
    const unique = new Set(results.map((r) => r.ingredientId));
    expect(unique.size).toBe(results.length);
    expect(results[0].ingredientId).toBe('ingredient.milk');
  });

  it('ranks an exact name, then prefixes, then words inside a name', () => {
    const results = searchIngredients(indexes['en-US'], 'onion');
    expect(results[0]).toMatchObject({ ingredientId: 'ingredient.onion', score: 100 });
    expect(results.map((r) => r.ingredientId)).toEqual(
      expect.arrayContaining(['ingredient.red_onion', 'ingredient.onion_powder']),
    );
  });

  it('matches as the user types', () => {
    expect(ids(indexes['en-US'], 'zucc')[0]).toBe('ingredient.zucchini');
    expect(ids(indexes['en-GB'], 'cour')).toContain('ingredient.zucchini');
    expect(ids(indexes['en-US'], 'chick bre')[0]).toBe('ingredient.chicken_breast');
  });

  it('forgives a typo', () => {
    expect(ids(indexes['en-US'], 'zuchini')[0]).toBe('ingredient.zucchini');
    expect(ids(indexes['en-GB'], 'aubergene')[0]).toBe('ingredient.eggplant');
  });

  it('returns nothing for empty or unknown text', () => {
    expect(searchIngredients(indexes['en-US'], '  ')).toEqual([]);
    expect(searchIngredients(indexes['en-US'], 'qwxz')).toEqual([]);
  });

  it("uses regional words through each locale's own index", () => {
    expect(ids(indexes['en-AU'], 'capsicum')[0]).toBe('ingredient.bell_pepper');
    expect(ids(indexes['en-AU'], 'tomato sauce')[0]).toBe('ingredient.ketchup');
    expect(ids(indexes['en-US'], 'tomato sauce')[0]).toBe('ingredient.tomato_sauce');
  });

  it('finds household ingredients, and ranks them first on a tie', () => {
    const household = 'ingredient.h.0123456789abcdef0123456789abcdef';
    const index = indexFor('en-US', {
      ingredients: [{ id: household, defaultDimension: 'count', householdId: 'h1' }],
      names: [
        { ingredientId: household, name: "Grandma's chutney", plural: null, synonyms: ['relish'] },
      ],
    });
    expect(ids(index, 'grandmas chutney')[0]).toBe(household);
    expect(ids(index, 'relish')[0]).toBe(household);
    expect(ids(index, 'relish')).toContain('ingredient.relish');
  });

  it('answers within 200 ms for the full catalog', () => {
    const queries = [
      'm',
      'mi',
      'mil',
      'milk',
      'chick',
      'chicken th',
      'zuchini',
      'tom',
      'garlic',
      'xyzzy',
    ];
    for (const locale of SUPPORTED_LOCALES) {
      for (const q of queries) {
        const start = performance.now();
        searchIngredients(indexes[locale], q);
        expect(performance.now() - start).toBeLessThan(200);
      }
    }
  });

  it('builds the index within 200 ms', () => {
    const start = performance.now();
    indexFor('en-GB');
    expect(performance.now() - start).toBeLessThan(200);
  });
});

describe('parseIngredientLine', () => {
  it.each(SUPPORTED_LOCALES)('resolves every unit word in %s to a unit ID', (locale) => {
    const vocabulary = loadParserVocabulary(locale);
    for (const key of [
      ...Object.keys(vocabulary.units),
      ...Object.keys(vocabulary.caseSensitiveUnits),
    ]) {
      for (const region of ['US', 'GB', 'AU'] as const)
        expect(resolveUnitKey(key, region)).not.toBeNull();
    }
  });

  it('reads quantity, unit and ingredient', () => {
    expect(parse('2 cups whole milk, warm')).toMatchObject({
      quantity: 2,
      unitId: 'unit.cup_us',
      ingredientId: 'ingredient.milk',
      match: 'exact',
      notes: ['warm'],
    });
    expect(parse('2 cups whole milk, warm').quantityBase).toBeCloseTo(473.176, 3);
  });

  it.each([
    ['1/2 cup sugar', 0.5],
    ['1 1/2 cups sugar', 1.5],
    ['1-1/2 cups sugar', 1.5],
    ['1½ cups sugar', 1.5],
    ['½ cup sugar', 0.5],
    ['0.75 cup sugar', 0.75],
    ['¾ cup sugar', 0.75],
  ])('reads "%s" as %d cups (FR-REC-5)', (line, quantity) => {
    expect(parse(line)).toMatchObject({
      quantity,
      unitId: 'unit.cup_us',
      ingredientId: 'ingredient.sugar',
    });
  });

  describe('regional units (R-ING-2)', () => {
    it.each([
      ['en-US', 'unit.tbsp_us', 14.7868],
      ['en-GB', 'unit.tbsp_metric', 15],
      ['en-AU', 'unit.tbsp_au', 20],
    ] as const)('reads "1 tbsp" in %s as %s', (locale, unitId, ml) => {
      const line = parse('1 tbsp olive oil', locale);
      expect(line).toMatchObject({ unitId, ingredientId: 'ingredient.olive_oil' });
      expect(line.quantityBase).toBeCloseTo(ml, 4);
    });

    it("follows the household's region, not its language", () => {
      expect(parse('1 cup rice', 'en-US', 'AU')).toMatchObject({
        unitId: 'unit.cup_metric',
        quantityBase: 250,
      });
    });

    it('reads cups, teaspoons and pints by region', () => {
      expect(parse('1 cup flour', 'en-GB').unitId).toBe('unit.cup_metric');
      expect(parse('2 tsp salt', 'en-AU').unitId).toBe('unit.tsp_metric');
      expect(parse('1 pint milk', 'en-GB').unitId).toBe('unit.pint_imperial');
      expect(parse('1 pint milk', 'en-US').unitId).toBe('unit.pint_us');
      expect(parse('4 fl oz cream', 'en-GB').unitId).toBe('unit.floz_imperial');
    });

    it('respects an explicitly regional unit', () => {
      expect(parse('1 US cup milk', 'en-AU').unitId).toBe('unit.cup_us');
      expect(parse('1 metric cup milk', 'en-US').unitId).toBe('unit.cup_metric');
      expect(parse('1 imperial pint milk', 'en-US').unitId).toBe('unit.pint_imperial');
    });

    it('reads T as tablespoon and t as teaspoon', () => {
      expect(parse('1 T butter').unitId).toBe('unit.tbsp_us');
      expect(parse('1 t salt').unitId).toBe('unit.tsp_us');
    });
  });

  it.each([
    ['200g flour', 'unit.g', 200],
    ['200 g flour', 'unit.g', 200],
    ['1.5kg potatoes', 'unit.kg', 1500],
    ['500 ml stock', 'unit.ml', 500],
    ['1 litre water', 'unit.l', 1000],
    ['8 oz cheddar cheese', 'unit.oz', 226.796],
    ['1 lb ground beef', 'unit.lb', 453.592],
  ] as const)('reads metric and imperial units in "%s"', (line, unitId, base) => {
    const parsed = parse(line);
    expect(parsed.unitId).toBe(unitId);
    expect(parsed.quantityBase).toBeCloseTo(base, 2);
    expect(parsed.ingredientId).not.toBeNull();
  });

  it('counts a counted ingredient with no unit (FR-REC-6)', () => {
    expect(parse('2 onions')).toMatchObject({
      quantity: 2,
      unitId: 'unit.each',
      quantityBase: 2,
      ingredientId: 'ingredient.onion',
    });
    expect(parse('3 eggs')).toMatchObject({ unitId: 'unit.each', ingredientId: 'ingredient.egg' });
  });

  it('treats an unmeasured, uncounted ingredient as to taste (FR-REC-6, R-ING-4)', () => {
    expect(parse('salt, to taste')).toMatchObject({
      quantity: null,
      unitId: null,
      quantityBase: null,
      ingredientId: 'ingredient.salt',
      notes: ['to taste'],
    });
    expect(parse('2 salmon')).toMatchObject({ quantity: 2, unitId: null, quantityBase: null });
  });

  it('keeps a pinch or a dash as written, with no base quantity (R-ING-5)', () => {
    expect(parse('a pinch of salt')).toMatchObject({
      quantity: 1,
      unitId: 'unit.pinch',
      quantityBase: null,
      ingredientId: 'ingredient.salt',
    });
    expect(parse('Pinch of nutmeg')).toMatchObject({
      quantity: null,
      unitId: 'unit.pinch',
      ingredientId: 'ingredient.nutmeg',
    });
    expect(parse('dash of Worcestershire sauce').unitId).toBe('unit.dash');
  });

  it('reads containers and pieces as counts', () => {
    expect(parse('2 cloves garlic, minced')).toMatchObject({
      quantity: 2,
      unitId: 'unit.each',
      ingredientId: 'ingredient.garlic',
      notes: ['minced'],
    });
    expect(parse('1 (400 g) tin chickpeas', 'en-GB')).toMatchObject({
      quantity: 1,
      unitId: 'unit.each',
      ingredientId: 'ingredient.chickpeas',
      notes: ['400 g'],
    });
    expect(parse('1 can of diced tomatoes').ingredientId).toBe('ingredient.canned_tomatoes');
  });

  it('prefers a whole ingredient name over a unit word inside it', () => {
    expect(parse('1 head of garlic')).toMatchObject({
      ingredientId: 'ingredient.garlic_bulb',
      unitId: 'unit.each',
    });
  });

  it('reads number words', () => {
    expect(parse('an onion')).toMatchObject({ quantity: 1, ingredientId: 'ingredient.onion' });
    expect(parse('two carrots')).toMatchObject({ quantity: 2, ingredientId: 'ingredient.carrot' });
    expect(parse('half a cup milk')).toMatchObject({ quantity: 0.5, unitId: 'unit.cup_us' });
    expect(parse('a dozen eggs')).toMatchObject({ quantity: 12, ingredientId: 'ingredient.egg' });
  });

  it('reads a range and buys for the top of it (PROPOSED)', () => {
    expect(parse('2-3 cloves garlic')).toMatchObject({ quantity: 3, quantityFrom: 2 });
    expect(parse('2 to 3 tbsp olive oil')).toMatchObject({
      quantity: 3,
      quantityFrom: 2,
      unitId: 'unit.tbsp_us',
    });
    expect(parse('1–2 lemons')).toMatchObject({
      quantity: 2,
      quantityFrom: 1,
      ingredientId: 'ingredient.lemon',
    });
  });

  it('finds the ingredient among descriptive words', () => {
    expect(parse('3 large yellow onions, diced')).toMatchObject({
      ingredientId: 'ingredient.onion',
      match: 'partial',
    });
    expect(parse('1 cup freshly grated Parmesan cheese')).toMatchObject({
      ingredientId: 'ingredient.parmesan',
      match: 'partial',
    });
    expect(parse('2 boneless skinless chicken thighs').ingredientId).toBe(
      'ingredient.chicken_thigh',
    );
  });

  it('prefers the longer name: "lemon juice" over "lemon"', () => {
    expect(parse('2 tbsp lemon juice').ingredientId).toBe('ingredient.lemon_juice');
    expect(parse('1 tsp garlic powder').ingredientId).toBe('ingredient.garlic_powder');
  });

  it("matches plurals that the catalog doesn't list", () => {
    expect(parse('3 zucchinis').ingredientId).toBe('ingredient.zucchini');
  });

  it('resolves regional words to the same ID in every locale', () => {
    for (const locale of SUPPORTED_LOCALES) {
      expect(parse('2 courgettes', locale).ingredientId).toBe('ingredient.zucchini');
      expect(parse('2 zucchini', locale).ingredientId).toBe('ingredient.zucchini');
      expect(parse('1 red capsicum', locale).ingredientId).toBe('ingredient.bell_pepper');
    }
  });

  it('falls back to search for a typo, and flags it for review', () => {
    expect(parse('2 zuchinis')).toMatchObject({
      ingredientId: 'ingredient.zucchini',
      match: 'search',
    });
  });

  it('leaves an unknown ingredient unmatched rather than guessing', () => {
    expect(parse('1 cup unobtainium')).toMatchObject({
      quantity: 1,
      unitId: 'unit.cup_us',
      ingredientId: null,
      match: 'none',
    });
  });

  it('keeps the raw text for review (FR-AI-5)', () => {
    expect(parse('  1 cup milk ').raw).toBe('1 cup milk');
  });

  it('copes with empty and number-only lines', () => {
    expect(parse('')).toMatchObject({ quantity: null, ingredientId: null, match: 'none' });
    expect(parse('2')).toMatchObject({ quantity: 2, ingredientId: null });
  });
});
