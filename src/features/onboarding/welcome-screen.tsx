import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { Banner } from '@/components/banner';
import { Button } from '@/components/button';
import { Card } from '@/components/card';
import { ListRow } from '@/components/list-row';
import { Screen } from '@/components/screen';
import { Skeleton } from '@/components/skeleton';
import { Text } from '@/components/text';
import { TextField } from '@/components/text-field';
import { authErrorKey } from '@/features/auth/auth-errors';
import { useAuth } from '@/features/auth/session';
import { signOut } from '@/features/auth/sign-out';
import { useOnboardingDraft, type OnboardingStep } from '@/features/onboarding/draft';
import { fetchDisplayName, saveDisplayName } from '@/features/onboarding/profile';
import { useOnline } from '@/hooks/use-online';
import { useTheme } from '@/hooks/use-theme';

const MAX_NAME = 100;

/** S-05: create a household or join one (FR-ONB-1), asking for a name if there isn't one (FR-AUTH-4). */
export function WelcomeScreen() {
  const { t } = useTranslation();
  const theme = useTheme();
  const online = useOnline();
  const auth = useAuth();
  const userId = auth.status === 'signedIn' ? auth.session.user.id : null;
  const [, setDraft] = useOnboardingDraft();
  // undefined while loading; null when the profile has no name yet.
  const [savedName, setSavedName] = useState<string | null | undefined>(undefined);
  const [name, setName] = useState('');
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!userId) return;
    let active = true;
    fetchDisplayName(userId)
      .then((value) => active && setSavedName(value))
      .catch(() => active && setSavedName(null));
    return () => {
      active = false;
    };
  }, [userId]);

  async function choose(route: '/create-household' | '/join', step: OnboardingStep) {
    if (!userId || busy) return;
    const trimmed = name.trim();
    if (!savedName && trimmed === '') {
      setError(t('onboarding.welcome.nameRequired'));
      return;
    }
    setBusy(true);
    setError(undefined);
    try {
      if (!savedName) {
        await saveDisplayName(userId, trimmed);
        setSavedName(trimmed);
      }
      setDraft((draft) => ({ ...draft, step }));
      router.push(route);
    } catch (caught) {
      setError(t(`auth.errors.${authErrorKey(caught)}`));
    } finally {
      setBusy(false);
    }
  }

  const disabled = !online || busy || savedName === undefined;

  return (
    <Screen
      title={
        savedName
          ? t('onboarding.welcome.titleNamed', { name: savedName })
          : t('onboarding.welcome.title')
      }
      hasTabBar={false}
      testID="welcome-screen"
      banner={
        online ? null : (
          <Banner variant="offline" message={t('auth.offline')} testID="offline-banner" />
        )
      }
    >
      <Text color="textSecondary">{t('onboarding.welcome.subtitle')}</Text>
      {savedName === undefined ? <Skeleton variant="row" testID="welcome-loading" /> : null}
      {savedName === null ? (
        <TextField
          label={t('onboarding.welcome.name')}
          hint={error ? undefined : t('onboarding.welcome.nameHint')}
          error={error}
          value={name}
          onChangeText={(text) => {
            setName(text);
            setError(undefined);
          }}
          maxLength={MAX_NAME}
          autoComplete="given-name"
          textContentType="givenName"
          autoCapitalize="words"
          returnKeyType="done"
          testID="welcome-name"
        />
      ) : null}
      {savedName && error ? (
        <Text color="error" accessibilityLiveRegion="polite" testID="welcome-error">
          {error}
        </Text>
      ) : null}
      <Card style={{ padding: theme.space[0] }} testID="welcome-options">
        <ListRow
          variant="navigation"
          title={t('onboarding.welcome.create')}
          subtitle={t('onboarding.welcome.createDescription')}
          onPress={() => choose('/create-household', 'create-household')}
          disabled={disabled}
          divider
          testID="welcome-create"
        />
        <ListRow
          variant="navigation"
          title={t('onboarding.welcome.join')}
          subtitle={t('onboarding.welcome.joinDescription')}
          onPress={() => choose('/join', 'welcome')}
          disabled={disabled}
          testID="welcome-join"
        />
      </Card>
      <View style={{ marginTop: theme.space[4] }}>
        <Button
          variant="ghost"
          label={t('onboarding.welcome.signOut')}
          onPress={() => {
            signOut().catch(() => undefined);
          }}
          fullWidth
          testID="welcome-sign-out"
        />
      </View>
    </Screen>
  );
}
