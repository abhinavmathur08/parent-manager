import { displayQuantity, formatQuantity, toBase, type QuantityPart } from '@/i18n';

const show = (parts: QuantityPart[], locale = 'en-US') => formatQuantity(parts, locale);

describe('US customary display (R-UNIT-3, R-UNIT-4)', () => {
  it('merges cups in base units and shows cups', () => {
    const base = toBase(1, 'unit.cup_us') + toBase(2, 'unit.cup_us');
    expect(show(displayQuantity(base, 'volume', 'us_customary'))).toBe('3 cups');
  });

  it('shows fractional cups to the nearest quarter, singular up to one', () => {
    expect(show(displayQuantity(toBase(0.5, 'unit.cup_us'), 'volume', 'us_customary'))).toBe(
      '½ cup',
    );
    expect(show(displayQuantity(toBase(1.5, 'unit.cup_us'), 'volume', 'us_customary'))).toBe(
      '1½ cups',
    );
  });

  it('uses tsp and tbsp for small amounts', () => {
    expect(show(displayQuantity(toBase(1, 'unit.tsp_us'), 'volume', 'us_customary'))).toBe('1 tsp');
    expect(show(displayQuantity(toBase(2, 'unit.tbsp_us'), 'volume', 'us_customary'))).toBe(
      '2 tbsp',
    );
  });

  it('switches liquids over 4 cups to quarts', () => {
    expect(
      show(displayQuantity(toBase(8, 'unit.cup_us'), 'volume', 'us_customary', { liquid: true })),
    ).toBe('2 qt');
  });

  it('shows ounces under a pound and pounds with ounces above', () => {
    expect(show(displayQuantity(toBase(8, 'unit.oz'), 'mass', 'us_customary'))).toBe('8 oz');
    expect(show(displayQuantity(toBase(20, 'unit.oz'), 'mass', 'us_customary'))).toBe('1 lb 4 oz');
    expect(show(displayQuantity(toBase(32, 'unit.oz'), 'mass', 'us_customary'))).toBe('2 lb');
  });

  it('never rounds a non-zero amount down to zero', () => {
    expect(show(displayQuantity(1, 'volume', 'us_customary'))).toBe('¼ tsp');
  });
});

describe('Metric display for AU and GB', () => {
  it('treats an Australian tablespoon as 20 ml', () => {
    expect(toBase(2, 'unit.tbsp_au')).toBe(40);
    expect(show(displayQuantity(toBase(2, 'unit.tbsp_au'), 'volume', 'metric'), 'en-AU')).toBe(
      '40 ml',
    );
  });

  it('rounds ml and g by size, then switches to L and kg', () => {
    expect(show(displayQuantity(237, 'volume', 'metric'), 'en-AU')).toBe('225 ml');
    expect(show(displayQuantity(1250, 'volume', 'metric'), 'en-AU')).toBe('1.3 L');
    expect(show(displayQuantity(453.6, 'mass', 'metric'), 'en-AU')).toBe('450 g');
    expect(show(displayQuantity(1500, 'mass', 'metric'), 'en-AU')).toBe('1.5 kg');
  });

  it('uses UK unit names', () => {
    expect(show(displayQuantity(2000, 'volume', 'metric'), 'en-GB')).toBe('2 litres');
  });
});

describe('Counts', () => {
  it('rounds up for shopping and shows the number only', () => {
    expect(show(displayQuantity(2.25, 'count', 'us_customary'))).toBe('3');
  });
});
