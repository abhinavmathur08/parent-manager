import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { Button } from '@/components/button';
import { Card } from '@/components/card';
import { SectionHeader } from '@/components/section-header';
import { Screen } from '@/components/screen';
import { Text } from '@/components/text';
import { TextField } from '@/components/text-field';
import { signInMethod } from '@/features/account/sign-in-method';
import { authErrorKey } from '@/features/auth/auth-errors';
import { useAuth } from '@/features/auth/session';
import { signOut } from '@/features/auth/sign-out';
import { LockSettingsSection } from '@/features/biometric/lock-settings';
import { fetchDisplayName, saveDisplayName } from '@/features/onboarding/profile';
import { useOnline } from '@/hooks/use-online';
import { useTheme } from '@/hooks/use-theme';

const MAX_DISPLAY_NAME = 100;

/**
 * S-31 Account: profile, biometric lock, sign out and delete account (FR-AUTH-4, FR-AUTH-6,
 * FR-PRIV-1). Delete account is two taps from the Household tab (FR-PRIV-3).
 */
export function AccountScreen() {
  const { t } = useTranslation();
  const theme = useTheme();
  const online = useOnline();
  const auth = useAuth();
  const user = auth.status === 'signedIn' ? auth.session.user : null;
  const userId = user?.id ?? null;
  const [name, setName] = useState('');
  const [saved, setSaved] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ text: string; error: boolean }>();

  useEffect(() => {
    if (!userId) return;
    let current = true;
    fetchDisplayName(userId)
      .then((loaded) => {
        if (!current) return;
        setName(loaded ?? '');
        setSaved(loaded ?? '');
      })
      .catch(() => current && setMessage({ text: t('auth.errors.network'), error: true }));
    return () => {
      current = false;
    };
  }, [userId, t]);

  async function save() {
    if (!userId) return;
    if (name.trim() === '') {
      setMessage({ text: t('onboarding.welcome.nameRequired'), error: true });
      return;
    }
    setSaving(true);
    setMessage(undefined);
    try {
      await saveDisplayName(userId, name);
      setSaved(name.trim());
      setName(name.trim());
      setMessage({ text: t('account.profile.saved'), error: false });
    } catch (caught) {
      setMessage({ text: t(`auth.errors.${authErrorKey(caught)}`), error: true });
    } finally {
      setSaving(false);
    }
  }

  const changed = saved !== null && name.trim() !== saved;

  return (
    <Screen
      title={t('account.title')}
      onBack={() => (router.canGoBack() ? router.back() : router.replace('/household'))}
      testID="account-screen"
    >
      {user ? (
        <Card testID="account-identity">
          <Text variant="bodyStrong" testID="account-email">
            {user.email ?? t('account.profile.noEmail')}
          </Text>
          <Text variant="label" color="textSecondary" testID="account-method">
            {t(`account.profile.method.${signInMethod(user)}`)}
          </Text>
        </Card>
      ) : null}
      <View style={{ gap: theme.space[2] }}>
        <TextField
          label={t('account.profile.displayName')}
          hint={t('onboarding.welcome.nameHint')}
          value={name}
          onChangeText={(next) => {
            setName(next);
            setMessage(undefined);
          }}
          maxLength={MAX_DISPLAY_NAME}
          disabled={saved === null || saving}
          testID="account-display-name"
        />
        {changed ? (
          <Button
            variant="secondary"
            label={t('account.profile.save')}
            onPress={save}
            loading={saving}
            disabled={!online || saving}
            testID="account-save-name"
          />
        ) : null}
        {message ? (
          <Text
            color={message.error ? 'error' : 'textSecondary'}
            accessibilityLiveRegion="polite"
            testID="account-message"
          >
            {message.text}
          </Text>
        ) : null}
      </View>
      <View style={{ gap: theme.space[2] }}>
        <SectionHeader title={t('account.security')} variant="group" />
        <LockSettingsSection />
      </View>
      <Button
        variant="secondary"
        label={t('auth.signOut.action')}
        onPress={() => {
          signOut().catch(() => undefined);
        }}
        fullWidth
        testID="sign-out"
      />
      <Button
        variant="ghost"
        label={t('account.delete.title')}
        onPress={() => router.push('/household/delete-account')}
        fullWidth
        testID="open-delete-account"
      />
    </Screen>
  );
}
