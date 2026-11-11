import { formatList } from '@/i18n';

describe('formatList', () => {
  it('uses the locale list format', () => {
    expect(formatList(['Peanuts'], 'en-US')).toBe('Peanuts');
    expect(formatList(['Peanuts', 'Egg', 'Milk'], 'en-US')).toBe('Peanuts, Egg, and Milk');
    expect(formatList(['Peanuts', 'Egg', 'Milk'], 'en-GB')).toBe('Peanuts, Egg and Milk');
  });

  it('falls back to the locale separator without Intl.ListFormat (Hermes)', () => {
    const original = Object.getOwnPropertyDescriptor(Intl, 'ListFormat');
    Object.defineProperty(Intl, 'ListFormat', { value: undefined, configurable: true });
    try {
      expect(formatList(['Peanuts', 'Egg'], 'en-US')).toBe('Peanuts, Egg');
    } finally {
      if (original) Object.defineProperty(Intl, 'ListFormat', original);
    }
  });
});
