import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { Banner } from '@/components/banner';
import { BottomSheet } from '@/components/bottom-sheet';
import { Button } from '@/components/button';
import { Card } from '@/components/card';
import { RadioOption } from '@/components/radio-option';
import { Text } from '@/components/text';
import { useHousehold } from '@/features/household/membership';
import { useTheme } from '@/hooks/use-theme';
import { formatNumber } from '@/i18n';
import { track } from '@/lib/analytics';
import { getBilling, TRIAL_DAYS, type Offering, type Package } from '@/lib/billing';

import { useEntitlement } from './entitlement';
import {
  ACTIVATING_POLL_MS,
  ACTIVATING_TIMEOUT_MS,
  productPeriod,
  purchaseErrorCode,
  purchaseErrorKey,
  restoreFound,
  trialEligible,
  type PurchaseErrorKey,
} from './purchase';
import {
  AI_IMPORTS_PER_MONTH,
  benefitsFor,
  type PremiumBenefit,
  type PremiumTrigger,
} from './triggers';

type Phase = 'choose' | 'busy' | 'activating' | 'active' | 'stalled';

export type PremiumSheetProps = {
  visible: boolean;
  trigger: PremiumTrigger;
  onClose: () => void;
};

/**
 * S-32 Premium sheet (FR-PAY-4): opened at a moment of need, never as a full-screen paywall.
 * It names the triggering benefit first, lists the others, shows the store's prices and trial
 * with the subscription terms, and offers start trial, restore and not now. Only parents can
 * buy; others see "ask a parent". While the mock store is in use, it says plainly that this
 * is a test purchase and no card is charged.
 */
export function PremiumSheet({ visible, trigger, onClose }: PremiumSheetProps) {
  const { t } = useTranslation();
  const theme = useTheme();
  const household = useHousehold().state;
  const role = household.status === 'member' ? household.membership.role : null;
  const isParent = role === 'parent';
  const { isPremium, refresh } = useEntitlement();
  const billing = getBilling();

  const [offering, setOffering] = useState<Offering | null | undefined>(undefined);
  const [eligible, setEligible] = useState(true);
  const [selected, setSelected] = useState<Package['packageType']>('ANNUAL');
  const [phase, setPhase] = useState<Phase>('choose');
  const [error, setError] = useState<PurchaseErrorKey | 'restoreNone' | null>(null);
  const startedAt = useRef(0);

  // Load the store's offerings and trial eligibility each time the sheet opens.
  useEffect(() => {
    if (!visible) return;
    let active = true;
    if (role) track('paywall_viewed', { trigger, role });
    billing.getOfferings().then(
      (offerings) => active && setOffering(offerings.current),
      () => active && setOffering(null),
    );
    if (isParent) {
      billing.getCustomerInfo().then(
        (info) => active && setEligible(trialEligible(info)),
        () => undefined,
      );
    }
    return () => {
      active = false;
    };
  }, [visible, trigger, role, isParent, billing]);

  // After a purchase, wait for the server entitlement (FR-PAY-1): never trust the device.
  useEffect(() => {
    if (phase !== 'activating') return;
    const timer = setInterval(() => {
      if (Date.now() - startedAt.current > ACTIVATING_TIMEOUT_MS) {
        setPhase('stalled');
        return;
      }
      void refresh();
      // The mock store sends a delayed webhook when asked; this lets it go out.
      billing.getCustomerInfo().catch(() => undefined);
    }, ACTIVATING_POLL_MS);
    return () => clearInterval(timer);
  }, [phase, refresh, billing]);

  const done = (phase === 'activating' || phase === 'stalled') && isPremium;
  const shownPhase: Phase = done ? 'active' : phase;

  const close = useCallback(() => {
    onClose();
    setPhase('choose');
    setError(null);
  }, [onClose]);

  const pkg =
    offering?.availablePackages.find((p) => p.packageType === selected) ??
    offering?.availablePackages[0] ??
    null;

  async function buy() {
    if (!pkg) return;
    setPhase('busy');
    setError(null);
    try {
      await billing.purchasePackage(pkg);
      const period = productPeriod(pkg);
      if (eligible) track('trial_started', { product_period: period });
      track('purchase_completed', { product_period: period, is_trial: eligible });
      startedAt.current = Date.now();
      setPhase('activating');
      void refresh();
    } catch (caught) {
      const key = purchaseErrorKey(caught);
      if (key) track('purchase_failed', { error_code: purchaseErrorCode(caught) });
      setError(key);
      setPhase('choose');
    }
  }

  async function restore() {
    setPhase('busy');
    setError(null);
    try {
      const info = await billing.restorePurchases();
      const found = restoreFound(info);
      track('purchases_restored', { found });
      if (found) {
        startedAt.current = Date.now();
        setPhase('activating');
        void refresh();
      } else {
        setError('restoreNone');
        setPhase('choose');
      }
    } catch (caught) {
      setError(purchaseErrorKey(caught));
      setPhase('choose');
    }
  }

  const { lead, others } = benefitsFor(trigger);
  const priceFor = (p: Package) =>
    t(p.packageType === 'ANNUAL' ? 'premium.sheet.perYear' : 'premium.sheet.perMonth', {
      price: p.product.priceString,
    });

  const status =
    shownPhase === 'active'
      ? 'active'
      : shownPhase === 'activating'
        ? 'activating'
        : shownPhase === 'stalled'
          ? 'stalled'
          : isPremium
            ? 'alreadyPremium'
            : !isParent
              ? 'askParent'
              : null;

  const footer =
    status === 'stalled' ? (
      <View style={{ gap: theme.space[2] }}>
        <Button
          label={t('premium.sheet.restore')}
          onPress={restore}
          fullWidth
          testID="premium-restore"
        />
        <Button
          variant="ghost"
          label={t('premium.sheet.close')}
          onPress={close}
          fullWidth
          testID="premium-close"
        />
      </View>
    ) : status ? (
      <Button
        label={t(status === 'active' ? 'premium.sheet.done' : 'premium.sheet.close')}
        variant={status === 'active' ? 'primary' : 'secondary'}
        onPress={close}
        fullWidth
        testID={status === 'active' ? 'premium-done' : 'premium-close'}
      />
    ) : (
      <View style={{ gap: theme.space[2] }}>
        <Button
          label={
            eligible
              ? t('premium.sheet.startTrial', { days: TRIAL_DAYS })
              : t('premium.sheet.subscribe')
          }
          onPress={buy}
          loading={phase === 'busy'}
          disabled={!pkg || phase === 'busy'}
          fullWidth
          testID="premium-start-trial"
        />
        <Button
          variant="secondary"
          label={t('premium.sheet.restore')}
          onPress={restore}
          disabled={phase === 'busy' || billing.name === 'none'}
          fullWidth
          testID="premium-restore"
        />
        <Button
          variant="ghost"
          label={t('premium.sheet.notNow')}
          onPress={close}
          fullWidth
          testID="premium-not-now"
        />
      </View>
    );

  return (
    <BottomSheet
      visible={visible}
      onClose={close}
      title={t('premium.sheet.title')}
      footer={footer}
      testID="premium-sheet"
    >
      <View style={{ gap: theme.space[4] }}>
        {billing.name === 'mock' ? (
          <Banner
            variant="info"
            message={t('premium.sheet.testNotice')}
            testID="premium-test-notice"
          />
        ) : null}

        {status ? (
          <Card variant="highlight" testID={`premium-status-${status}`}>
            <Text variant="cardTitle" accessibilityLiveRegion="polite">
              {t(`premium.sheet.${status}.title`)}
            </Text>
            <Text>{t(`premium.sheet.${status}.body`)}</Text>
          </Card>
        ) : null}

        {lead ? (
          <View style={{ gap: theme.space[2] }}>
            <Text variant="overline" color="textSecondary">
              {t('premium.sheet.lead')}
            </Text>
            <Benefit benefit={lead} highlight />
          </View>
        ) : null}
        <View style={{ gap: theme.space[2] }}>
          {lead ? (
            <Text variant="overline" color="textSecondary">
              {t('premium.sheet.alsoIncludes')}
            </Text>
          ) : null}
          {others.map((benefit) => (
            <Benefit key={benefit} benefit={benefit} />
          ))}
          <Text variant="caption" color="textSecondary">
            {t('premium.sheet.allMembers')}
          </Text>
        </View>

        {!status && isParent ? (
          offering === undefined ? (
            <Text color="textSecondary" testID="premium-loading">
              {t('premium.sheet.loading')}
            </Text>
          ) : !offering || !pkg ? (
            <Text color="textSecondary" testID="premium-unavailable">
              {t('premium.sheet.unavailable')}
            </Text>
          ) : (
            <View style={{ gap: theme.space[2] }}>
              <Text variant="label">{t('premium.sheet.planLabel')}</Text>
              {offering.availablePackages.map((p) => (
                <RadioOption
                  key={p.identifier}
                  label={t(
                    p.packageType === 'ANNUAL' ? 'premium.sheet.annual' : 'premium.sheet.monthly',
                  )}
                  description={priceFor(p)}
                  selected={p.packageType === pkg.packageType}
                  onPress={() => setSelected(p.packageType)}
                  disabled={phase === 'busy'}
                  testID={`premium-plan-${p.packageType.toLowerCase()}`}
                />
              ))}
              <Text variant="caption" color="textSecondary" testID="premium-terms">
                {eligible
                  ? t('premium.sheet.termsTrial', { days: TRIAL_DAYS, price: priceFor(pkg) })
                  : t('premium.sheet.termsNoTrial', { price: priceFor(pkg) })}{' '}
                {billing.name === 'mock'
                  ? t('premium.sheet.manageMock')
                  : t('premium.sheet.manageStore')}
              </Text>
            </View>
          )
        ) : null}

        {error ? (
          <Text color="error" accessibilityLiveRegion="polite" testID="premium-error">
            {error === 'restoreNone'
              ? t('premium.sheet.restoreNone')
              : t(`premium.sheet.errors.${error}`)}
          </Text>
        ) : null}
      </View>
    </BottomSheet>
  );
}

function Benefit({ benefit, highlight }: { benefit: PremiumBenefit; highlight?: boolean }) {
  const { t, i18n } = useTranslation();
  return (
    <Card variant={highlight ? 'highlight' : 'default'} testID={`premium-benefit-${benefit}`}>
      <Text variant="bodyStrong">{t(`premium.benefits.${benefit}.title`)}</Text>
      <Text color="textSecondary">
        {t(`premium.benefits.${benefit}.body`, {
          premium: formatNumber(AI_IMPORTS_PER_MONTH.premium, i18n.language),
          free: formatNumber(AI_IMPORTS_PER_MONTH.free, i18n.language),
        })}
      </Text>
    </Card>
  );
}

type PremiumSheetContextValue = {
  /** Opens S-32 for a trigger. Pass `afterSheet` when closing another sheet first. */
  openPremiumSheet: (trigger: PremiumTrigger, options?: { afterSheet?: boolean }) => void;
};

const PremiumSheetContext = createContext<PremiumSheetContextValue>({
  openPremiumSheet: () => undefined,
});

/** Holds the one Premium sheet, so any trigger can open it (FR-PAY-5). */
export function PremiumSheetProvider({ children }: { children: ReactNode }) {
  const theme = useTheme();
  const [trigger, setTrigger] = useState<PremiumTrigger | null>(null);
  const [lastTrigger, setLastTrigger] = useState<PremiumTrigger>('premium_section');

  const openPremiumSheet = useCallback<PremiumSheetContextValue['openPremiumSheet']>(
    (next, options) => {
      const show = () => {
        setLastTrigger(next);
        setTrigger(next);
      };
      // Two modals can't show at once: wait for the other sheet's closing animation.
      if (options?.afterSheet) setTimeout(show, theme.motion.base + 120);
      else show();
    },
    [theme.motion.base],
  );

  const value = useMemo(() => ({ openPremiumSheet }), [openPremiumSheet]);
  return (
    <PremiumSheetContext.Provider value={value}>
      {children}
      <PremiumSheet
        visible={trigger !== null}
        trigger={trigger ?? lastTrigger}
        onClose={() => setTrigger(null)}
      />
    </PremiumSheetContext.Provider>
  );
}

export function usePremiumSheet(): PremiumSheetContextValue {
  return useContext(PremiumSheetContext);
}
