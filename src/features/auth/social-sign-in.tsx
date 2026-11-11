import { useTranslation } from 'react-i18next';
import { Platform, View } from 'react-native';

import { Text } from '@/components/text';
import { AppleButton, useAppleSignInAvailable } from '@/features/auth/apple-button';
import { GoogleButton } from '@/features/auth/google-button';
import { isGoogleConfigured } from '@/features/auth/provider-config';
import type { ProviderSlotProps } from '@/features/auth/sign-in-screen';
import { useTheme } from '@/hooks/use-theme';

/** The Apple and Google buttons under the email form on S-02 (FR-AUTH-1). */
export function SocialSignIn({ disabled, onError }: ProviderSlotProps) {
  const { t } = useTranslation();
  const theme = useTheme();
  const apple = useAppleSignInAvailable();
  const google = isGoogleConfigured(Platform.OS);
  if (!apple && !google) return null;
  return (
    <View style={{ gap: theme.space[3] }}>
      <Text variant="label" color="textSecondary" style={{ textAlign: 'center' }}>
        {t('auth.signIn.or')}
      </Text>
      {apple ? <AppleButton disabled={disabled} onError={onError} /> : null}
      {google ? <GoogleButton disabled={disabled} onError={onError} /> : null}
    </View>
  );
}
