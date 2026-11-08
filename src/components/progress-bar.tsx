import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { Text } from '@/components/text';
import { useTheme } from '@/hooks/use-theme';

export type ProgressBarProps = {
  /** Done so far. */
  value: number;
  /** The total, which is also the number of segments in the `segmented` variant. */
  total: number;
  /** Translated text shown with the bar ("6 of 7 dinners planned"). The bar never stands alone. */
  label: string;
  variant?: 'segmented' | 'linear';
  testID?: string;
  style?: StyleProp<ViewStyle>;
};

const HEIGHT = 8;

/** The share complete, from 0 to 1. */
export function progressFraction(value: number, total: number): number {
  if (total <= 0) return 0;
  return Math.min(1, Math.max(0, value / total));
}

/** Section 8 ProgressBar: `segmented` for dinners planned, `linear` otherwise. */
export function ProgressBar({
  value,
  total,
  label,
  variant = 'linear',
  testID,
  style,
}: ProgressBarProps) {
  const theme = useTheme();
  const fraction = progressFraction(value, total);
  const filled = Math.round(fraction * total);
  const track = { height: HEIGHT, borderRadius: theme.radius.pill };
  return (
    <View
      testID={testID}
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={label}
      accessibilityValue={{ min: 0, max: total, now: Math.min(Math.max(value, 0), total) }}
      style={[{ gap: theme.space[2] }, style]}
    >
      <Text variant="label" color="textSecondary">
        {label}
      </Text>
      {variant === 'segmented' ? (
        <View style={[styles.segments, { gap: theme.space[1] }]}>
          {Array.from({ length: Math.max(total, 0) }, (_, index) => (
            <View
              key={index}
              testID={testID ? `${testID}-segment-${index}` : undefined}
              style={[
                styles.segment,
                track,
                {
                  backgroundColor: index < filled ? theme.color.primary : theme.color.surfaceAlt,
                },
              ]}
            />
          ))}
        </View>
      ) : (
        <View style={[track, styles.linear, { backgroundColor: theme.color.surfaceAlt }]}>
          <View
            testID={testID ? `${testID}-fill` : undefined}
            style={[track, { width: `${fraction * 100}%`, backgroundColor: theme.color.primary }]}
          />
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  segments: {
    flexDirection: 'row',
  },
  segment: {
    flex: 1,
  },
  linear: {
    overflow: 'hidden',
  },
});
