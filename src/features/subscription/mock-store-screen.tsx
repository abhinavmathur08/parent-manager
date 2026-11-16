import { router } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { Banner } from '@/components/banner';
import { Button } from '@/components/button';
import { Card } from '@/components/card';
import { SectionHeader } from '@/components/section-header';
import { Screen } from '@/components/screen';
import { Switch } from '@/components/switch';
import { Text } from '@/components/text';
import { useHousehold } from '@/features/household/membership';
import { useTheme } from '@/hooks/use-theme';
import { formatDate } from '@/i18n';
import { BillingError, getBilling, setMockWebhookDelay } from '@/lib/billing';
import { mockAllowedInBuild } from '@/lib/billing/config';
import {
  httpMockStoreBackend,
  mockStoreAdmin,
  type MockClockTarget,
  type MockOperation,
} from '@/lib/billing/http-backend';
import { MockBillingProvider, type MockStoreSubscription } from '@/lib/billing/mock-provider';

import { useEntitlement } from './entitlement';
import { planPeriod } from './status';

const CLOCK: { to: MockClockTarget; label: string }[] = [
  { to: 'trial_end', label: 'trialEnd' },
  { to: 'renewal', label: 'renewal' },
  { to: 'billing_issue', label: 'billingIssueAction' },
  { to: 'grace_end', label: 'graceEnd' },
  { to: 'expiry', label: 'expiry' },
];

/**
 * The mock store's settings and test clock (M-02.2, D-10 interim). It plays the part of the
 * App Store's or Play Store's subscription settings, and lets testers move a subscription
 * through every lifecycle state. Only test builds that use the mock store reach it, and only
 * while the server has the mock turned on; nothing here charges anyone.
 */
export function MockStoreScreen() {
  const { t, i18n } = useTranslation();
  const theme = useTheme();
  const household = useHousehold().state;
  const householdId = household.status === 'member' ? household.membership.householdId : null;
  const { refresh } = useEntitlement();
  const billing = getBilling();
  const mock = billing instanceof MockBillingProvider ? billing : null;
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [mine, setMine] = useState<MockStoreSubscription | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<'notApplicable' | 'error' | null>(null);
  const [delay, setDelay] = useState(mock?.delayNextWebhook ?? false);

  const load = useCallback(async () => {
    try {
      setMine(await httpMockStoreBackend.subscription());
    } catch {
      setMine(null);
    }
  }, []);

  useEffect(() => {
    if (!mock || !mockAllowedInBuild()) return;
    let active = true;
    mockStoreAdmin.enabled().then((on) => {
      if (!active) return;
      setEnabled(on);
      if (on) {
        httpMockStoreBackend.subscription().then(
          (sub) => active && setMine(sub),
          () => undefined,
        );
      }
    });
    return () => {
      active = false;
    };
  }, [mock]);

  async function run(action: () => Promise<unknown>) {
    setBusy(true);
    setMessage(null);
    try {
      await action();
      await load();
      await refresh();
    } catch (error) {
      setMessage(
        error instanceof BillingError && error.reason?.endsWith('_not_applicable')
          ? 'notApplicable'
          : 'error',
      );
    } finally {
      setBusy(false);
    }
  }

  const back = () => (router.canGoBack() ? router.back() : router.replace('/household'));
  if (!mock || !mockAllowedInBuild() || enabled === false) {
    // Never reachable in a production build or against a project without the mock.
    return (
      <Screen title={t('premium.mockStore.title')} onBack={back} testID="mock-store-screen">
        <Text>{t('premium.sheet.unavailable')}</Text>
      </Screen>
    );
  }

  const live = mine?.isActive ? mine : null;
  const date = (iso: string | null) => (iso ? formatDate(new Date(iso), i18n.language) : '');
  const other = planPeriod(live?.productId ?? null) === 'annual' ? 'monthly' : 'annual';

  const manage = (operation: MockOperation, label: string, testID: string, productId?: string) => (
    <Button
      key={testID}
      variant="secondary"
      label={t(`premium.mockStore.${label}`)}
      onPress={() => run(() => mockStoreAdmin.manage(operation, productId))}
      disabled={busy}
      fullWidth
      testID={testID}
    />
  );

  return (
    <Screen title={t('premium.mockStore.title')} onBack={back} testID="mock-store-screen">
      <Banner variant="info" message={t('premium.mockStore.intro')} testID="mock-store-intro" />

      <Card testID="mock-store-subscription">
        {mine ? (
          <View style={{ gap: theme.space[1] }}>
            <Text variant="bodyStrong">{t('premium.mockStore.subscription')}</Text>
            <Text>
              {t('premium.mockStore.product', {
                plan: t(`premium.status.${planPeriod(mine.productId) ?? 'monthly'}`),
              })}
            </Text>
            {!mine.isActive ? (
              <Text testID="mock-store-ended">{t('premium.mockStore.ended')}</Text>
            ) : (
              <>
                {mine.periodType === 'TRIAL' ? <Text>{t('premium.mockStore.trial')}</Text> : null}
                <Text>{t('premium.mockStore.expires', { date: date(mine.expiresAt) })}</Text>
                <Text testID="mock-store-will-renew">
                  {t('premium.mockStore.willRenew', {
                    value: t(mine.willRenew ? 'premium.mockStore.on' : 'premium.mockStore.off'),
                  })}
                </Text>
                {mine.gracePeriodEndsAt ? (
                  <Text color="warning">
                    {t('premium.mockStore.billingIssue', { date: date(mine.gracePeriodEndsAt) })}
                  </Text>
                ) : null}
              </>
            )}
          </View>
        ) : (
          <Text testID="mock-store-none">{t('premium.mockStore.none')}</Text>
        )}
      </Card>

      <Switch
        label={t('premium.mockStore.delayWebhook')}
        description={t('premium.mockStore.delayWebhookHint')}
        value={delay}
        onValueChange={(value) => {
          setMockWebhookDelay(value);
          setDelay(value);
        }}
        testID="mock-store-delay-webhook"
      />

      {live ? (
        <View style={{ gap: theme.space[2] }}>
          <SectionHeader title={t('premium.mockStore.settings')} variant="group" />
          {live.willRenew
            ? manage('cancel', 'cancel', 'mock-store-cancel')
            : manage('uncancel', 'uncancel', 'mock-store-uncancel')}
          {manage(
            'change_product',
            other === 'annual' ? 'switchToAnnual' : 'switchToMonthly',
            'mock-store-switch',
            other === 'annual' ? 'pm_premium_annual' : 'pm_premium_monthly',
          )}
          {live.gracePeriodEndsAt ? manage('fix_payment', 'fixPayment', 'mock-store-fix') : null}
          {manage('refund', 'refund', 'mock-store-refund')}
        </View>
      ) : null}

      {householdId ? (
        <View style={{ gap: theme.space[2] }}>
          <SectionHeader title={t('premium.mockStore.clock')} variant="group" />
          <Text variant="caption" color="textSecondary">
            {t('premium.mockStore.clockHint')}
          </Text>
          {CLOCK.map(({ to, label }) => (
            <Button
              key={to}
              variant="secondary"
              label={t(`premium.mockStore.${label}`)}
              onPress={() => run(() => mockStoreAdmin.advance(householdId, to))}
              disabled={busy}
              fullWidth
              testID={`mock-clock-${to.replace('_', '-')}`}
            />
          ))}
        </View>
      ) : null}

      {message ? (
        <Text color="error" accessibilityLiveRegion="polite" testID="mock-store-message">
          {t(`premium.mockStore.${message}`)}
        </Text>
      ) : null}
    </Screen>
  );
}
