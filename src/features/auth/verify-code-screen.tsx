import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Trans, useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { Banner } from '@/components/banner';
import { Button } from '@/components/button';
import { CODE_LENGTH, CodeInput } from '@/components/code-input';
import { Screen } from '@/components/screen';
import { Text } from '@/components/text';
import { authErrorKey } from '@/features/auth/auth-errors';
import {
  CODE_LIFETIME_MINUTES,
  isCodeLocked,
  secondsUntilResend,
} from '@/features/auth/code-attempts';
import { requestEmailCode, verifyEmailCode } from '@/features/auth/email-sign-in';
import {
  clearPendingSignIn,
  readPendingSignIn,
  savePendingSignIn,
  type PendingSignIn,
} from '@/features/auth/pending-sign-in';
import { useOnline } from '@/hooks/use-online';
import { useTheme } from '@/hooks/use-theme';
import { DEFAULT_LOCALE, formatNumber, SUPPORTED_LOCALES, type AppLocale } from '@/i18n';

function useNow(intervalMs: number) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs]);
  return now;
}

function changeEmail() {
  if (router.canGoBack()) router.back();
  else router.replace('/sign-in');
}

/** S-03: enter the 6-digit code, resend it, or use a different email (FR-AUTH-2). */
export function VerifyCodeScreen() {
  const { t, i18n } = useTranslation();
  const theme = useTheme();
  const online = useOnline();
  const now = useNow(1000);
  const [pending, setPending] = useState<PendingSignIn | null>(readPendingSignIn);
  const [code, setCode] = useState('');
  const [wrongAttempts, setWrongAttempts] = useState(0);
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const [checking, setChecking] = useState(false);
  const [resending, setResending] = useState(false);

  const locale = (SUPPORTED_LOCALES as readonly string[]).includes(i18n.language)
    ? (i18n.language as AppLocale)
    : DEFAULT_LOCALE;
  const locked = isCodeLocked(wrongAttempts);
  const wait = pending ? secondsUntilResend(pending.sentAt, now) : 0;

  async function verify(value: string) {
    if (!pending || locked || checking) return;
    setChecking(true);
    setError(undefined);
    setNotice(undefined);
    try {
      await verifyEmailCode(pending.email, value);
      // Signed in: the auth listener moves the app on.
      clearPendingSignIn();
    } catch (caught) {
      const key = authErrorKey(caught);
      if (key === 'invalidCode') {
        const attempts = wrongAttempts + 1;
        setWrongAttempts(attempts);
        setError(t(isCodeLocked(attempts) ? 'auth.verify.locked' : 'auth.errors.invalidCode'));
      } else {
        setError(t(`auth.errors.${key}`));
      }
      setCode('');
    } finally {
      setChecking(false);
    }
  }

  async function resend() {
    if (!pending || wait > 0) return;
    setResending(true);
    setError(undefined);
    setNotice(undefined);
    try {
      await requestEmailCode(pending.email, locale);
      const next = { email: pending.email, sentAt: Date.now() };
      savePendingSignIn(next);
      setPending(next);
      // The new code replaces the old one on the server, so the count starts again.
      setWrongAttempts(0);
      setCode('');
      setNotice(t('auth.verify.resent'));
    } catch (caught) {
      setError(t(`auth.errors.${authErrorKey(caught)}`));
    } finally {
      setResending(false);
    }
  }

  if (!pending) {
    return (
      <Screen
        title={t('auth.verify.title')}
        onBack={changeEmail}
        hasTabBar={false}
        testID="verify-screen"
      >
        <Text>{t('auth.verify.missingEmail')}</Text>
        <Button
          label={t('auth.verify.changeEmail')}
          onPress={changeEmail}
          fullWidth
          testID="verify-change-email"
        />
      </Screen>
    );
  }

  return (
    <Screen
      title={t('auth.verify.title')}
      onBack={changeEmail}
      hasTabBar={false}
      testID="verify-screen"
      banner={
        online ? null : (
          <Banner variant="offline" message={t('auth.offline')} testID="offline-banner" />
        )
      }
    >
      <Text color="textSecondary" testID="verify-sent-to">
        <Trans
          i18nKey="auth.verify.sentTo"
          values={{ email: pending.email, minutes: formatNumber(CODE_LIFETIME_MINUTES, locale) }}
          components={{ email: <Text variant="bodyStrong" /> }}
        />
      </Text>
      <CodeInput
        value={code}
        onChange={(value) => {
          setCode(value);
          if (!locked) setError(undefined);
        }}
        onComplete={(value) => {
          if (value.length === CODE_LENGTH && online) verify(value);
        }}
        accessibilityLabel={t('auth.verify.code')}
        error={error}
        autoFocus
        testID="verify-code"
      />
      {notice ? (
        <Text
          variant="label"
          color="textSecondary"
          accessibilityLiveRegion="polite"
          testID="verify-notice"
        >
          {notice}
        </Text>
      ) : null}
      {checking ? (
        <Text variant="label" color="textSecondary" accessibilityLiveRegion="polite">
          {t('auth.verify.checking')}
        </Text>
      ) : null}
      <View style={{ gap: theme.space[2] }}>
        <Button
          variant={locked ? 'primary' : 'secondary'}
          label={t('auth.verify.resend')}
          onPress={resend}
          loading={resending}
          disabled={!online || wait > 0 || resending}
          fullWidth
          testID="verify-resend"
        />
        {wait > 0 ? (
          <Text
            variant="caption"
            color="textSecondary"
            style={{ textAlign: 'center' }}
            testID="verify-resend-wait"
          >
            {t('auth.verify.resendIn', { count: wait, seconds: formatNumber(wait, locale) })}
          </Text>
        ) : null}
        <Button
          variant="ghost"
          label={t('auth.verify.changeEmail')}
          onPress={changeEmail}
          fullWidth
          testID="verify-change-email"
        />
      </View>
    </Screen>
  );
}
