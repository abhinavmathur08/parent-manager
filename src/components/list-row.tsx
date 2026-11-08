import type { ReactNode } from 'react';
import { Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { Icon } from '@/components/icon';
import { Text } from '@/components/text';
import { useTheme } from '@/hooks/use-theme';

export type ListRowProps = {
  /** Translated title. */
  title: string;
  /** Translated secondary text under the title. */
  subtitle?: string;
  /** `navigation` adds a chevron; `value` shows trailing text. */
  variant?: 'plain' | 'navigation' | 'value';
  /** Trailing text for the `value` variant, for example the current setting. */
  value?: string;
  /** Content before the title, such as an icon or avatar. */
  leading?: ReactNode;
  onPress?: () => void;
  disabled?: boolean;
  /** Draws a hairline under the row, inset from the leading edge. */
  divider?: boolean;
  accessibilityHint?: string;
  testID: string;
  style?: StyleProp<ViewStyle>;
};

/** Section 8 ListRow: at least 56 pt tall, and the whole row is the target (NFR-A11Y-4). */
export function ListRow({
  title,
  subtitle,
  variant = 'plain',
  value,
  leading,
  onPress,
  disabled = false,
  divider = false,
  accessibilityHint,
  testID,
  style,
}: ListRowProps) {
  const theme = useTheme();
  const label = [title, subtitle, variant === 'value' ? value : undefined]
    .filter(Boolean)
    .join(', ');
  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      disabled={disabled || !onPress}
      accessibilityRole={onPress ? 'button' : undefined}
      accessibilityLabel={label}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled }}
      style={({ pressed }) => [
        styles.row,
        {
          minHeight: theme.layout.minRowHeight,
          paddingHorizontal: theme.space[4],
          paddingVertical: theme.space[2],
          gap: theme.space[3],
          backgroundColor: pressed ? theme.color.surfaceAlt : theme.color.surface,
          opacity: disabled ? 0.6 : 1,
        },
        style,
      ]}
    >
      {leading}
      <View style={styles.text}>
        <Text>{title}</Text>
        {subtitle ? (
          <Text variant="label" color="textSecondary">
            {subtitle}
          </Text>
        ) : null}
      </View>
      {variant === 'value' && value ? (
        <Text variant="label" color="textSecondary" style={styles.value} tabular>
          {value}
        </Text>
      ) : null}
      {variant === 'navigation' ? <Icon name="forward" size="sm" color="textSecondary" /> : null}
      {divider ? (
        <View
          testID={`${testID}-divider`}
          style={[
            styles.divider,
            { start: theme.space[4], end: 0, backgroundColor: theme.color.border },
          ]}
        />
      ) : null}
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
  value: {
    flexShrink: 1,
  },
  divider: {
    position: 'absolute',
    bottom: 0,
    height: StyleSheet.hairlineWidth,
  },
});
