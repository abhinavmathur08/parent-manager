import type { ReactNode } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { TopBar, type TopBarProps } from '@/components/top-bar';
import { useTheme } from '@/hooks/use-theme';

export type ScreenProps = Omit<TopBarProps, 'testID'> & {
  children: ReactNode;
  /** Pinned at the top while the content and TopBar scroll, such as the offline Banner. */
  banner?: ReactNode;
  /** Tab screens leave room for the floating tab bar so nothing sits under it. */
  hasTabBar?: boolean;
  testID: string;
};

/**
 * A screen with a TopBar and scrolling content: `screenMargin` sides, content capped at
 * `layout.maxContentWidth`, and bottom padding of `layout.tabBarClearance` on tab screens.
 */
export function Screen({ children, banner, hasTabBar = true, testID, ...topBar }: ScreenProps) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const paddingBottom = hasTabBar
    ? theme.layout.tabBarClearance + insets.bottom
    : insets.bottom + theme.space[6];
  return (
    <View
      testID={testID}
      style={[styles.root, { backgroundColor: theme.color.background, paddingTop: insets.top }]}
    >
      {banner}
      <ScrollView
        testID={`${testID}-scroll`}
        contentContainerStyle={[
          styles.content,
          {
            paddingHorizontal: theme.layout.screenMargin,
            paddingTop: theme.space[2],
            paddingBottom,
            gap: theme.layout.sectionGap,
            maxWidth: theme.layout.maxContentWidth,
          },
        ]}
        keyboardShouldPersistTaps="handled"
      >
        {/* The TopBar scrolls with the content, so a title at the largest text size can't crowd it out. */}
        <View style={{ marginHorizontal: -theme.layout.screenMargin }}>
          <TopBar {...topBar} testID={`${testID}-title`} />
        </View>
        {children}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  content: {
    width: '100%',
    alignSelf: 'center',
  },
});
