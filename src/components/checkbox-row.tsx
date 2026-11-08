import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { Avatar } from '@/components/avatar';
import { CheckboxMark } from '@/components/checkbox';
import { Icon } from '@/components/icon';
import { Text } from '@/components/text';
import { useTheme } from '@/hooks/use-theme';

export type CheckboxRowProps = {
  /** Translated item name. */
  label: string;
  /** Formatted detail, such as the quantity or "for 2 meals". */
  detail?: string;
  checked: boolean;
  onToggle: (checked: boolean) => void;
  /** The member who checked it, shown as an avatar and read out ("checked by Alex"). */
  checkedBy?: { name: string; memberIndex: number };
  /** The change hasn't reached the server yet: shows a small clock. */
  pendingSync?: boolean;
  disabled?: boolean;
  testID: string;
  style?: StyleProp<ViewStyle>;
};

/**
 * Section 8 CheckboxRow, for the grocery list and checklists (FR-LIST-5). A tap anywhere on
 * the row toggles it. Checked rows fade to `textSecondary` with a strikethrough and a filled
 * check, so checked state is never color alone (NFR-A11Y-6). The list screen moves checked
 * rows to "in the cart" after `motion.base` (FR-LIST-4).
 */
export function CheckboxRow({
  label,
  detail,
  checked,
  onToggle,
  checkedBy,
  pendingSync = false,
  disabled = false,
  testID,
  style,
}: CheckboxRowProps) {
  const theme = useTheme();
  const { t } = useTranslation();
  const hints = [
    detail,
    checked && checkedBy ? t('components.checkboxRow.checkedBy', { name: checkedBy.name }) : null,
    pendingSync ? t('components.checkboxRow.pendingSync') : null,
  ].filter(Boolean);
  return (
    <Pressable
      testID={testID}
      onPress={() => onToggle(!checked)}
      disabled={disabled}
      accessibilityRole="checkbox"
      accessibilityLabel={[label, ...hints].join(', ')}
      accessibilityState={{ checked, disabled }}
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
      <CheckboxMark checked={checked} testID={`${testID}-mark`} />
      <View style={styles.text}>
        <Text
          color={checked ? 'textSecondary' : 'text'}
          style={checked ? styles.struck : null}
          testID={`${testID}-label`}
        >
          {label}
        </Text>
        {detail ? (
          <Text variant="label" color="textSecondary" tabular>
            {detail}
          </Text>
        ) : null}
      </View>
      {pendingSync ? (
        <Icon name="clock" size="sm" color="textSecondary" testID={`${testID}-pending`} />
      ) : null}
      {checked && checkedBy ? (
        <Avatar
          name={checkedBy.name}
          memberIndex={checkedBy.memberIndex}
          size="sm"
          testID={`${testID}-avatar`}
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
  struck: {
    textDecorationLine: 'line-through',
  },
});
