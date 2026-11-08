import type { ViewStyle } from 'react-native';

import type { Theme } from '@/hooks/use-theme';

/** Section 8: the focused state is a 3 pt `primary` ring, for keyboard and switch access. */
export function focusRing(theme: Theme, focused: boolean): ViewStyle | null {
  return focused
    ? {
        outlineColor: theme.color.primary,
        outlineWidth: 3,
        outlineStyle: 'solid',
        outlineOffset: 2,
      }
    : null;
}

/** Section 8: pressed controls drop to 92% opacity. */
export const PRESSED_OPACITY = 0.92;
