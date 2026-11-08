import { useState } from 'react';
import { Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { focusRing, PRESSED_OPACITY } from '@/components/focus-ring';
import { Text } from '@/components/text';
import { useTheme } from '@/hooks/use-theme';

export type SwitchProps = {
  /** The row's translated label. A switch is always paired with one. */
  label: string;
  /** Optional translated secondary text under the label. */
  description?: string;
  value: boolean;
  /** Changes apply immediately, with no save step. */
  onValueChange: (value: boolean) => void;
  disabled?: boolean;
  testID: string;
  style?: StyleProp<ViewStyle>;
};

const TRACK_WIDTH = 52;
const TRACK_HEIGHT = 32;
const THUMB = 24;

/**
 * Section 8 Switch, drawn from tokens: on is a `primary` track, off is `surfaceAlt` with a
 * `textSecondary` outline. The whole row, label included, is the target.
 */
export function Switch({
  label,
  description,
  value,
  onValueChange,
  disabled = false,
  testID,
  style,
}: SwitchProps) {
  const theme = useTheme();
  const [focused, setFocused] = useState(false);
  return (
    <Pressable
      testID={testID}
      onPress={() => onValueChange(!value)}
      disabled={disabled}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      accessibilityRole="switch"
      accessibilityLabel={label}
      accessibilityHint={description}
      accessibilityState={{ checked: value, disabled }}
      style={({ pressed }) => [
        styles.row,
        {
          minHeight: theme.layout.minRowHeight,
          gap: theme.space[4],
          paddingVertical: theme.space[2],
          opacity: disabled ? 0.6 : pressed ? PRESSED_OPACITY : 1,
        },
        focusRing(theme, focused),
        style,
      ]}
    >
      <View style={styles.text}>
        <Text>{label}</Text>
        {description ? (
          <Text variant="caption" color="textSecondary">
            {description}
          </Text>
        ) : null}
      </View>
      <View
        testID={`${testID}-track`}
        style={[
          styles.track,
          {
            borderRadius: theme.radius.pill,
            backgroundColor: value ? theme.color.primary : theme.color.surfaceAlt,
            borderColor: value ? theme.color.primary : theme.color.textSecondary,
            alignItems: value ? 'flex-end' : 'flex-start',
          },
        ]}
      >
        <View
          style={[
            styles.thumb,
            {
              borderRadius: theme.radius.pill,
              backgroundColor: value ? theme.color.onPrimary : theme.color.textSecondary,
            },
          ]}
        />
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  text: {
    flex: 1,
  },
  track: {
    width: TRACK_WIDTH,
    height: TRACK_HEIGHT,
    borderWidth: 2,
    justifyContent: 'center',
    paddingHorizontal: 2,
  },
  thumb: {
    width: THUMB,
    height: THUMB,
  },
});
