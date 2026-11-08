import { formatCurrency, formatDate, formatNumber, i18n, resolveLocale } from '@/i18n';
import { pseudoLocalize } from '@/i18n/pseudo';

describe('resolveLocale', () => {
  it.each([
    [[{ languageCode: 'en', regionCode: 'US' }], 'en-US'],
    [[{ languageCode: 'en', regionCode: 'GB' }], 'en-GB'],
    [[{ languageCode: 'en', regionCode: 'NZ' }], 'en-AU'],
    [
      [
        { languageCode: 'fr', regionCode: 'FR' },
        { languageCode: 'en', regionCode: 'AU' },
      ],
      'en-AU',
    ],
    [[{ languageCode: 'de', regionCode: 'DE' }], 'en-US'],
    [[], 'en-US'],
  ])('maps %j to %s', (device, expected) => {
    expect(resolveLocale(device)).toBe(expected);
  });
});

describe('translations', () => {
  it('uses regional vocabulary and falls back to en-US for everything else', () => {
    expect(i18n.getFixedT('en-US')('vocabulary.diapers')).toBe('Diapers');
    expect(i18n.getFixedT('en-GB')('vocabulary.diapers')).toBe('Nappies');
    expect(i18n.getFixedT('en-AU')('vocabulary.stroller')).toBe('Pram');
    expect(i18n.getFixedT('en-GB')('home.title')).toBe('Parent Manager');
  });

  it('has every key of each regional file in en-US', () => {
    const keys = (o: object, p = ''): string[] =>
      Object.entries(o).flatMap(([k, v]) =>
        typeof v === 'object' ? keys(v, `${p}${k}.`) : [`${p}${k}`],
      );
    const base = new Set(keys(require('@/i18n/locales/en-US.json')));
    for (const file of ['en-GB', 'en-AU']) {
      const extra = keys(require(`@/i18n/locales/${file}.json`)).filter((k) => !base.has(k));
      expect(extra).toEqual([]);
    }
  });
});

describe('formatters', () => {
  it('formats by locale rather than by string building', () => {
    expect(formatNumber(1234.5, 'en-US')).toBe('1,234.5');
    expect(formatCurrency(12.5, 'GBP', 'en-GB')).toBe('£12.50');
    const date = new Date(Date.UTC(2026, 10, 9, 12));
    expect(formatDate(date, 'en-US', { month: 'numeric', day: 'numeric', timeZone: 'UTC' })).toBe(
      '11/9',
    );
    expect(formatDate(date, 'en-GB', { month: 'numeric', day: 'numeric', timeZone: 'UTC' })).toBe(
      '09/11',
    );
  });
});

describe('pseudoLocalize', () => {
  it('accents letters, doubles the length and keeps placeholders', () => {
    const out = pseudoLocalize('Hi {{name}}');
    expect(out).toBe('⟦Ĥí {{name}}~~~⟧');
  });
});
