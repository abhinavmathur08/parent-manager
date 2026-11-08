import {
  Pressable,
  StyleSheet,
  useWindowDimensions,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import { PRESSED_OPACITY } from '@/components/focus-ring';
import { Text } from '@/components/text';
import { useTheme } from '@/hooks/use-theme';

export type SegmentedOption<T extends string> = {
  value: T;
  /** Translated label. */
  label: string;
};

export type SegmentedControlProps<T extends string> = {
  /** Two or three options. */
  options: readonly SegmentedOption<T>[];
  value: T;
  onChange: (value: T) => void;
  /** Translated name of the group, for screen readers. */
  accessibilityLabel: string;
  testID: string;
  style?: StyleProp<ViewStyle>;
};

/**
 * Section 8 SegmentedControl, for switching views (never for settings). Segments are 48 pt
 * tall (NFR-A11Y-4, which overrides the design system's 44) and wrap their labels.
 */
export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  accessibilityLabel,
  testID,
  style,
}: SegmentedControlProps<T>) {
  const theme = useTheme();
  const { fontScale } = useWindowDimensions();
  // At very large text sizes, segments stack so labels never break mid-word (NFR-A11Y-2).
  const stacked = fontScale * theme.fontScale >= STACK_AT_FONT_SCALE;
  return (
    <View
      testID={testID}
      accessibilityRole="tablist"
      accessibilityLabel={accessibilityLabel}
      style={[
        stacked ? styles.stacked : styles.group,
        {
          borderRadius: theme.radius.control,
          backgroundColor: theme.color.surfaceAlt,
          padding: theme.space[1],
          gap: theme.space[1],
        },
        style,
      ]}
    >
      {options.map((option, index) => {
        const selected = option.value === value;
        return (
          <Pressable
            key={option.value}
            testID={`${testID}-${option.value}`}
            onPress={() => onChange(option.value)}
            accessibilityRole="tab"
            accessibilityLabel={option.label}
            accessibilityState={{ selected }}
            accessibilityValue={{ min: 1, max: options.length, now: index + 1 }}
            // The group's padding sits inside the 48 pt target.
            hitSlop={{ top: theme.space[1], bottom: theme.space[1] }}
            style={({ pressed }) => [
              styles.segment,
              !stacked && styles.fill,
              {
                minHeight: theme.layout.minTarget - theme.space[2],
                borderRadius: theme.radius.sm,
                paddingHorizontal: theme.space[3],
                paddingVertical: theme.space[1],
                backgroundColor: selected ? theme.color.surface : 'transparent',
                borderWidth: selected ? 1 : 0,
                borderColor: theme.color.border,
              },
              pressed && { opacity: PRESSED_OPACITY },
            ]}
          >
            <Text
              variant={selected ? 'bodyStrong' : 'label'}
              color={selected ? 'text' : 'textSecondary'}
              style={styles.label}
            >
              {option.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/** The combined text scale at which segments stack vertically. */
export const STACK_AT_FONT_SCALE = 1.8;

const styles = StyleSheet.create({
  group: {
    flexDirection: 'row',
  },
  stacked: {
    flexDirection: 'column',
  },
  segment: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  fill: {
    flex: 1,
  },
  label: {
    textAlign: 'center',
  },
});
