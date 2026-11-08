import { Text as NativeText, type TextProps as NativeTextProps } from 'react-native';

import type { ColorToken, TypeToken } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

export type TextProps = Omit<NativeTextProps, 'allowFontScaling'> & {
  /** A `type.*` token. Defaults to `body`. */
  variant?: TypeToken;
  /** A `color.*` token. Defaults to `text`. */
  color?: ColorToken;
  /** Tabular figures, for quantities, counts and codes. */
  tabular?: boolean;
};

/**
 * Themed text. It always scales with the system text size (design system section 3:
 * never `allowFontScaling={false}`), and line heights scale with it.
 */
export function Text({ variant = 'body', color = 'text', tabular, style, ...rest }: TextProps) {
  const theme = useTheme();
  const token = theme.type[variant];
  const scale = theme.fontScale;
  const sized =
    scale === 1
      ? token
      : {
          ...token,
          fontSize: (token.fontSize ?? 17) * scale,
          lineHeight: token.lineHeight ? token.lineHeight * scale : undefined,
        };
  return (
    <NativeText
      style={[
        sized,
        { color: theme.color[color] },
        tabular ? { fontVariant: ['tabular-nums'] } : null,
        style,
      ]}
      {...rest}
    />
  );
}
