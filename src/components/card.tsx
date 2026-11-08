import type { ReactNode } from 'react';
import { Pressable, View, type StyleProp, type ViewStyle } from 'react-native';

import { PRESSED_OPACITY } from '@/components/focus-ring';
import { useTheme } from '@/hooks/use-theme';

export type CardProps = {
  children: ReactNode;
  /** `highlight` marks the one card that matters now, such as tonight's dinner. */
  variant?: 'default' | 'highlight';
  /** Makes the whole card a button. Then `accessibilityLabel` is required. */
  onPress?: () => void;
  accessibilityLabel?: string;
  accessibilityHint?: string;
  testID: string;
  style?: StyleProp<ViewStyle>;
};

/** Section 8 Card: `radius.card`, `space.4` padding, a 1 pt border and no shadow. Don't nest cards. */
export function Card({
  children,
  variant = 'default',
  onPress,
  accessibilityLabel,
  accessibilityHint,
  testID,
  style,
}: CardProps) {
  const theme = useTheme();
  const highlight = variant === 'highlight';
  const base: ViewStyle = {
    borderRadius: theme.radius.card,
    padding: theme.space[4],
    gap: theme.space[2],
    borderWidth: highlight ? 1.5 : 1,
    borderColor: highlight ? theme.color.primary : theme.color.border,
    backgroundColor: theme.color.surface,
  };
  if (!onPress) {
    return (
      <View testID={testID} style={[base, style]}>
        {children}
      </View>
    );
  }
  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityHint={accessibilityHint}
      style={({ pressed }) => [base, pressed && { opacity: PRESSED_OPACITY }, style]}
    >
      {children}
    </Pressable>
  );
}
