import { router } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { Banner } from '@/components/banner';
import { Button } from '@/components/button';
import { Screen } from '@/components/screen';
import { Text } from '@/components/text';
import { ReauthSheet } from '@/features/account/reauth-sheet';
import { authErrorKey } from '@/features/auth/auth-errors';
import { useAuth } from '@/features/auth/session';
import {
  cancelHouseholdDeletion,
  confirmHouseholdDeletion,
  fetchDeletionRequest,
  requestHouseholdDeletion,
  type DeletionRequest,
} from '@/features/household/deletion-request';
import { fetchMembers, type Member } from '@/features/household/members';
import { useHousehold } from '@/features/household/membership';
import { useOnline } from '@/hooks/use-online';
import { useTheme } from '@/hooks/use-theme';
import { formatDate } from '@/i18n';

type Loaded = { request: DeletionRequest | null; members: Member[] };

/**
 * Delete household (FR-PRIV-7), from household settings, for parents. The only parent
 * deletes at once. With two parents, one asks and the other confirms within 7 days; either
 * can call it off. Asking and confirming both need a fresh sign-in.
 */
export function DeleteHouseholdScreen() {
  const { t, i18n } = useTranslation();
  const theme = useTheme();
  const online = useOnline();
  const auth = useAuth();
  const myId = auth.status === 'signedIn' ? auth.session.user.id : null;
  const { state, refresh } = useHousehold();
  const membership = state.status === 'member' ? state.membership : null;
  const householdId = membership?.householdId ?? null;
  const isParent = membership?.role === 'parent';
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  const fetchAll = useCallback(async (): Promise<Loaded> => {
    if (!householdId) return { request: null, members: [] };
    const [request, members] = await Promise.all([
      fetchDeletionRequest(householdId),
      fetchMembers(householdId),
    ]);
    return { request, members };
  }, [householdId]);

  const load = async () => {
    try {
      setLoaded(await fetchAll());
      setLoadFailed(false);
    } catch {
      setLoadFailed(true);
    }
  };

  useEffect(() => {
    if (!online || !isParent) return;
    let current = true;
    fetchAll()
      .then((next) => current && setLoaded(next))
      .catch(() => current && setLoadFailed(true));
    return () => {
      current = false;
    };
  }, [online, isParent, fetchAll]);

  const request = loaded?.request ?? null;
  const parents = loaded?.members.filter((m) => m.role === 'parent') ?? [];
  const otherParent = parents.find((m) => m.userId !== myId);
  const nameOf = (userId: string) =>
    loaded?.members.find((m) => m.userId === userId)?.displayName ?? t('household.members.unnamed');
  const expires = request ? formatDate(new Date(request.expiresAt), i18n.language) : '';
  const mine = request?.requestedBy === myId;

  async function proceed() {
    if (!householdId) return;
    if (request && !mine) {
      await confirmHouseholdDeletion(householdId);
      setConfirming(false);
      await refresh();
      return;
    }
    const result = await requestHouseholdDeletion(householdId);
    setConfirming(false);
    if (result === 'deleted') await refresh();
    else await load();
  }

  async function cancel() {
    if (!householdId) return;
    setBusy(true);
    setError(undefined);
    try {
      await cancelHouseholdDeletion(householdId);
      await load();
    } catch (caught) {
      setError(t(`auth.errors.${authErrorKey(caught)}`));
    } finally {
      setBusy(false);
    }
  }

  let body: string | null = null;
  let action: string | null = null;
  if (loaded) {
    if (!request) {
      body = otherParent
        ? t('household.delete.bodyAsk', { name: nameOf(otherParent.userId) })
        : t('household.delete.body');
      action = otherParent ? t('household.delete.ask') : t('household.delete.action');
    } else if (mine) {
      body = t('household.delete.waiting', {
        name: otherParent ? nameOf(otherParent.userId) : t('household.members.unnamed'),
        date: expires,
      });
    } else {
      body = t('household.delete.asked', { name: nameOf(request.requestedBy), date: expires });
      action = t('household.delete.action');
    }
  }

  return (
    <Screen
      title={t('household.delete.title')}
      onBack={() => (router.canGoBack() ? router.back() : router.replace('/household/settings'))}
      testID="delete-household-screen"
      banner={
        online ? null : (
          <Banner
            variant="offline"
            message={t('household.delete.offline')}
            testID="offline-banner"
          />
        )
      }
    >
      {isParent ? null : (
        <Text color="textSecondary" testID="delete-household-parents-only">
          {t('household.delete.parentsOnly')}
        </Text>
      )}
      {loadFailed ? <Text testID="delete-household-error">{t('auth.errors.network')}</Text> : null}
      {body ? <Text testID="delete-household-body">{body}</Text> : null}
      {loaded ? (
        <Text color="textSecondary" testID="delete-household-backups">
          {t('household.delete.keepAccounts')}
        </Text>
      ) : null}
      {error ? (
        <Text color="error" accessibilityLiveRegion="polite" testID="delete-household-cancel-error">
          {error}
        </Text>
      ) : null}
      <View style={{ gap: theme.space[2] }}>
        {action ? (
          <Button
            variant="destructive"
            label={action}
            onPress={() => setConfirming(true)}
            disabled={!online || busy}
            fullWidth
            testID="delete-household-start"
          />
        ) : null}
        {request ? (
          <Button
            variant="secondary"
            label={mine ? t('household.delete.withdraw') : t('household.delete.keep')}
            onPress={cancel}
            loading={busy}
            disabled={!online || busy}
            fullWidth
            testID="delete-household-cancel"
          />
        ) : null}
      </View>
      <ReauthSheet
        visible={confirming}
        onClose={() => setConfirming(false)}
        actionLabel={action ?? t('household.delete.action')}
        onConfirmed={proceed}
        testID="delete-household-reauth"
      />
    </Screen>
  );
}
