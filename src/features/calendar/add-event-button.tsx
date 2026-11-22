import { StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button } from '@/components/button';
import { TAB_BAR_FOOTPRINT } from '@/components/floating-tab-bar';
import { useTheme } from '@/hooks/use-theme';

/**
 * The Calendar tab's one main action, docked just above the tab bar so it's in thumb reach
 * (design system principle 1, NFR2-A11Y-1).
 */
export function AddEventButton({ label, onPress }: { label: string; onPress: () => void }) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <View
      pointerEvents="box-none"
      style={[
        styles.dock,
        {
          bottom: insets.bottom + TAB_BAR_FOOTPRINT + theme.space[2],
          paddingHorizontal: theme.layout.screenMargin,
        },
      ]}
    >
      <Button icon="add" label={label} onPress={onPress} fullWidth testID="calendar-add" />
    </View>
  );
}

const styles = StyleSheet.create({
  dock: { position: 'absolute', start: 0, end: 0 },
});
