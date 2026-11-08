import { SymbolView } from 'expo-symbols';
import { I18nManager, type StyleProp, type ViewStyle } from 'react-native';

import type { ColorToken } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

/**
 * The app's icon set (design system section 7): SF Symbols on iOS and Material Symbols on
 * Android, both outline style, through `expo-symbols`. Add a name here before using it.
 */
const SYMBOLS = {
  add: { ios: 'plus', android: 'add' },
  remove: { ios: 'minus', android: 'remove' },
  search: { ios: 'magnifyingglass', android: 'search' },
  close: { ios: 'xmark', android: 'close' },
  clear: { ios: 'xmark.circle.fill', android: 'cancel' },
  check: { ios: 'checkmark', android: 'check' },
  forward: { ios: 'chevron.forward', android: 'chevron_right' },
  back: { ios: 'chevron.backward', android: 'arrow_back' },
  clock: { ios: 'clock', android: 'schedule' },
  warning: { ios: 'exclamationmark.triangle', android: 'warning' },
  info: { ios: 'info.circle', android: 'info' },
  offline: { ios: 'wifi.slash', android: 'wifi_off' },
  plan: { ios: 'calendar', android: 'calendar_today' },
  list: { ios: 'checklist', android: 'checklist' },
  recipes: { ios: 'book', android: 'menu_book' },
  household: { ios: 'house', android: 'home' },
  people: { ios: 'person.2', android: 'group' },
} as const;

export type IconName = keyof typeof SYMBOLS;

/** Icons that point along the reading direction and mirror in right-to-left layouts. */
const DIRECTIONAL: readonly IconName[] = ['forward', 'back'];

export type IconProps = {
  name: IconName;
  /** An `icon.*` token. Defaults to `md` (24). */
  size?: 'sm' | 'md' | 'lg';
  /** A `color.*` token. Defaults to `text`. */
  color?: ColorToken;
  style?: StyleProp<ViewStyle>;
  testID?: string;
};

/**
 * A decorative icon. It's hidden from screen readers: the control or text next to it
 * carries the meaning (section 7, "an icon is never the only carrier of meaning").
 */
export function Icon({ name, size = 'md', color = 'text', style, testID }: IconProps) {
  const theme = useTheme();
  const mirror = I18nManager.isRTL && DIRECTIONAL.includes(name);
  return (
    <SymbolView
      name={SYMBOLS[name]}
      size={theme.icon[size]}
      tintColor={theme.color[color]}
      style={[
        { width: theme.icon[size], height: theme.icon[size] },
        mirror && { transform: [{ scaleX: -1 }] },
        style,
      ]}
      testID={testID}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    />
  );
}
