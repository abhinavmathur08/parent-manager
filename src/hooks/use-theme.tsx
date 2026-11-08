import { createContext, useContext, useMemo, type ReactNode } from 'react';

import { theme, type ColorScheme } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';

type ThemeOverrides = {
  /** Forces a scheme for a subtree, for example the component gallery's dark preview. */
  scheme?: ColorScheme;
  /**
   * Multiplies every text size in a subtree, on top of the system text size. Only the
   * component gallery uses it, to preview the largest accessibility size.
   */
  fontScale?: number;
};

const ThemeOverrideContext = createContext<ThemeOverrides>({});

export function ThemeOverride({
  children,
  scheme,
  fontScale,
}: ThemeOverrides & { children: ReactNode }) {
  const parent = useContext(ThemeOverrideContext);
  const value = useMemo(
    () => ({ scheme: scheme ?? parent.scheme, fontScale: fontScale ?? parent.fontScale }),
    [scheme, fontScale, parent.scheme, parent.fontScale],
  );
  return <ThemeOverrideContext.Provider value={value}>{children}</ThemeOverrideContext.Provider>;
}

export function buildTheme(scheme: ColorScheme, fontScale = 1) {
  const modeTokens = theme[scheme];
  return {
    scheme,
    fontScale,
    color: modeTokens.color,
    elevation: modeTokens.elevation,
    avatarRing: modeTokens.avatarRing,
    type: theme.type,
    space: theme.space,
    radius: theme.radius,
    motion: theme.motion,
    icon: theme.icon,
    layout: theme.layout,
    fonts: theme.fonts,
  };
}

export type Theme = ReturnType<typeof buildTheme>;

/** The current tokens. Light and dark follow the system appearance unless overridden. */
export function useTheme(): Theme {
  const system = useColorScheme();
  const overrides = useContext(ThemeOverrideContext);
  const scheme: ColorScheme = overrides.scheme ?? (system === 'dark' ? 'dark' : 'light');
  return useMemo(() => buildTheme(scheme, overrides.fontScale), [scheme, overrides.fontScale]);
}
