import { billingMockAllowed } from '../../app.config';
import { PRODUCTS, TRIAL_DAYS, storefrontFor } from '@/lib/billing/catalog';
import { selectBillingProvider } from '@/lib/billing/config';
import {
  MockBillingProvider,
  customerInfoFrom,
  type MockStoreBackend,
  type MockStoreSubscription,
} from '@/lib/billing/mock-provider';
import { BillingError } from '@/lib/billing/types';

const subscription: MockStoreSubscription = {
  productId: PRODUCTS.MONTHLY.identifier,
  householdId: 'h1',
  periodType: 'TRIAL',
  originalPurchasedAt: '2026-11-15T10:00:00.000Z',
  periodStartedAt: '2026-11-15T10:00:00.000Z',
  expiresAt: '2026-11-29T10:00:00.000Z',
  willRenew: true,
  unsubscribedAt: null,
  billingIssueAt: null,
  gracePeriodEndsAt: null,
  pendingProductId: null,
  isActive: true,
};

function backend(overrides: Partial<MockStoreBackend> = {}): MockStoreBackend {
  return {
    subscription: jest.fn(async () => subscription),
    purchase: jest.fn(async () => subscription),
    restore: jest.fn(async () => null),
    ...overrides,
  };
}

function provider(store: MockStoreBackend, storefront: 'US' | 'GB' | 'AU' = 'US') {
  return new MockBillingProvider({ backend: store, storefront, locale: () => 'en-US' });
}

describe('provider selection (M-01.1)', () => {
  it('selects the mock only where the build allows it', () => {
    expect(selectBillingProvider('mock', true)).toBe('mock');
    expect(selectBillingProvider(' MOCK ', true)).toBe('mock');
    expect(selectBillingProvider('mock', false)).toBe('none');
  });

  it('has no provider when nothing, or RevenueCat, is asked for', () => {
    expect(selectBillingProvider(undefined, true)).toBe('none');
    expect(selectBillingProvider('revenuecat', true)).toBe('none');
  });

  it('never allows the mock in a production build, except the local E2E build', () => {
    expect(billingMockAllowed('production', undefined)).toBe(false);
    expect(billingMockAllowed('production', '0')).toBe(false);
    expect(billingMockAllowed('production', '1')).toBe(true);
    expect(billingMockAllowed('preview', undefined)).toBe(true);
    expect(billingMockAllowed('development', undefined)).toBe(true);
  });
});

describe('mock offerings', () => {
  it('offers monthly and annual with the 14-day trial (FR-PAY-7)', async () => {
    const { current } = await provider(backend()).getOfferings();
    expect(current?.availablePackages.map((p) => p.packageType)).toEqual(['MONTHLY', 'ANNUAL']);
    expect(current?.monthly?.product.identifier).toBe('pm_premium_monthly');
    expect(current?.annual?.product.subscriptionPeriod).toBe('P1Y');
    expect(current?.monthly?.product.introPrice).toMatchObject({
      price: 0,
      period: 'P14D',
      periodNumberOfUnits: TRIAL_DAYS,
    });
    expect(TRIAL_DAYS).toBe(14);
  });

  it('prices in the storefront currency through the locale helpers', async () => {
    const us = await provider(backend(), 'US').getOfferings();
    expect(us.current?.monthly?.product.priceString).toBe('$4.99');
    const gb = await provider(backend(), 'GB').getOfferings();
    expect(gb.current?.annual?.product.currencyCode).toBe('GBP');
    expect(gb.current?.annual?.product.priceString).toBe('£34.99');
  });

  it('follows the device store region, defaulting to the US store', () => {
    expect(storefrontFor('AU')).toBe('AU');
    expect(storefrontFor('FR')).toBe('US');
    expect(storefrontFor(null)).toBe('US');
  });
});

describe('mock purchases', () => {
  it('needs a signed-in store account and a household', async () => {
    const store = backend();
    const billing = provider(store);
    const { current } = await billing.getOfferings();
    await expect(billing.purchasePackage(current!.monthly!)).rejects.toMatchObject({
      code: 'CONFIGURATION_ERROR',
    });
    await billing.logIn('u1');
    await expect(billing.purchasePackage(current!.monthly!)).rejects.toBeInstanceOf(BillingError);
    expect(store.purchase).not.toHaveBeenCalled();
  });

  it('buys for the household attribute and returns CustomerInfo', async () => {
    const store = backend();
    const billing = provider(store);
    await billing.logIn('u1');
    await billing.setAttributes({ household_id: 'h1' });
    billing.delayNextWebhook = true;
    const { current } = await billing.getOfferings();
    const result = await billing.purchasePackage(current!.annual!);
    expect(store.purchase).toHaveBeenCalledWith({
      productId: 'pm_premium_annual',
      householdId: 'h1',
      delayWebhook: true,
    });
    expect(billing.delayNextWebhook).toBe(false);
    expect(result.customerInfo.entitlements.active.premium).toMatchObject({
      isActive: true,
      periodType: 'TRIAL',
      store: 'MOCK_STORE',
      isSandbox: true,
    });
  });

  it('restores nothing when the store account never bought', async () => {
    const billing = provider(backend());
    await billing.logIn('u1');
    const info = await billing.restorePurchases();
    expect(info.entitlements.active).toEqual({});
    expect(info.activeSubscriptions).toEqual([]);
    expect(info.originalAppUserId).toBe('u1');
  });

  it('marks a cancelled-in-error flag only for user cancellation', () => {
    expect(new BillingError('PURCHASE_CANCELLED_ERROR').userCancelled).toBe(true);
    expect(new BillingError('NETWORK_ERROR').userCancelled).toBe(false);
  });
});

describe('customerInfoFrom', () => {
  it('lists an expired subscription under all but not active', () => {
    const info = customerInfoFrom({ ...subscription, isActive: false, willRenew: false }, 'u1');
    expect(info.entitlements.active).toEqual({});
    expect(info.entitlements.all.premium.isActive).toBe(false);
    expect(info.latestExpirationDate).toBe(subscription.expiresAt);
  });
});
