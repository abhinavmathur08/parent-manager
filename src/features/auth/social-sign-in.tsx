import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { Text } from '@/components/text';
import { AppleButton, useAppleSignInAvailable } from '@/features/auth/apple-button';
import type { ProviderSlotProps } from '@/features/auth/sign-in-screen';
import { useTheme } from '@/hooks/use-theme';

/** The Apple and Google buttons under the email form on S-02 (FR-AUTH-1). */
export function SocialSignIn({ disabled, onError }: ProviderSlotProps) {
  const { t } = useTranslation();
  const theme = useTheme();
  const apple = useAppleSignInAvailable();
  if (!apple) return null;
  return (
    <View style={{ gap: theme.space[3] }}>
      <Text variant="label" color="textSecondary" style={{ textAlign: 'center' }}>
        {t('auth.signIn.or')}
      </Text>
      {apple ? <AppleButton disabled={disabled} onError={onError} /> : null}
    </View>
  );
}
