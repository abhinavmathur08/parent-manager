import { Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { PRESSED_OPACITY } from '@/components/focus-ring';
import { Icon } from '@/components/icon';
import { useTheme } from '@/hooks/use-theme';

const VISUAL = 26;

/** The round checkbox mark on its own, for use inside rows that own the press. */
export function CheckboxMark({ checked, testID }: { checked: boolean; testID?: string }) {
  const theme = useTheme();
  return (
    <View
      testID={testID}
      style={[
        styles.mark,
        {
          borderRadius: theme.radius.pill,
          borderColor: checked ? theme.color.primary : theme.color.textSecondary,
          backgroundColor: checked ? theme.color.primary : 'transparent',
        },
      ]}
    >
      {checked ? <Icon name="check" size="sm" color="onPrimary" /> : null}
    </View>
  );
}

export type CheckboxProps = {
  checked: boolean;
  onChange: (checked: boolean) => void;
  /** Translated label for screen readers. */
  accessibilityLabel: string;
  disabled?: boolean;
  testID: string;
  style?: StyleProp<ViewStyle>;
};

/**
 * Section 8 Checkbox: round, a 26 pt visual inside a 48 pt target. Unchecked is a 2 pt
 * `textSecondary` ring; checked is a `primary` fill with a check, so it isn't color alone.
 */
export function Checkbox({
  checked,
  onChange,
  accessibilityLabel,
  disabled = false,
  testID,
  style,
}: CheckboxProps) {
  const theme = useTheme();
  return (
    <Pressable
      testID={testID}
      onPress={() => onChange(!checked)}
      disabled={disabled}
      accessibilityRole="checkbox"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ checked, disabled }}
      style={({ pressed }) => [
        styles.target,
        { width: theme.layout.minTarget, height: theme.layout.minTarget },
        (pressed || disabled) && { opacity: disabled ? 0.6 : PRESSED_OPACITY },
        style,
      ]}
    >
      <CheckboxMark checked={checked} testID={`${testID}-mark`} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  target: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  mark: {
    width: VISUAL,
    height: VISUAL,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
