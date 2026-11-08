import { contrastPairs, theme, type ColorScheme } from '@/constants/theme';
import { contrastRatio, parseHex, relativeLuminance } from '@/lib/contrast';

describe('contrastRatio', () => {
  it('matches the WCAG reference values', () => {
    expect(contrastRatio('#000000', '#FFFFFF')).toBeCloseTo(21, 5);
    expect(contrastRatio('#FFFFFF', '#FFFFFF')).toBeCloseTo(1, 5);
    expect(relativeLuminance('#FFFFFF')).toBeCloseTo(1, 5);
  });

  it('is symmetric', () => {
    expect(contrastRatio('#3F6B4F', '#FAF7F2')).toBeCloseTo(
      contrastRatio('#FAF7F2', '#3F6B4F'),
      10,
    );
  });

  it('rejects colors it cannot measure', () => {
    expect(() => parseHex('rgba(0,0,0,0.5)')).toThrow();
  });
});

// NFR-A11Y-1: every allowed pair in design-system.md section 2 meets WCAG 2.2 AA.
describe.each<ColorScheme>(['light', 'dark'])('%s mode allowed pairs', (scheme) => {
  const pairs = contrastPairs.filter((pair) => !pair.scheme || pair.scheme === scheme);
  it.each(pairs.map((pair) => [`${pair.foreground} on ${pair.background}`, pair] as const))(
    '%s meets its minimum',
    (_name, pair) => {
      const colors = theme[scheme].color;
      const ratio = contrastRatio(colors[pair.foreground], colors[pair.background]);
      expect(Math.floor(ratio * 100) / 100).toBeGreaterThanOrEqual(pair.minimum);
    },
  );
});
