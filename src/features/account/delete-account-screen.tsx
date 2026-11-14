import * as Linking from 'expo-linking';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Platform, View } from 'react-native';

import { Banner } from '@/components/banner';
import { Button } from '@/components/button';
import { Screen } from '@/components/screen';
import { Text } from '@/components/text';
import {
  deleteAccount,
  fetchDeletionPreview,
  type DeletionPreview,
} from '@/features/account/deletion';
import { ReauthSheet } from '@/features/account/reauth-sheet';
import { storeSubscriptionsUrl } from '@/features/account/store-subscriptions';
import { signOut } from '@/features/auth/sign-out';
import { useOnline } from '@/hooks/use-online';
import { useTheme } from '@/hooks/use-theme';

/**
 * Delete account (FR-PRIV-3), from S-31. Says what will be deleted, warns that store
 * subscriptions carry on, then has the user sign in again before deleting. Afterwards the
 * device is signed out, which clears its local data.
 */
export function DeleteAccountScreen() {
  const { t } = useTranslation();
  const theme = useTheme();
  const online = useOnline();
  const [preview, setPreview] = useState<DeletionPreview | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!online) return;
    let current = true;
    fetchDeletionPreview()
      .then((loaded) => current && setPreview(loaded))
      .catch(() => current && setLoadFailed(true));
    return () => {
      current = false;
    };
  }, [online, attempt]);

  async function remove() {
    await deleteAccount();
    setConfirming(false);
    await signOut().catch(() => undefined);
  }

  const household = preview?.householdName ?? '';
  const blocked = preview?.outcome === 'last_parent';

  return (
    <Screen
      title={t('account.delete.title')}
      onBack={() => (router.canGoBack() ? router.back() : router.replace('/household/account'))}
      testID="delete-account-screen"
      banner={
        online ? null : (
          <Banner variant="offline" message={t('account.delete.offline')} testID="offline-banner" />
        )
      }
    >
      {loadFailed ? (
        <View style={{ gap: theme.space[2] }}>
          <Text testID="delete-account-error">{t('auth.errors.network')}</Text>
          <Button
            variant="secondary"
            label={t('household.members.retry')}
            onPress={() => {
              setLoadFailed(false);
              setAttempt((n) => n + 1);
            }}
            testID="delete-account-retry"
          />
        </View>
      ) : null}
      {preview ? (
        <>
          <Text testID="delete-account-outcome">
            {t(`account.delete.outcome.${preview.outcome}`, { household })}
          </Text>
          {blocked ? (
            <View style={{ gap: theme.space[2] }}>
              <Button
                variant="secondary"
                label={t('account.delete.openMembers')}
                onPress={() => router.push('/household/members')}
                fullWidth
                testID="delete-account-members"
              />
            </View>
          ) : (
            <>
              <Text color="textSecondary" testID="delete-account-backups">
                {t('account.delete.backups')}
              </Text>
              <View style={{ gap: theme.space[2] }}>
                <Text color="textSecondary" testID="delete-account-subscription">
                  {t(
                    Platform.OS === 'android'
                      ? 'account.delete.subscriptionAndroid'
                      : 'account.delete.subscriptionIos',
                  )}
                </Text>
                <Button
                  variant="ghost"
                  label={t('account.delete.manageSubscriptions')}
                  onPress={() => void Linking.openURL(storeSubscriptionsUrl())}
                  testID="delete-account-store"
                />
              </View>
              <Button
                variant="destructive"
                label={t('account.delete.action')}
                onPress={() => setConfirming(true)}
                disabled={!online}
                fullWidth
                testID="delete-account-start"
              />
            </>
          )}
        </>
      ) : null}
      <ReauthSheet
        visible={confirming}
        onClose={() => setConfirming(false)}
        actionLabel={t('account.delete.action')}
        onConfirmed={remove}
        testID="delete-account-reauth"
      />
    </Screen>
  );
}
