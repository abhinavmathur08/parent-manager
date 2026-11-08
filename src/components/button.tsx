import { useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import { focusRing, PRESSED_OPACITY } from '@/components/focus-ring';
import { Icon, type IconName } from '@/components/icon';
import { Text } from '@/components/text';
import type { ColorToken } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'destructive';

export type ButtonProps = {
  /** Translated label, a verb ("Add a meal"). */
  label: string;
  onPress: () => void;
  variant?: ButtonVariant;
  disabled?: boolean;
  /** Shows a spinner. The label stays for screen readers, and presses are ignored. */
  loading?: boolean;
  /** A leading icon. */
  icon?: IconName;
  /** Stretch to the container's width, as in the bottom action area. */
  fullWidth?: boolean;
  accessibilityHint?: string;
  testID: string;
  style?: StyleProp<ViewStyle>;
};

const FILL: Record<ButtonVariant, ColorToken | null> = {
  primary: 'primary',
  secondary: null,
  ghost: null,
  destructive: 'error',
};

const LABEL: Record<ButtonVariant, ColorToken> = {
  primary: 'onPrimary',
  secondary: 'primary',
  ghost: 'primary',
  destructive: 'onPrimary',
};

/** Section 8 Button: height 52 (a minimum, so it grows with large text), `radius.control`. */
export function Button({
  label,
  onPress,
  variant = 'primary',
  disabled = false,
  loading = false,
  icon,
  fullWidth = false,
  accessibilityHint,
  testID,
  style,
}: ButtonProps) {
  const theme = useTheme();
  const [focused, setFocused] = useState(false);
  const inactive = disabled || loading;
  const fill = disabled ? 'surfaceAlt' : FILL[variant];
  const labelColor: ColorToken = disabled ? 'textSecondary' : LABEL[variant];

  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      disabled={inactive}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled: inactive, busy: loading }}
      style={({ pressed }) => [
        styles.base,
        {
          minHeight: 52,
          borderRadius: theme.radius.control,
          paddingHorizontal: theme.space[5],
          paddingVertical: theme.space[3],
          backgroundColor: fill ? theme.color[fill] : 'transparent',
          gap: theme.space[2],
        },
        variant === 'secondary' &&
          !disabled && {
            borderWidth: 1.5,
            borderColor: theme.color.primary,
          },
        fullWidth && styles.fullWidth,
        pressed && { opacity: PRESSED_OPACITY },
        focusRing(theme, focused),
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={theme.color[labelColor]} testID={`${testID}-spinner`} />
      ) : (
        <>
          {icon ? <Icon name={icon} color={labelColor} /> : null}
          <Text variant="bodyStrong" color={labelColor} style={styles.label}>
            {label}
          </Text>
        </>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'flex-start',
  },
  fullWidth: {
    alignSelf: 'stretch',
  },
  label: {
    textAlign: 'center',
    flexShrink: 1,
  },
});
