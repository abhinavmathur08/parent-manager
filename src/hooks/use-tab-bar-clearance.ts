import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useTheme } from '@/hooks/use-theme';

/**
 * How far above the screen's bottom edge the floating tab bar reaches: `layout.tabBarClearance`
 * plus the bottom safe area. Tab screens end their scrolling area here, so no row can sit under
 * the bar, where it can't be tapped (design system section 4).
 */
export function useTabBarClearance(): number {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  return theme.layout.tabBarClearance + insets.bottom;
}
