import type { ComponentRef, ReactNode, Ref } from 'react';
import { Pressable, StyleSheet, View, type GestureResponderEvent } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { PRESSED_OPACITY } from '@/components/focus-ring';
import { Icon, type IconName } from '@/components/icon';
import { Text } from '@/components/text';
import { useTheme } from '@/hooks/use-theme';

/** Section 8: the bar floats 22 pt above the bottom safe area. */
export const TAB_BAR_OFFSET = 22;
/** Section 8: each tab is 52 pt tall. */
export const TAB_HEIGHT = 52;
const BAR_PADDING = 6;

/** The bar's height plus its offset, which `layout.tabBarClearance` must cover. */
export const TAB_BAR_FOOTPRINT = TAB_HEIGHT + BAR_PADDING * 2 + 2 + TAB_BAR_OFFSET;

export type FloatingTabBarProps = {
  /** Translated name of the tab bar, for screen readers. */
  accessibilityLabel: string;
  children: ReactNode;
  testID: string;
};

/**
 * Section 8 FloatingTabBar: inset `space.4` from the screen edges, `radius.sheet` corners, a
 * hairline border and `elevation.floating`. Sheets cover it, since they open in a modal.
 */
export function FloatingTabBar({ accessibilityLabel, children, testID }: FloatingTabBarProps) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <View
      testID={testID}
      accessibilityRole="tablist"
      accessibilityLabel={accessibilityLabel}
      style={[
        styles.bar,
        theme.elevation.floating,
        {
          start: theme.layout.screenMargin,
          end: theme.layout.screenMargin,
          bottom: insets.bottom + TAB_BAR_OFFSET,
          padding: BAR_PADDING,
          borderRadius: theme.radius.sheet,
          borderColor: theme.color.border,
          backgroundColor: theme.color.surface,
        },
      ]}
    >
      {children}
    </View>
  );
}

/** The props `TabTrigger asChild` passes to its child, plus ours. */
export type TabButtonProps = {
  icon: IconName;
  /** Translated tab label. */
  label: string;
  testID: string;
  isFocused?: boolean;
  onPress?: (event: GestureResponderEvent) => void;
  onLongPress?: (event: GestureResponderEvent) => void;
  ref?: Ref<ComponentRef<typeof View>>;
};

/**
 * One tab: 52 pt tall. Active is a `surfaceAlt` pill with a `primary` icon and label; inactive
 * is `textSecondary`. The label is the only capped text in the app, at 1.3× (section 3).
 */
export function TabButton({
  icon,
  label,
  testID,
  isFocused = false,
  ref,
  ...props
}: TabButtonProps) {
  const theme = useTheme();
  const color = isFocused ? 'primary' : 'textSecondary';
  return (
    <Pressable
      {...props}
      ref={ref}
      testID={testID}
      accessibilityRole="tab"
      accessibilityLabel={label}
      accessibilityState={{ selected: isFocused }}
      style={({ pressed }) => [
        styles.tab,
        {
          minHeight: TAB_HEIGHT,
          borderRadius: theme.radius.card,
          backgroundColor: isFocused ? theme.color.surfaceAlt : 'transparent',
          paddingVertical: theme.space[1],
          gap: 2,
        },
        pressed && { opacity: PRESSED_OPACITY },
      ]}
    >
      <Icon name={icon} color={color} />
      <Text
        variant={isFocused ? 'tabActive' : 'tab'}
        color={color}
        maxFontSizeMultiplier={theme.layout.tabLabelMaxFontScale}
        numberOfLines={1}
      >
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  bar: {
    position: 'absolute',
    flexDirection: 'row',
    borderWidth: 1,
  },
  tab: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
