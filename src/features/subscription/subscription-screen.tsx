import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Linking, View } from 'react-native';

import { Banner } from '@/components/banner';
import { Button } from '@/components/button';
import { Card } from '@/components/card';
import { ListRow } from '@/components/list-row';
import { Screen } from '@/components/screen';
import { Text } from '@/components/text';
import { useAuth } from '@/features/auth/session';
import { fetchMembers } from '@/features/household/members';
import { useHousehold } from '@/features/household/membership';
import { useTheme } from '@/hooks/use-theme';
import { formatDate } from '@/i18n';
import { track } from '@/lib/analytics';
import { getBilling } from '@/lib/billing';
import { mockAllowedInBuild } from '@/lib/billing/config';
import { mockStoreAdmin } from '@/lib/billing/http-backend';

import { useEntitlement } from './entitlement';
import { usePremiumSheet } from './premium-sheet';
import { ACTIVATING_POLL_MS, ACTIVATING_TIMEOUT_MS, restoreFound } from './purchase';
import { planPeriod, statusSummary } from './status';

type RestoreState = 'idle' | 'busy' | 'activating' | 'found' | 'none' | 'error';

/**
 * S-33 Subscription status (M-02.2, FR-PAY-8): the tier, the renewal or end date, the plan, who
 * bought it, "manage" and "restore purchases". Restore works after a reinstall: it asks the
 * store for this account's subscription, and the server applies it. Manage opens the store's
 * page, or for the mock store the in-app test store (test builds only, and only when the
 * server has the mock turned on).
 */
export function SubscriptionScreen() {
  const { t, i18n } = useTranslation();
  const theme = useTheme();
  const auth = useAuth();
  const me = auth.status === 'signedIn' ? auth.session.user.id : null;
  const household = useHousehold().state;
  const membership = household.status === 'member' ? household.membership : null;
  const isParent = membership?.role === 'parent';
  const { entitlement, isPremium, refresh } = useEntitlement();
  const { openPremiumSheet } = usePremiumSheet();
  const billing = getBilling();
  const [buyerName, setBuyerName] = useState<string | null>(null);
  const [restore, setRestore] = useState<RestoreState>('idle');
  const [mockEnabled, setMockEnabled] = useState(false);

  const purchaser = entitlement?.purchaserUserId ?? null;
  const householdId = membership?.householdId ?? null;

  useEffect(() => {
    if (!purchaser || !householdId || purchaser === me) return;
    let active = true;
    fetchMembers(householdId).then(
      (members) => {
        if (active) setBuyerName(members.find((m) => m.userId === purchaser)?.displayName ?? null);
      },
      () => undefined,
    );
    return () => {
      active = false;
    };
  }, [purchaser, householdId, me]);

  // The in-app test store shows only in test builds, and only if the server enables the mock.
  useEffect(() => {
    if (billing.name !== 'mock' || !mockAllowedInBuild()) return;
    let active = true;
    mockStoreAdmin.enabled().then((enabled) => active && setMockEnabled(enabled));
    return () => {
      active = false;
    };
  }, [billing]);

  // After a restore, wait for the server entitlement, as after a purchase (FR-PAY-1).
  useEffect(() => {
    if (restore !== 'activating') return;
    const started = Date.now();
    const timer = setInterval(() => {
      if (Date.now() - started > ACTIVATING_TIMEOUT_MS) setRestore('error');
      else void refresh();
    }, ACTIVATING_POLL_MS);
    return () => clearInterval(timer);
  }, [restore, refresh]);
  const restoreShown: RestoreState = restore === 'activating' && isPremium ? 'found' : restore;

  async function restorePurchases() {
    setRestore('busy');
    try {
      const info = await billing.restorePurchases();
      const found = restoreFound(info);
      track('purchases_restored', { found });
      setRestore(found ? 'activating' : 'none');
      if (found) void refresh();
    } catch {
      setRestore('error');
    }
  }

  async function manage() {
    if (billing.name === 'mock') {
      router.push('/household/mock-store');
      return;
    }
    try {
      const url = (await billing.getCustomerInfo()).managementURL;
      if (url) await Linking.openURL(url);
    } catch {
      setRestore('error');
    }
  }

  const summary = statusSummary(entitlement);
  const date = (iso: string | null) => (iso ? formatDate(new Date(iso), i18n.language) : '');
  const period = planPeriod(entitlement?.productId ?? null);
  const pending = planPeriod(entitlement?.pendingProductId ?? null);
  const buyer =
    purchaser === null
      ? null
      : purchaser === me
        ? t('premium.status.you')
        : (buyerName ?? t('premium.status.formerMember'));
  const isBuyer = purchaser !== null && purchaser === me;
  const canManage = isBuyer && (billing.name !== 'mock' || mockEnabled);

  return (
    <Screen
      title={t('premium.status.title')}
      onBack={() => (router.canGoBack() ? router.back() : router.replace('/household'))}
      testID="subscription-screen"
    >
      {entitlement?.source === 'mock' ? (
        <Banner
          variant="info"
          message={t('premium.status.sourceMock')}
          testID="subscription-mock"
        />
      ) : null}

      <Card testID="subscription-status">
        <View style={{ gap: theme.space[2] }}>
          <Text variant="cardTitle" testID="subscription-tier">
            {isPremium ? t('premium.status.premium') : t('premium.status.free')}
          </Text>
          <Text testID={`subscription-summary-${summary.kind}`}>
            {t(`premium.status.summary.${summary.kind}`, {
              date: 'date' in summary ? date(summary.date) : '',
            })}
          </Text>
        </View>
      </Card>

      {isPremium ? (
        <View>
          {period ? (
            <ListRow
              title={t('premium.status.plan')}
              variant="value"
              value={t(`premium.status.${period}`)}
              subtitle={
                pending
                  ? t('premium.status.switching', {
                      plan: t(`premium.status.${pending}`),
                      date: date(entitlement?.periodEndsAt ?? null),
                    })
                  : undefined
              }
              divider
              testID="subscription-plan"
            />
          ) : null}
          {buyer ? (
            <ListRow
              title={t('premium.status.boughtBy')}
              variant="value"
              value={buyer}
              testID="subscription-buyer"
            />
          ) : null}
        </View>
      ) : null}

      {restoreShown === 'activating' ? (
        <Text accessibilityLiveRegion="polite" testID="subscription-activating">
          {t('premium.status.activating')}
        </Text>
      ) : null}
      {restoreShown === 'found' || restoreShown === 'none' || restoreShown === 'error' ? (
        <Text
          color={restoreShown === 'error' ? 'error' : 'text'}
          accessibilityLiveRegion="polite"
          testID={`subscription-restore-${restoreShown}`}
        >
          {t(
            restoreShown === 'found'
              ? 'premium.status.restoreFound'
              : restoreShown === 'none'
                ? 'premium.status.restoreNone'
                : 'premium.status.restoreError',
          )}
        </Text>
      ) : null}

      {isParent ? (
        <View style={{ gap: theme.space[2] }}>
          {!isPremium ? (
            <Button
              label={t('premium.status.seePremium')}
              onPress={() => openPremiumSheet('premium_section')}
              fullWidth
              testID="subscription-see-premium"
            />
          ) : canManage ? (
            <Button
              label={t('premium.status.manage')}
              onPress={manage}
              fullWidth
              testID="subscription-manage"
            />
          ) : (
            <Text variant="caption" color="textSecondary" testID="subscription-managed-by">
              {t('premium.status.managedBy')}
            </Text>
          )}
          <Button
            variant="secondary"
            label={t('premium.status.restore')}
            accessibilityHint={t('premium.status.restoreHint')}
            onPress={restorePurchases}
            loading={restore === 'busy'}
            disabled={restore === 'busy' || billing.name === 'none'}
            fullWidth
            testID="subscription-restore"
          />
          {billing.name === 'mock' && mockEnabled && !isBuyer ? (
            // The test clock moves the household's subscription, whoever bought it.
            <Button
              variant="ghost"
              label={t('premium.mockStore.title')}
              onPress={() => router.push('/household/mock-store')}
              fullWidth
              testID="subscription-test-store"
            />
          ) : null}
        </View>
      ) : null}
    </Screen>
  );
}
