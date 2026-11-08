import { useState } from 'react';
import { Pressable, type StyleProp, type ViewStyle } from 'react-native';

import { focusRing, PRESSED_OPACITY } from '@/components/focus-ring';
import { Icon, type IconName } from '@/components/icon';
import type { ColorToken } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

export type IconButtonProps = {
  icon: IconName;
  /** Required: the translated name of the action, since the icon has no text. */
  accessibilityLabel: string;
  onPress: () => void;
  /** `tinted` sits on a `surfaceAlt` circle. */
  variant?: 'plain' | 'tinted';
  /** Defaults to `primary`, since the icon leads an action. */
  color?: ColorToken;
  disabled?: boolean;
  accessibilityHint?: string;
  testID: string;
  style?: StyleProp<ViewStyle>;
};

/** Section 8 IconButton: a 48 × 48 target around a 24 pt icon. */
export function IconButton({
  icon,
  accessibilityLabel,
  onPress,
  variant = 'plain',
  color = 'primary',
  disabled = false,
  accessibilityHint,
  testID,
  style,
}: IconButtonProps) {
  const theme = useTheme();
  const [focused, setFocused] = useState(false);
  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      disabled={disabled}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled }}
      style={({ pressed }) => [
        {
          width: theme.layout.minTarget,
          height: theme.layout.minTarget,
          borderRadius: theme.radius.pill,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: variant === 'tinted' ? theme.color.surfaceAlt : 'transparent',
        },
        pressed && { opacity: PRESSED_OPACITY, backgroundColor: theme.color.surfaceAlt },
        focusRing(theme, focused),
        style,
      ]}
    >
      <Icon name={icon} color={disabled ? 'textSecondary' : color} />
    </Pressable>
  );
}
