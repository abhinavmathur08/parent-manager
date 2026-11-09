import { ALLERGEN_CODES, SECTION_IDS, nameKey } from '@/features/ingredients/catalog-ids';
import { i18n, SUPPORTED_LOCALES, UNITS } from '@/i18n';

describe('catalog IDs (R-01.1, NFR-L10N-5)', () => {
  it.each(SUPPORTED_LOCALES)('names every section, allergen and unit in %s', (locale) => {
    const t = i18n.getFixedT(locale);
    for (const id of [...SECTION_IDS, ...ALLERGEN_CODES]) {
      const key = nameKey(id);
      expect(i18n.exists(key, { lng: locale })).toBe(true);
      expect(t(key)).not.toBe(key);
    }
    for (const unit of Object.values(UNITS)) {
      expect(i18n.exists(`units.${unit.label}_other`, { lng: locale })).toBe(true);
    }
  });

  it('uses regional words for the same IDs', () => {
    expect(i18n.getFixedT('en-US')(nameKey('section.produce'))).toBe('Produce');
    expect(i18n.getFixedT('en-GB')(nameKey('section.produce'))).toBe('Fruit and veg');
    expect(i18n.getFixedT('en-GB')(nameKey('allergen.sulphite'))).toBe('Sulphites');
    expect(i18n.getFixedT('en-US')(nameKey('allergen.sulphite'))).toBe('Sulfites');
  });

  it('covers the nine US major allergens', () => {
    for (const code of [
      'milk',
      'egg',
      'fish',
      'crustacean',
      'tree_nut',
      'peanut',
      'wheat',
      'soy',
      'sesame',
    ]) {
      expect(ALLERGEN_CODES).toContain(`allergen.${code}`);
    }
  });
});
