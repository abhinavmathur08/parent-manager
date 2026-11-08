import { Pressable, StyleSheet, type StyleProp, type ViewStyle } from 'react-native';

import { PRESSED_OPACITY } from '@/components/focus-ring';
import { Icon } from '@/components/icon';
import { Text } from '@/components/text';
import { useTheme } from '@/hooks/use-theme';

export type ChipProps = {
  /** Translated label. */
  label: string;
  /** `filter` toggles a selection (several may be selected); `action` adds something in one tap. */
  variant?: 'filter' | 'action';
  /** Filter chips only. */
  selected?: boolean;
  onPress: () => void;
  disabled?: boolean;
  testID: string;
  style?: StyleProp<ViewStyle>;
};

const MIN_HEIGHT = 44;

/**
 * Section 8 Chip. Visually 44 pt tall, with hit slop to a 48 pt target (NFR-A11Y-4). Selected
 * filter chips get a `primary` fill and a check, so selection isn't color alone. Never use a
 * chip for the screen's primary action.
 */
export function Chip({
  label,
  variant = 'filter',
  selected = false,
  onPress,
  disabled = false,
  testID,
  style,
}: ChipProps) {
  const theme = useTheme();
  const isSelected = variant === 'filter' && selected;
  const slop = (theme.layout.minTarget - MIN_HEIGHT) / 2;
  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      disabled={disabled}
      hitSlop={{ top: slop, bottom: slop }}
      accessibilityRole={variant === 'filter' ? 'togglebutton' : 'button'}
      accessibilityLabel={label}
      accessibilityState={variant === 'filter' ? { checked: isSelected, disabled } : { disabled }}
      style={({ pressed }) => [
        styles.chip,
        {
          minHeight: MIN_HEIGHT,
          borderRadius: theme.radius.pill,
          paddingHorizontal: theme.space[4],
          paddingVertical: theme.space[2],
          gap: theme.space[1],
          backgroundColor: isSelected ? theme.color.primary : theme.color.surfaceAlt,
          opacity: disabled ? 0.6 : pressed ? PRESSED_OPACITY : 1,
        },
        style,
      ]}
    >
      {isSelected ? <Icon name="check" size="sm" color="onPrimary" /> : null}
      {variant === 'action' ? <Icon name="add" size="sm" color="primary" /> : null}
      <Text variant="label" color={isSelected ? 'onPrimary' : 'text'}>
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
  },
});
