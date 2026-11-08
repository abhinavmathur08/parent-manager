import { useTranslation } from 'react-i18next';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { Icon, type IconName } from '@/components/icon';
import { IconButton } from '@/components/icon-button';
import { Text } from '@/components/text';
import type { ColorToken } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

export type BannerVariant = 'offline' | 'partnerActivity' | 'info';

export type BannerProps = {
  variant: BannerVariant;
  /** Translated message. */
  message: string;
  /** Info banners only: shows a dismiss button. Offline banners can't be dismissed. */
  onDismiss?: () => void;
  testID: string;
  style?: StyleProp<ViewStyle>;
};

const ICON: Record<BannerVariant, { name: IconName; color: ColorToken }> = {
  offline: { name: 'offline', color: 'warning' },
  partnerActivity: { name: 'people', color: 'primary' },
  info: { name: 'info', color: 'primary' },
};

/** Section 8 Banner, pinned under the TopBar in `type.label`. Status is in text, not color alone. */
export function Banner({ variant, message, onDismiss, testID, style }: BannerProps) {
  const theme = useTheme();
  const { t } = useTranslation();
  const icon = ICON[variant];
  const dismissible = variant === 'info' && !!onDismiss;
  return (
    <View
      testID={testID}
      accessibilityRole={variant === 'offline' ? 'alert' : 'summary'}
      accessibilityLiveRegion="polite"
      style={[
        styles.banner,
        {
          minHeight: theme.layout.minTarget,
          backgroundColor: theme.color.surfaceAlt,
          borderBottomColor: theme.color.border,
          paddingStart: theme.space[4],
          paddingEnd: dismissible ? 0 : theme.space[4],
          paddingVertical: theme.space[2],
          gap: theme.space[2],
        },
        style,
      ]}
    >
      <Icon name={icon.name} size="sm" color={icon.color} />
      <Text variant="label" style={styles.message}>
        {message}
      </Text>
      {dismissible ? (
        <IconButton
          icon="close"
          color="textSecondary"
          accessibilityLabel={t('components.banner.dismiss')}
          onPress={onDismiss}
          testID={`${testID}-dismiss`}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  message: {
    flex: 1,
  },
});
