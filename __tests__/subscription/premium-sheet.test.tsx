import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { PremiumSheet } from '@/features/subscription/premium-sheet';
import { purchaseErrorKey, trialEligible } from '@/features/subscription/purchase';
import { benefitsFor } from '@/features/subscription/triggers';
import { setBillingForTesting } from '@/lib/billing';
import { MockBillingProvider, type MockStoreBackend } from '@/lib/billing/mock-provider';
import { BillingError } from '@/lib/billing/types';

const mockTrack = jest.fn();
let mockRole = 'parent';
let mockPremium = false;
const mockRefresh = jest.fn();

jest.mock('@/lib/analytics', () => ({ track: (...args: unknown[]) => mockTrack(...args) }));
jest.mock('@/features/household/membership', () => ({
  useHousehold: () => ({
    state: { status: 'member', membership: { householdId: 'h1', role: mockRole } },
  }),
}));
jest.mock('@/features/subscription/entitlement', () => ({
  useEntitlement: () => ({ isPremium: mockPremium, entitlement: null, refresh: mockRefresh }),
}));

const subscription = {
  productId: 'pm_premium_annual',
  householdId: 'h1',
  periodType: 'TRIAL' as const,
  originalPurchasedAt: '2026-11-15T00:00:00Z',
  periodStartedAt: '2026-11-15T00:00:00Z',
  expiresAt: '2026-11-29T00:00:00Z',
  willRenew: true,
  unsubscribedAt: null,
  billingIssueAt: null,
  gracePeriodEndsAt: null,
  pendingProductId: null,
  isActive: true,
};

let backend: jest.Mocked<MockStoreBackend>;

async function renderSheet(
  trigger: Parameters<typeof PremiumSheet>[0]['trigger'] = 'caregiver_invite',
) {
  const onClose = jest.fn();
  const view = await render(
    <SafeAreaProvider
      initialMetrics={{
        frame: { x: 0, y: 0, width: 390, height: 844 },
        insets: { top: 47, left: 0, right: 0, bottom: 34 },
      }}
    >
      <PremiumSheet visible trigger={trigger} onClose={onClose} />
    </SafeAreaProvider>,
  );
  return { ...view, onClose };
}

beforeEach(async () => {
  jest.clearAllMocks();
  mockRole = 'parent';
  mockPremium = false;
  backend = {
    subscription: jest.fn().mockResolvedValue(null),
    purchase: jest.fn().mockResolvedValue(subscription),
    restore: jest.fn().mockResolvedValue(null),
  };
  const provider = new MockBillingProvider({ backend, storefront: 'US', locale: () => 'en-US' });
  await provider.logIn('me');
  await provider.setAttributes({ household_id: 'h1' });
  setBillingForTesting(provider);
});

afterAll(() => setBillingForTesting(null));

describe('S-32 Premium sheet (FR-PAY-4)', () => {
  it('names the triggering benefit first, then the others', async () => {
    await renderSheet('caregiver_invite');
    expect(screen.getByTestId('premium-benefit-seats')).toBeOnTheScreen();
    expect(benefitsFor('caregiver_invite')).toEqual({
      lead: 'seats',
      others: ['ai', 'templates', 'history', 'reminders', 'busy_meals', 'documents'],
    });
    expect(benefitsFor('ai_allowance').lead).toBe('ai');
    expect(benefitsFor('reminders').lead).toBe('reminders');
    expect(benefitsFor('busy_day_meals').lead).toBe('busy_meals');
    expect(benefitsFor('documents').lead).toBe('documents');
    expect(benefitsFor('premium_section').lead).toBeNull();
    expect(mockTrack).toHaveBeenCalledWith('paywall_viewed', {
      trigger: 'caregiver_invite',
      role: 'parent',
    });
  });

  it('says a mock purchase is a test with no charge', async () => {
    await renderSheet();
    expect(screen.getByTestId('premium-test-notice')).toHaveTextContent(/no card is charged/);
  });

  it('shows store prices, the trial and the terms', async () => {
    await renderSheet();
    expect(await screen.findByTestId('premium-plan-monthly')).toHaveTextContent(/\$4\.99 a month/);
    expect(screen.getByTestId('premium-plan-annual')).toHaveTextContent(/\$39\.99 a year/);
    expect(screen.getByTestId('premium-start-trial')).toHaveTextContent(/14-day free trial/);
    expect(screen.getByTestId('premium-terms')).toHaveTextContent(/Free for 14 days/);
  });

  it('starts the trial, waits for the server, then shows Premium is on', async () => {
    const view = await renderSheet();
    await screen.findByTestId('premium-plan-monthly');
    await fireEvent.press(screen.getByTestId('premium-plan-monthly'));
    await fireEvent.press(screen.getByTestId('premium-start-trial'));
    expect(backend.purchase).toHaveBeenCalledWith({
      productId: 'pm_premium_monthly',
      householdId: 'h1',
      delayWebhook: false,
    });
    expect(await screen.findByTestId('premium-status-activating')).toBeOnTheScreen();
    expect(mockTrack).toHaveBeenCalledWith('trial_started', { product_period: 'monthly' });
    expect(mockTrack).toHaveBeenCalledWith('purchase_completed', {
      product_period: 'monthly',
      is_trial: true,
    });
    mockPremium = true;
    await act(async () => {
      view.rerender(
        <SafeAreaProvider
          initialMetrics={{
            frame: { x: 0, y: 0, width: 390, height: 844 },
            insets: { top: 47, left: 0, right: 0, bottom: 34 },
          }}
        >
          <PremiumSheet visible trigger="caregiver_invite" onClose={view.onClose} />
        </SafeAreaProvider>,
      );
    });
    expect(screen.getByTestId('premium-status-active')).toBeOnTheScreen();
    await fireEvent.press(screen.getByTestId('premium-done'));
    expect(view.onClose).toHaveBeenCalled();
  });

  it('offers a plain subscribe when the trial was used', async () => {
    backend.subscription.mockResolvedValue({ ...subscription, isActive: false });
    await renderSheet();
    expect(await screen.findByText('Subscribe')).toBeOnTheScreen();
  });

  it('shows "ask a parent" to other members, with nothing to buy', async () => {
    mockRole = 'family';
    await renderSheet('template');
    expect(screen.getByTestId('premium-status-askParent')).toBeOnTheScreen();
    expect(screen.queryByTestId('premium-start-trial')).toBeNull();
  });

  it('tells a parent when the household already has Premium', async () => {
    mockPremium = true;
    await renderSheet();
    expect(screen.getByTestId('premium-status-alreadyPremium')).toBeOnTheScreen();
    expect(screen.queryByTestId('premium-start-trial')).toBeNull();
  });

  it('reports a restore that finds nothing', async () => {
    await renderSheet();
    await fireEvent.press(screen.getByTestId('premium-restore'));
    expect(await screen.findByTestId('premium-error')).toHaveTextContent(/didn't find/);
    expect(mockTrack).toHaveBeenCalledWith('purchases_restored', { found: false });
  });

  it('shows the second-parent guard from the store', async () => {
    backend.purchase.mockRejectedValue(
      new BillingError('PRODUCT_ALREADY_PURCHASED_ERROR', 'billing.already_premium'),
    );
    await renderSheet();
    await screen.findByTestId('premium-plan-monthly');
    await fireEvent.press(screen.getByTestId('premium-start-trial'));
    expect(await screen.findByTestId('premium-error')).toHaveTextContent(/already has Premium/);
    expect(mockTrack).toHaveBeenCalledWith('purchase_failed', {
      error_code: 'billing.already_premium',
    });
  });
});

describe('purchase helpers', () => {
  it('maps store errors to messages, and stays quiet on cancel', () => {
    expect(purchaseErrorKey(new BillingError('PURCHASE_CANCELLED_ERROR'))).toBeNull();
    expect(purchaseErrorKey(new BillingError('NETWORK_ERROR'))).toBe('network');
    expect(
      purchaseErrorKey(
        new BillingError('PRODUCT_ALREADY_PURCHASED_ERROR', 'billing.already_subscribed'),
      ),
    ).toBe('alreadySubscribed');
    expect(purchaseErrorKey(new Error('x'))).toBe('generic');
  });

  it('gives the trial only to a store account that never subscribed', () => {
    expect(trialEligible(null)).toBe(true);
  });
});
