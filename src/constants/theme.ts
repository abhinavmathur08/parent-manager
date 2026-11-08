/**
 * Design tokens for Calm Kitchen with Village touches (docs/design-system.md).
 *
 * Token names are code names: `color.primary` in the design system is
 * `theme.light.color.primary` and `theme.dark.color.primary` here. Screens and
 * components read tokens through `useTheme()` and never use raw values.
 */
import { Platform, type TextStyle } from 'react-native';

/** Section 2. Light and dark switch with the system appearance setting. */
const lightColor = {
  background: '#FAF7F2',
  surface: '#FFFFFF',
  surfaceAlt: '#F1ECE3',
  border: '#E2DACC',
  text: '#2B2A28',
  textSecondary: '#6B665E',
  primary: '#3F6B4F',
  onPrimary: '#FFFFFF',
  accent: '#B4602F',
  onAccent: '#FFFFFF',
  success: '#2F6B45',
  warning: '#8A5A00',
  error: '#B3261E',
  avatarSand: '#E9CFA6',
  avatarSage: '#B7D3BF',
  onAvatar: '#2B2A28',
  scrim: 'rgba(0,0,0,0.28)',
} as const;

export type ColorToken = keyof typeof lightColor;
export type ColorTokens = Record<ColorToken, string>;

const darkColor: ColorTokens = {
  background: '#1C1B19',
  surface: '#262421',
  surfaceAlt: '#302D29',
  border: '#3D3833',
  text: '#F2EEE8',
  textSecondary: '#B5AFA6',
  primary: '#8DBB9C',
  onPrimary: '#10291A',
  accent: '#E39A6B',
  onAccent: '#2A1406',
  success: '#8FD19E',
  warning: '#E9B949',
  error: '#F2B8B5',
  avatarSand: '#E9CFA6',
  avatarSage: '#B7D3BF',
  onAvatar: '#2B2A28',
  scrim: 'rgba(0,0,0,0.5)',
};

/** Section 5. Only three levels; prefer a hairline border to a shadow. */
export type ElevationStyle = {
  shadowColor?: string;
  shadowOpacity?: number;
  shadowOffset?: { width: number; height: number };
  shadowRadius?: number;
  elevation?: number;
};

const flat: ElevationStyle = {};

const lightElevation = {
  flat,
  floating: {
    shadowColor: '#2B2A28',
    shadowOpacity: 0.12,
    shadowOffset: { width: 0, height: 6 },
    shadowRadius: 20,
    elevation: 6,
  },
  sheet: {
    shadowColor: '#000000',
    shadowOpacity: 0.12,
    shadowOffset: { width: 0, height: -8 },
    shadowRadius: 30,
    elevation: 12,
  },
} satisfies Record<string, ElevationStyle>;

export type ElevationToken = keyof typeof lightElevation;

const darkElevation: Record<ElevationToken, ElevationStyle> = {
  flat,
  floating: { ...lightElevation.floating, shadowColor: '#000000', shadowOpacity: 0.45 },
  sheet: { ...lightElevation.sheet, shadowOpacity: 0.5 },
};

/**
 * Section 3. Fraunces 600 is embedded at build time by the expo-font config plugin
 * (app.config.ts). Android names an embedded font after its file; iOS uses the PostScript
 * name from the file. The system serif is the fallback where neither is available
 * (for example in Jest).
 */
export const fonts = {
  heading: Platform.select({
    ios: 'Fraunces-SemiBold',
    android: 'Fraunces_600SemiBold',
    default: 'serif',
  }),
} as const;

const heading = (fontSize: number, lineHeight: number) => ({
  fontFamily: fonts.heading,
  fontSize,
  lineHeight,
});

const system = (
  fontSize: number,
  lineHeight: number,
  fontWeight: NonNullable<TextStyle['fontWeight']>,
) => ({ fontSize, lineHeight, fontWeight });

export const type = {
  screenTitle: heading(30, 36),
  sheetTitle: heading(22, 28),
  cardTitle: heading(21, 26),
  sectionLabel: heading(19, 24),
  body: system(17, 24, '400'),
  bodyStrong: system(17, 24, '600'),
  label: system(15, 20, '500'),
  caption: system(13, 18, '400'),
  overline: {
    ...system(13, 18, '600'),
    textTransform: 'uppercase' as const,
    letterSpacing: 13 * 0.05,
  },
  tab: system(12, 16, '500'),
  tabActive: system(12, 16, '600'),
} satisfies Record<string, TextStyle>;

export type TypeToken = keyof typeof type;

/** Section 4. A 4-point scale. */
export const space = {
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
} as const;

export type SpaceToken = keyof typeof space;

export const radius = {
  sm: 8,
  control: 12,
  card: 16,
  sheet: 22,
  pill: 999,
} as const;

/** Section 6. Durations in milliseconds; easings as cubic-bezier control points. */
export const motion = {
  fast: 150,
  base: 220,
  slow: 300,
  easing: {
    standard: [0.2, 0, 0, 1],
    exit: [0.4, 0, 1, 1],
  },
} as const;

/** Section 7. */
export const icon = {
  sm: 20,
  md: 24,
  lg: 44,
} as const;

/** Section 4 layout and section 9 target sizes. */
export const layout = {
  screenMargin: space[4],
  sectionGap: space[6],
  itemGap: space[2],
  tabBarClearance: 92,
  maxContentWidth: 640,
  minTarget: 48,
  minRowHeight: 56,
  /** Section 3: the only capped text is the tab bar label. */
  tabLabelMaxFontScale: 1.3,
} as const;

/** Section 2: avatar rings, light mode 1.5 pt textSecondary, dark mode 2 pt surface. */
const avatarRing = {
  light: { width: 1.5, color: 'textSecondary' as ColorToken },
  dark: { width: 2, color: 'surface' as ColorToken },
};

export type ColorScheme = 'light' | 'dark';

export const theme = {
  light: {
    color: lightColor as ColorTokens,
    elevation: lightElevation,
    avatarRing: avatarRing.light,
  },
  dark: { color: darkColor, elevation: darkElevation, avatarRing: avatarRing.dark },
  type,
  space,
  radius,
  motion,
  icon,
  layout,
  fonts,
} as const;

/** Allowed foreground/background pairs from section 2, with the minimum ratio each must meet. */
export type ContrastPair = {
  foreground: ColorToken;
  background: ColorToken;
  /** 4.5 for normal text, 3 for large text and interface parts (WCAG 2.2 AA). */
  minimum: number;
  /** Only checked in this scheme, when the pair is restricted. */
  scheme?: ColorScheme;
};

export const contrastPairs: readonly ContrastPair[] = [
  { foreground: 'text', background: 'background', minimum: 4.5 },
  { foreground: 'text', background: 'surface', minimum: 4.5 },
  { foreground: 'text', background: 'surfaceAlt', minimum: 4.5 },
  { foreground: 'textSecondary', background: 'surface', minimum: 4.5 },
  { foreground: 'textSecondary', background: 'background', minimum: 4.5 },
  { foreground: 'primary', background: 'background', minimum: 4.5 },
  { foreground: 'primary', background: 'surfaceAlt', minimum: 4.5 },
  { foreground: 'onPrimary', background: 'primary', minimum: 4.5 },
  { foreground: 'onAccent', background: 'accent', minimum: 4.5 },
  // Destructive button labels.
  { foreground: 'onPrimary', background: 'error', minimum: 4.5 },
  // Light mode allows accent on background for large text and fills only.
  { foreground: 'accent', background: 'background', minimum: 3, scheme: 'light' },
  { foreground: 'accent', background: 'background', minimum: 4.5, scheme: 'dark' },
  { foreground: 'success', background: 'surface', minimum: 4.5 },
  { foreground: 'warning', background: 'surface', minimum: 4.5 },
  { foreground: 'error', background: 'surface', minimum: 4.5 },
  { foreground: 'onAvatar', background: 'avatarSand', minimum: 7 },
  { foreground: 'onAvatar', background: 'avatarSage', minimum: 7 },
  // Control outlines (checkbox rings, switch tracks) are interface parts: 3:1.
  { foreground: 'textSecondary', background: 'border', minimum: 3 },
];
