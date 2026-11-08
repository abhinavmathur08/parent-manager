import { useTranslation } from 'react-i18next';
import { AccessibilityInfo, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { IconButton } from '@/components/icon-button';
import { Text } from '@/components/text';
import { useTheme } from '@/hooks/use-theme';

export type StepperProps = {
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
  /** Translated name of what is counted, read before the value ("Servings"). */
  accessibilityLabel: string;
  /** Formats the value for display and announcement, through the locale helpers. */
  formatValue?: (value: number) => string;
  testID: string;
  style?: StyleProp<ViewStyle>;
};

/** Clamps to [min, max] and snaps away floating-point drift from fractional steps. */
export function stepValue(value: number, delta: number, min: number, max: number): number {
  const next = Math.round((value + delta) * 1000) / 1000;
  return Math.min(max, Math.max(min, next));
}

/**
 * Section 8 Stepper: 48 × 48 buttons. Screen readers get one adjustable element (swipe up
 * or down to change it), and every change is announced with the new value.
 */
export function Stepper({
  value,
  onChange,
  min = 0,
  max = Number.MAX_SAFE_INTEGER,
  step = 1,
  accessibilityLabel,
  formatValue = String,
  testID,
  style,
}: StepperProps) {
  const theme = useTheme();
  const { t } = useTranslation();
  const display = formatValue(value);

  const change = (delta: number) => {
    const next = stepValue(value, delta, min, max);
    if (next === value) return;
    onChange(next);
    AccessibilityInfo.announceForAccessibility(
      t('components.stepper.announce', { label: accessibilityLabel, value: formatValue(next) }),
    );
  };

  return (
    <View
      testID={testID}
      accessible
      accessibilityRole="adjustable"
      accessibilityLabel={accessibilityLabel}
      accessibilityValue={{ text: display }}
      accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
      onAccessibilityAction={(event) =>
        change(event.nativeEvent.actionName === 'increment' ? step : -step)
      }
      style={[
        styles.row,
        {
          borderRadius: theme.radius.control,
          backgroundColor: theme.color.surfaceAlt,
          gap: theme.space[1],
        },
        style,
      ]}
    >
      <IconButton
        icon="remove"
        accessibilityLabel={t('components.stepper.decrease', { label: accessibilityLabel })}
        onPress={() => change(-step)}
        disabled={value <= min}
        testID={`${testID}-decrease`}
      />
      <Text
        variant="bodyStrong"
        tabular
        style={[styles.value, { minWidth: theme.space[8] }]}
        testID={`${testID}-value`}
      >
        {display}
      </Text>
      <IconButton
        icon="add"
        accessibilityLabel={t('components.stepper.increase', { label: accessibilityLabel })}
        onPress={() => change(step)}
        disabled={value >= max}
        testID={`${testID}-increase`}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
  },
  value: {
    textAlign: 'center',
  },
});
