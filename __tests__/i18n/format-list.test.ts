import { formatList } from '@/i18n';

describe('formatList', () => {
  it('uses the locale list format', () => {
    expect(formatList(['Peanuts'], 'en-US')).toBe('Peanuts');
    expect(formatList(['Peanuts', 'Egg', 'Milk'], 'en-US')).toBe('Peanuts, Egg, and Milk');
    expect(formatList(['Peanuts', 'Egg', 'Milk'], 'en-GB')).toBe('Peanuts, Egg and Milk');
  });

  it('falls back to the locale separator without Intl.ListFormat (Hermes)', () => {
    const original = Intl.ListFormat;
    // @ts-expect-error: simulating an engine without ListFormat
    delete Intl.ListFormat;
    try {
      expect(formatList(['Peanuts', 'Egg'], 'en-US')).toBe('Peanuts, Egg');
    } finally {
      Intl.ListFormat = original;
    }
  });
});
