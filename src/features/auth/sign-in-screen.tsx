import { router } from 'expo-router';
import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { Banner } from '@/components/banner';
import { Button } from '@/components/button';
import { Screen } from '@/components/screen';
import { Text } from '@/components/text';
import { TextField } from '@/components/text-field';
import { authErrorKey } from '@/features/auth/auth-errors';
import { secondsUntilResend } from '@/features/auth/code-attempts';
import { isValidEmail, normalizeEmail } from '@/features/auth/email';
import { requestEmailCode } from '@/features/auth/email-sign-in';
import { readPendingSignIn, savePendingSignIn } from '@/features/auth/pending-sign-in';
import { PolicyAgreement } from '@/features/auth/policy-agreement';
import { useOnline } from '@/hooks/use-online';
import { useTheme } from '@/hooks/use-theme';
import { DEFAULT_LOCALE, SUPPORTED_LOCALES, type AppLocale } from '@/i18n';

export type ProviderSlotProps = {
  /** Offline or busy. */
  disabled: boolean;
  /** Shows a failed sign-in. A cancelled one should call nothing (spec 3.1 edge cases). */
  onError: (error: unknown) => void;
};

export type SignInScreenProps = {
  /** Other sign-in methods (Apple, Google), shown under the email form. */
  providers?: (props: ProviderSlotProps) => ReactNode;
};

/** S-02: sign in or sign up with an email code (FR-AUTH-1, FR-AUTH-2, FR-PRIV-6). */
export function SignInScreen({ providers }: SignInScreenProps) {
  const { t, i18n } = useTranslation();
  const theme = useTheme();
  const online = useOnline();
  const [email, setEmail] = useState(() => readPendingSignIn()?.email ?? '');
  const [error, setError] = useState<string>();
  const [sending, setSending] = useState(false);
  const [providerError, setProviderError] = useState<string>();

  const locale = (SUPPORTED_LOCALES as readonly string[]).includes(i18n.language)
    ? (i18n.language as AppLocale)
    : DEFAULT_LOCALE;

  async function submit() {
    if (!isValidEmail(email)) {
      setError(t('auth.signIn.emailInvalid'));
      return;
    }
    const address = normalizeEmail(email);
    const pending = readPendingSignIn();
    // A code went to this address moments ago and can't be resent yet: enter that one.
    if (pending?.email === address && secondsUntilResend(pending.sentAt, Date.now()) > 0) {
      router.push('/verify');
      return;
    }
    setError(undefined);
    setSending(true);
    try {
      await requestEmailCode(address, locale);
      savePendingSignIn({ email: address, sentAt: Date.now() });
      router.push('/verify');
    } catch (caught) {
      setError(t(`auth.errors.${authErrorKey(caught)}`));
    } finally {
      setSending(false);
    }
  }

  return (
    <Screen
      title={t('auth.signIn.title')}
      hasTabBar={false}
      testID="sign-in-screen"
      banner={
        online ? null : (
          <Banner variant="offline" message={t('auth.offline')} testID="offline-banner" />
        )
      }
    >
      <Text color="textSecondary">{t('auth.signIn.subtitle')}</Text>
      <View style={{ gap: theme.space[3] }}>
        <TextField
          label={t('auth.signIn.email')}
          hint={error ? undefined : t('auth.signIn.emailHint')}
          error={error}
          value={email}
          onChangeText={(text) => {
            setEmail(text);
            setError(undefined);
          }}
          onSubmitEditing={submit}
          autoCapitalize="none"
          autoCorrect={false}
          autoComplete="email"
          keyboardType="email-address"
          textContentType="emailAddress"
          returnKeyType="send"
          disabled={sending}
          testID="sign-in-email"
        />
        <Button
          label={t('auth.signIn.continue')}
          onPress={submit}
          loading={sending}
          disabled={!online || sending}
          fullWidth
          testID="sign-in-continue"
        />
      </View>
      {providers?.({
        disabled: !online || sending,
        onError: (caught) => setProviderError(t(`auth.errors.${authErrorKey(caught)}`)),
      })}
      {providerError ? (
        <Text color="error" accessibilityLiveRegion="polite" testID="sign-in-provider-error">
          {providerError}
        </Text>
      ) : null}
      <PolicyAgreement />
    </Screen>
  );
}
