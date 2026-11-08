import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { Text } from '@/components/text';
import { useTheme } from '@/hooks/use-theme';

export type SectionHeaderProps = {
  /** Translated title. `group` titles are three words at most, since they're uppercase. */
  title: string;
  /** `list` is a Fraunces store-section label; `group` is an overline for settings groups. */
  variant?: 'list' | 'group';
  /** Optional trailing text, such as a count. */
  trailing?: string;
  testID?: string;
  style?: StyleProp<ViewStyle>;
};

/** Section 8 SectionHeader, read by screen readers as a heading. */
export function SectionHeader({
  title,
  variant = 'list',
  trailing,
  testID,
  style,
}: SectionHeaderProps) {
  const theme = useTheme();
  return (
    <View
      style={[
        styles.row,
        {
          paddingHorizontal: theme.space[4],
          paddingTop: theme.space[4],
          paddingBottom: theme.space[2],
          gap: theme.space[2],
        },
        style,
      ]}
    >
      <Text
        testID={testID}
        accessibilityRole="header"
        variant={variant === 'list' ? 'sectionLabel' : 'overline'}
        color={variant === 'list' ? 'text' : 'textSecondary'}
        style={styles.title}
      >
        {title}
      </Text>
      {trailing ? (
        <Text variant="label" color="textSecondary" tabular>
          {trailing}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'flex-end',
  },
  title: {
    flex: 1,
  },
});
