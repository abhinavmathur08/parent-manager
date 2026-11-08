import { theme } from '@/constants/theme';

// The app's TypeScript config has no Node types, so load fs untyped.
const fs = jest.requireActual<{ readFileSync(path: string, encoding: 'utf8'): string }>('fs');
const doc = fs.readFileSync(`${process.cwd()}/docs/design-system.md`, 'utf8');

/** Every `group.name` token in the design system's tables, for example `color.primary`. */
function documentedTokens(group: string): string[] {
  const pattern = new RegExp('`' + group + '\\.([A-Za-z0-9]+)`', 'g');
  return [...new Set([...doc.matchAll(pattern)].map((match) => match[1]))];
}

describe('theme tokens match docs/design-system.md', () => {
  it.each(['light', 'dark'] as const)('has every color token in %s mode', (scheme) => {
    const names = documentedTokens('color');
    expect(names.length).toBeGreaterThan(10);
    expect(Object.keys(theme[scheme].color).sort()).toEqual([...names].sort());
  });

  it.each([
    ['type', theme.type],
    ['space', theme.space],
    ['radius', theme.radius],
    ['icon', theme.icon],
    ['layout', theme.layout],
  ] as const)('has every %s token', (group, tokens) => {
    for (const name of documentedTokens(group)) {
      expect(tokens).toHaveProperty([name]);
    }
  });

  it('has every elevation token in both modes', () => {
    for (const name of documentedTokens('elevation')) {
      expect(theme.light.elevation).toHaveProperty([name]);
      expect(theme.dark.elevation).toHaveProperty([name]);
    }
  });

  it('has every motion token', () => {
    for (const name of ['fast', 'base', 'slow']) {
      expect(theme.motion).toHaveProperty([name]);
    }
    expect(theme.motion.easing.standard).toEqual([0.2, 0, 0, 1]);
    expect(theme.motion.easing.exit).toEqual([0.4, 0, 1, 1]);
  });

  it('uses the documented values', () => {
    expect(theme.space).toEqual({
      0: 0,
      1: 4,
      2: 8,
      3: 12,
      4: 16,
      5: 20,
      6: 24,
      8: 32,
      10: 40,
      12: 48,
    });
    expect(theme.radius).toEqual({ sm: 8, control: 12, card: 16, sheet: 22, pill: 999 });
    expect(theme.layout.tabBarClearance).toBe(92);
    expect(theme.layout.minTarget).toBe(48);
    expect(theme.layout.minRowHeight).toBe(56);
  });

  it('keeps body text at 17 pt or more and all text at 12 pt or more', () => {
    expect(theme.type.body.fontSize).toBeGreaterThanOrEqual(17);
    for (const style of Object.values(theme.type)) {
      expect(style.fontSize).toBeGreaterThanOrEqual(12);
    }
  });
});
