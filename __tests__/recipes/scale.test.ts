import { formatQuantity, i18n } from '@/i18n';

import { allergenMatches, scaledLineText, scaledParts } from '@/features/recipes/scale';

const t = i18n.getFixedT('en-US');
const line = (quantity: number | null, unitId: string | null) => ({
  ingredientId: 'ingredient.milk',
  quantity,
  unitId,
  note: null,
});
const show = (parts: ReturnType<typeof scaledParts>) =>
  parts ? formatQuantity(parts, 'en-US') : null;

describe('scaling 4 to 6 servings (FR-REC-8, acceptance of R-03.2)', () => {
  const ratio = 6 / 4;

  it('keeps a unit of the household system and scales it', () => {
    expect(show(scaledParts(line(1, 'unit.cup_us'), ratio, 'volume', 'us_customary'))).toBe(
      '1½ cups',
    );
    expect(show(scaledParts(line(200, 'unit.g'), ratio, 'mass', 'metric'))).toBe('300 g');
    expect(show(scaledParts(line(1, 'unit.tbsp_au'), ratio, 'volume', 'metric'))).toBe('1½ tbsp');
  });

  it('converts a unit of the other system from the base quantity', () => {
    // 1 US cup = 236.588 ml; x 1.5 = 354.9 ml, shown to the nearest 25 ml (R-UNIT-4).
    expect(show(scaledParts(line(1, 'unit.cup_us'), ratio, 'volume', 'metric'))).toBe('350 ml');
    // 0.25 kg x 1.5 = 375 g = 13.2 oz, shown to the nearest half ounce.
    expect(show(scaledParts(line(0.25, 'unit.kg'), ratio, 'mass', 'us_customary'))).toBe('13 oz');
  });

  it('rounds counts up and leaves a pinch and "to taste" as written', () => {
    expect(show(scaledParts(line(1, null), ratio, 'count', 'metric'))).toBe('2');
    expect(scaledParts(line(1, 'unit.pinch'), ratio, 'mass', 'metric')).toBeNull();
    expect(scaledParts(line(null, null), ratio, 'mass', 'metric')).toBeNull();
  });

  it('writes the line with the right plural', () => {
    const text = scaledLineText(
      { ingredientId: 'ingredient.onion', quantity: 2, unitId: 'unit.each', note: 'diced' },
      {
        ratio,
        dimension: 'count',
        system: 'us_customary',
        name: (n) => ((n ?? 0) > 1 ? 'onions' : 'onion'),
        locale: 'en-US',
        t,
      },
    );
    expect(text).toBe('3 onions, diced');
  });
});

describe('allergenMatches (FR-REC-9)', () => {
  const allergens = (id: string) =>
    ({ 'ingredient.milk': ['allergen.milk'], 'ingredient.peanut_butter': ['allergen.peanut'] })[
      id
    ] ?? [];

  it('names each allergen with the people allergic to it, by code only', () => {
    expect(
      allergenMatches(['ingredient.milk', 'ingredient.flour'], allergens as never, [
        { displayName: 'Mo', allergies: ['allergen.milk', 'allergen.peanut'] },
        { displayName: 'Ava', allergies: ['allergen.milk'] },
        { displayName: 'Sam', allergies: [] },
      ]),
    ).toEqual([{ allergen: 'allergen.milk', people: ['Mo', 'Ava'] }]);
  });

  it('finds nothing when no one is allergic', () => {
    expect(
      allergenMatches(['ingredient.milk'], allergens as never, [
        { displayName: 'Sam', allergies: [] },
      ]),
    ).toEqual([]);
  });
});
