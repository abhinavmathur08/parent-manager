import { useState } from 'react';
import { Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { focusRing, PRESSED_OPACITY } from '@/components/focus-ring';
import { Text } from '@/components/text';
import { useTheme } from '@/hooks/use-theme';

export type RadioOptionProps = {
  /** Translated title. */
  label: string;
  /** Optional translated detail under the title. */
  description?: string;
  selected: boolean;
  onPress: () => void;
  disabled?: boolean;
  testID: string;
  style?: StyleProp<ViewStyle>;
};

const DOT_OUTER = 24;
const DOT_INNER = 12;

/**
 * Section 8 RadioOption, card style, for one choice from a short list (region, role, plan).
 * Minimum height 64. Selected shows a `primary` border and a filled dot, so it isn't color alone.
 */
export function RadioOption({
  label,
  description,
  selected,
  onPress,
  disabled = false,
  testID,
  style,
}: RadioOptionProps) {
  const theme = useTheme();
  const [focused, setFocused] = useState(false);
  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      disabled={disabled}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      accessibilityRole="radio"
      accessibilityLabel={label}
      accessibilityHint={description}
      accessibilityState={{ checked: selected, disabled }}
      style={({ pressed }) => [
        styles.card,
        {
          minHeight: 64,
          gap: theme.space[3],
          padding: theme.space[4],
          borderRadius: theme.radius.card,
          borderWidth: selected ? 2 : 1,
          borderColor: selected ? theme.color.primary : theme.color.border,
          backgroundColor: pressed ? theme.color.surfaceAlt : theme.color.surface,
          opacity: disabled ? 0.6 : pressed ? PRESSED_OPACITY : 1,
        },
        focusRing(theme, focused),
        style,
      ]}
    >
      <View
        testID={`${testID}-dot`}
        style={[
          styles.dot,
          {
            borderRadius: theme.radius.pill,
            borderColor: selected ? theme.color.primary : theme.color.textSecondary,
          },
        ]}
      >
        {selected ? (
          <View
            style={[
              styles.dotInner,
              { borderRadius: theme.radius.pill, backgroundColor: theme.color.primary },
            ]}
          />
        ) : null}
      </View>
      <View style={styles.text}>
        <Text variant="bodyStrong">{label}</Text>
        {description ? (
          <Text variant="label" color="textSecondary">
            {description}
          </Text>
        ) : null}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  dot: {
    width: DOT_OUTER,
    height: DOT_OUTER,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dotInner: {
    width: DOT_INNER,
    height: DOT_INNER,
  },
  text: {
    flex: 1,
  },
});
