import { formatCurrency } from '@/i18n';

import {
  OFFERING_ID,
  PLACEHOLDER_PRICES,
  PRODUCTS,
  TRIAL_DAYS,
  packageTypeOf,
  type Storefront,
} from './catalog';
import {
  BillingError,
  PREMIUM_ENTITLEMENT,
  type BillingProvider,
  type CustomerInfo,
  type EntitlementInfo,
  type Offerings,
  type Package,
  type PackageType,
  type PurchaseResult,
} from './types';

/**
 * The mock store's record of one subscription, as the server's `mock-store` Edge Function
 * returns it. The server keeps the real state (period, trial, auto-renew), so every member
 * and every reinstall sees the same subscription.
 */
export interface MockStoreSubscription {
  productId: string;
  householdId: string;
  periodType: 'NORMAL' | 'TRIAL';
  originalPurchasedAt: string;
  periodStartedAt: string;
  expiresAt: string;
  willRenew: boolean;
  unsubscribedAt: string | null;
  billingIssueAt: string | null;
  gracePeriodEndsAt: string | null;
  /** A plan switch that takes effect at the next renewal. */
  pendingProductId: string | null;
  isActive: boolean;
}

/** The server side of the mock store. `http-backend.ts` calls the Edge Function. */
export interface MockStoreBackend {
  /** The signed-in store account's latest subscription, or null if it never bought one. */
  subscription(): Promise<MockStoreSubscription | null>;
  purchase(input: {
    productId: string;
    householdId: string;
    /** Test only: hold the purchase event back, to see the "activating" state. */
    delayWebhook?: boolean;
  }): Promise<MockStoreSubscription>;
  /** Re-sends the store account's subscription to the server, as a restore does. */
  restore(): Promise<MockStoreSubscription | null>;
}

export interface MockProviderOptions {
  backend: MockStoreBackend;
  storefront: Storefront;
  /** The app's locale, for formatting prices. */
  locale: () => string;
}

/**
 * The mock store (M-01.1): imitates a real store without charging anyone. Offerings come from
 * the PROPOSED placeholder catalog, and purchases and restores go to the server's mock store,
 * which applies them to `household_entitlements` through the same path RevenueCat's webhook
 * will use (M-01.2).
 */
export class MockBillingProvider implements BillingProvider {
  readonly name = 'mock' as const;
  private appUserId: string | null = null;
  private householdId: string | null = null;
  /** Set by tests or the mock management screen to see the "activating" state. */
  delayNextWebhook = false;

  constructor(private readonly options: MockProviderOptions) {}

  async logIn(appUserId: string) {
    this.appUserId = appUserId;
  }

  async logOut() {
    this.appUserId = null;
    this.householdId = null;
  }

  async setAttributes(attributes: { household_id: string }) {
    this.householdId = attributes.household_id;
  }

  async getOfferings(): Promise<Offerings> {
    const offering = {
      identifier: OFFERING_ID,
      monthly: this.package('MONTHLY'),
      annual: this.package('ANNUAL'),
    };
    const current = { ...offering, availablePackages: [offering.monthly, offering.annual] };
    return { current, all: { [OFFERING_ID]: current } };
  }

  async purchasePackage(pkg: Package): Promise<PurchaseResult> {
    const appUserId = this.requireUser();
    if (!this.householdId) throw new BillingError('CONFIGURATION_ERROR', 'billing.no_household');
    const delayWebhook = this.delayNextWebhook;
    this.delayNextWebhook = false;
    const subscription = await this.options.backend.purchase({
      productId: pkg.product.identifier,
      householdId: this.householdId,
      delayWebhook,
    });
    return {
      productIdentifier: subscription.productId,
      customerInfo: customerInfoFrom(subscription, appUserId),
    };
  }

  async restorePurchases(): Promise<CustomerInfo> {
    const appUserId = this.requireUser();
    return customerInfoFrom(await this.options.backend.restore(), appUserId);
  }

  async getCustomerInfo(): Promise<CustomerInfo> {
    const appUserId = this.requireUser();
    return customerInfoFrom(await this.options.backend.subscription(), appUserId);
  }

  private requireUser(): string {
    if (!this.appUserId) throw new BillingError('CONFIGURATION_ERROR', 'billing.signed_out');
    return this.appUserId;
  }

  private package(type: PackageType): Package {
    const prices = PLACEHOLDER_PRICES[this.options.storefront];
    const locale = this.options.locale();
    const product = PRODUCTS[type];
    return {
      identifier: product.packageId,
      packageType: type,
      offeringIdentifier: OFFERING_ID,
      product: {
        identifier: product.identifier,
        price: prices[type],
        priceString: formatCurrency(prices[type], prices.currencyCode, locale),
        currencyCode: prices.currencyCode,
        subscriptionPeriod: product.period,
        introPrice: {
          price: 0,
          priceString: formatCurrency(0, prices.currencyCode, locale),
          period: `P${TRIAL_DAYS}D`,
          periodUnit: 'DAY',
          periodNumberOfUnits: TRIAL_DAYS,
          cycles: 1,
        },
      },
    };
  }
}

/** Builds RevenueCat's CustomerInfo from the mock store's subscription. */
export function customerInfoFrom(
  subscription: MockStoreSubscription | null,
  appUserId: string,
): CustomerInfo {
  if (!subscription || !packageTypeOf(subscription.productId)) {
    return {
      entitlements: { active: {}, all: {} },
      activeSubscriptions: [],
      latestExpirationDate: null,
      originalAppUserId: appUserId,
      managementURL: null,
    };
  }
  const entitlement: EntitlementInfo = {
    identifier: PREMIUM_ENTITLEMENT,
    isActive: subscription.isActive,
    willRenew: subscription.willRenew,
    periodType: subscription.periodType,
    latestPurchaseDate: subscription.periodStartedAt,
    originalPurchaseDate: subscription.originalPurchasedAt,
    expirationDate: subscription.expiresAt,
    store: 'MOCK_STORE',
    productIdentifier: subscription.productId,
    isSandbox: true,
    unsubscribeDetectedAt: subscription.unsubscribedAt,
    billingIssueDetectedAt: subscription.billingIssueAt,
  };
  return {
    entitlements: {
      active: subscription.isActive ? { [PREMIUM_ENTITLEMENT]: entitlement } : {},
      all: { [PREMIUM_ENTITLEMENT]: entitlement },
    },
    activeSubscriptions: subscription.isActive ? [subscription.productId] : [],
    latestExpirationDate: subscription.expiresAt,
    originalAppUserId: appUserId,
    managementURL: null,
  };
}
