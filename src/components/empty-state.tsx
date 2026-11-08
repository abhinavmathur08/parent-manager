import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { Button } from '@/components/button';
import { Icon, type IconName } from '@/components/icon';
import { Text } from '@/components/text';
import { useTheme } from '@/hooks/use-theme';

export type EmptyStateProps = {
  icon: IconName;
  /** One translated sentence. */
  message: string;
  /** Translated label for the one primary action. */
  actionLabel?: string;
  onAction?: () => void;
  testID: string;
  style?: StyleProp<ViewStyle>;
};

/** Section 8 EmptyState: an `icon.lg` icon, one sentence and one primary action. */
export function EmptyState({
  icon,
  message,
  actionLabel,
  onAction,
  testID,
  style,
}: EmptyStateProps) {
  const theme = useTheme();
  return (
    <View
      testID={testID}
      style={[styles.container, { gap: theme.space[4], padding: theme.space[6] }, style]}
    >
      <Icon name={icon} size="lg" color="textSecondary" />
      <Text color="textSecondary" style={styles.message}>
        {message}
      </Text>
      {actionLabel && onAction ? (
        <Button label={actionLabel} onPress={onAction} testID={`${testID}-action`} />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  message: {
    textAlign: 'center',
  },
});
