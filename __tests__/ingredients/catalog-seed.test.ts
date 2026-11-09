import { ALLERGEN_CODES, SECTION_IDS } from '@/features/ingredients/catalog-ids';

type Names = { name: string; plural: string | null; synonyms: string[] };
type Item = {
  id: string;
  section: string;
  dimension: string;
  density: number | null;
  allergens: string[];
  staple: boolean;
  names: Record<string, Names>;
};

const catalog: { ingredients: Item[] } = require('../../supabase/catalog/ingredients.json');
const { normalize, validate, toSql } = require('../../scripts/catalog-seed.js');

const byId = (id: string) => catalog.ingredients.find((i) => i.id === id)!;
const findIds = (locale: string, term: string) =>
  catalog.ingredients
    .filter((i) => {
      const n = i.names[locale];
      return [n.name, n.plural, ...n.synonyms].some((t) => t && normalize(t) === normalize(term));
    })
    .map((i) => i.id);

describe('ingredient catalog (R-01.2)', () => {
  it('passes validation', () => {
    expect(validate(catalog)).toEqual([]);
  });

  it('has about 400 common ingredients', () => {
    expect(catalog.ingredients.length).toBeGreaterThanOrEqual(400);
  });

  it('gives every ingredient a known section and names in every locale', () => {
    for (const item of catalog.ingredients) {
      expect(SECTION_IDS).toContain(item.section);
      for (const code of item.allergens) expect(ALLERGEN_CODES).toContain(code);
      for (const locale of ['en-US', 'en-GB', 'en-AU'])
        expect(item.names[locale].name).toBeTruthy();
    }
  });

  it.each(['en-US', 'en-GB', 'en-AU'])(
    'resolves "courgette" and "zucchini" to one ID in %s',
    (locale) => {
      expect(findIds(locale, 'courgette')).toEqual(['ingredient.zucchini']);
      expect(findIds(locale, 'zucchini')).toEqual(['ingredient.zucchini']);
    },
  );

  it("uses each region's own name first", () => {
    expect(byId('ingredient.zucchini').names['en-GB'].name).toBe('courgette');
    expect(byId('ingredient.bell_pepper').names['en-AU'].name).toBe('capsicum');
    expect(byId('ingredient.cilantro').names['en-GB'].name).toBe('coriander');
    expect(byId('ingredient.ground_beef').names['en-AU'].name).toBe('beef mince');
  });

  it('keeps regional false friends apart', () => {
    // "Tomato sauce" is ketchup in Australia, but a cooking sauce in the US.
    expect(findIds('en-AU', 'tomato sauce')).toEqual(['ingredient.ketchup']);
    expect(findIds('en-US', 'tomato sauce')).toEqual(['ingredient.tomato_sauce']);
    // "Chips" are crisps in the US and Australia, and fries in the UK.
    expect(findIds('en-US', 'chips')).toEqual(['ingredient.potato_chips']);
    expect(findIds('en-GB', 'chips')).toEqual(['ingredient.frozen_fries']);
    // "Pepper" on its own is black pepper.
    expect(findIds('en-GB', 'pepper')).toEqual(['ingredient.black_pepper']);
  });

  it("flags the spec's default staples (FR-PAN-1)", () => {
    const staples = catalog.ingredients.filter((i) => i.staple).map((i) => i.id);
    expect(staples.sort()).toEqual(
      [
        'ingredient.black_pepper',
        'ingredient.flour',
        'ingredient.salt',
        'ingredient.sugar',
        'ingredient.vegetable_oil',
        'ingredient.water',
      ].sort(),
    );
  });

  it('carries allergen codes for common allergens (AI-11)', () => {
    expect(byId('ingredient.milk').allergens).toContain('allergen.milk');
    expect(byId('ingredient.peanut_butter').allergens).toContain('allergen.peanut');
    expect(byId('ingredient.shrimp').allergens).toContain('allergen.crustacean');
    expect(byId('ingredient.soy_sauce').allergens).toEqual(
      expect.arrayContaining(['allergen.soy', 'allergen.wheat']),
    );
    expect(byId('ingredient.flour').allergens).toContain('allergen.gluten');
    expect(byId('ingredient.tahini').allergens).toContain('allergen.sesame');
  });

  it('flags every seafood and cheese item', () => {
    const seafood = ['allergen.fish', 'allergen.crustacean', 'allergen.mollusc'];
    for (const item of catalog.ingredients) {
      if (item.section === 'section.seafood') {
        expect(item.allergens.some((a) => seafood.includes(a))).toBe(true);
      }
      if (/cheese/.test(item.names['en-US'].name))
        expect(item.allergens).toContain('allergen.milk');
    }
  });

  it('has a density for flour, sugar and butter, so cups and grams merge (R-UNIT-2)', () => {
    for (const id of ['ingredient.flour', 'ingredient.sugar', 'ingredient.butter']) {
      expect(byId(id).density).toBeGreaterThan(0);
    }
  });

  it('finds two ingredients answering to one word', () => {
    const broken = {
      ingredients: [
        byId('ingredient.zucchini'),
        { ...byId('ingredient.eggplant'), names: byId('ingredient.zucchini').names },
      ],
    };
    expect(validate(broken).join()).toMatch(/names ingredient\.zucchini and ingredient\.eggplant/);
  });

  it('escapes quotes in the generated SQL', () => {
    const sql: string = toSql(catalog);
    expect(sql).toContain("'confectioners'' sugar'");
  });
});
