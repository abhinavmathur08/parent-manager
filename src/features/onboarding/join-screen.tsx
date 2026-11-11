import { router } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { Banner } from '@/components/banner';
import { Button } from '@/components/button';
import { Card } from '@/components/card';
import { Screen } from '@/components/screen';
import { Text } from '@/components/text';
import { TextField } from '@/components/text-field';
import { authErrorKey } from '@/features/auth/auth-errors';
import {
  acceptInvitation,
  isInviteCodeShaped,
  previewInvitation,
  type InvitePreview,
  type InviteStatus,
} from '@/features/household/invitations';
import { useHousehold } from '@/features/household/membership';
import { useOnline } from '@/hooks/use-online';
import { useTheme } from '@/hooks/use-theme';

type Preview = Extract<InvitePreview, { householdName: string }>;

/**
 * S-09: join a household with an invite code (FR-HH-4, FR-HH-6, FR-HH-7). Invite links wait
 * for the product domain (decision D-2), so codes are the only way in for now.
 */
export function JoinScreen() {
  const { t } = useTranslation();
  const theme = useTheme();
  const online = useOnline();
  const { refresh } = useHousehold();
  const [code, setCode] = useState('');
  const [preview, setPreview] = useState<Preview | null>(null);
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  const back = () => {
    if (preview) {
      setPreview(null);
      return;
    }
    if (router.canGoBack()) router.back();
    else router.replace('/welcome');
  };

  function fail(status: Exclude<InviteStatus, 'ok'>) {
    setPreview(null);
    setError(t(`onboarding.join.errors.${status}`));
  }

  async function lookUp() {
    if (!isInviteCodeShaped(code)) {
      setError(t('onboarding.join.errors.format'));
      return;
    }
    setBusy(true);
    setError(undefined);
    try {
      const result = await previewInvitation(code);
      if (result.status === 'ok') setPreview(result);
      else fail(result.status);
    } catch (caught) {
      setError(t(`auth.errors.${authErrorKey(caught)}`));
    } finally {
      setBusy(false);
    }
  }

  async function accept() {
    setBusy(true);
    setError(undefined);
    try {
      const result = await acceptInvitation(code);
      if (result.status === 'ok' || result.status === 'already_member') {
        // The household guard opens the app once the membership is loaded.
        await refresh();
        return;
      }
      fail(result.status);
    } catch (caught) {
      setError(t(`auth.errors.${authErrorKey(caught)}`));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen
      title={t('onboarding.join.title')}
      onBack={back}
      hasTabBar={false}
      testID="join-screen"
      banner={
        online ? null : (
          <Banner
            variant="offline"
            message={t('onboarding.join.offline')}
            testID="offline-banner"
          />
        )
      }
    >
      {preview ? (
        <View style={{ gap: theme.space[4] }}>
          <Card variant="highlight" testID="join-preview">
            <Text variant="cardTitle" testID="join-household-name">
              {preview.householdName}
            </Text>
            {preview.inviterName ? (
              <Text>{t('onboarding.join.invitedBy', { name: preview.inviterName })}</Text>
            ) : null}
            <Text testID="join-role">
              {t('onboarding.join.joinAs', {
                asRole: t(`household.invite.asRole.${preview.role}`),
              })}
            </Text>
          </Card>
          <Button
            label={t('onboarding.join.accept')}
            onPress={accept}
            loading={busy}
            disabled={!online || busy}
            fullWidth
            testID="join-accept"
          />
        </View>
      ) : (
        <View style={{ gap: theme.space[4] }}>
          <Text color="textSecondary">{t('onboarding.join.body')}</Text>
          <TextField
            label={t('onboarding.join.codeLabel')}
            value={code}
            onChangeText={(text) => {
              setCode(text);
              setError(undefined);
            }}
            autoCapitalize="characters"
            autoCorrect={false}
            autoComplete="off"
            maxLength={12}
            returnKeyType="go"
            onSubmitEditing={lookUp}
            disabled={busy}
            testID="join-code"
          />
          <Button
            label={t('onboarding.join.continue')}
            onPress={lookUp}
            loading={busy}
            disabled={!online || busy || code.trim() === ''}
            fullWidth
            testID="join-continue"
          />
        </View>
      )}
      {error ? (
        <Text color="error" accessibilityLiveRegion="polite" testID="join-error">
          {error}
        </Text>
      ) : null}
    </Screen>
  );
}
