import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { Icon } from '@/components/icon';
import { Text } from '@/components/text';
import { useTheme } from '@/hooks/use-theme';

export type TagProps = {
  /** Translated text. A `warning` tag always names the allergen. */
  label: string;
  variant?: 'neutral' | 'warning';
  testID?: string;
  style?: StyleProp<ViewStyle>;
};

/** Section 8 Tag: static, outlined, `type.caption`. Warning tags add an icon to the text. */
export function Tag({ label, variant = 'neutral', testID, style }: TagProps) {
  const theme = useTheme();
  const warning = variant === 'warning';
  return (
    <View
      testID={testID}
      style={[
        styles.tag,
        {
          borderRadius: theme.radius.pill,
          borderColor: warning ? theme.color.warning : theme.color.border,
          paddingHorizontal: theme.space[2],
          paddingVertical: 2,
          gap: theme.space[1],
        },
        style,
      ]}
    >
      {warning ? <Icon name="warning" size="sm" color="warning" /> : null}
      <Text variant="caption" color={warning ? 'warning' : 'textSecondary'}>
        {label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  tag: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    borderWidth: 1,
  },
});
