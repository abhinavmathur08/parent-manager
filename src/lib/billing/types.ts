/**
 * The billing interface (M-01.1, FR-PAY-7). It is shaped like RevenueCat's
 * `react-native-purchases` API (offerings, packages, purchasePackage, restorePurchases and
 * CustomerInfo), so a RevenueCat implementation can replace the mock store mechanically
 * (architecture section 8).
 *
 * The app never decides the household's tier from these objects (FR-PAY-1): the tier comes
 * from `household_entitlements` on the server. These are for showing offerings, buying and
 * restoring only.
 */

/** Which implementation is in use. `none` means the build can't buy anything. */
export type BillingProviderName = 'mock' | 'revenuecat' | 'none';

/** RevenueCat's `PACKAGE_TYPE`, limited to the two Phase 1 products. */
export type PackageType = 'MONTHLY' | 'ANNUAL';

/** RevenueCat's period units for introductory prices. */
export type PeriodUnit = 'DAY' | 'WEEK' | 'MONTH' | 'YEAR';

/** The free trial, as RevenueCat's `PurchasesIntroPrice`. */
export interface IntroPrice {
  price: number;
  priceString: string;
  /** ISO 8601 duration, such as `P14D`. */
  period: string;
  periodUnit: PeriodUnit;
  periodNumberOfUnits: number;
  cycles: number;
}

/** A product as the store reports it (RevenueCat's `PurchasesStoreProduct`). */
export interface StoreProduct {
  identifier: string;
  price: number;
  /** Formatted in the store's currency through the locale helpers. */
  priceString: string;
  currencyCode: string;
  /** ISO 8601 duration, such as `P1M`. */
  subscriptionPeriod: string;
  introPrice: IntroPrice | null;
}

/** RevenueCat's `PurchasesPackage`. */
export interface Package {
  identifier: string;
  packageType: PackageType;
  product: StoreProduct;
  offeringIdentifier: string;
}

/** RevenueCat's `PurchasesOffering`. */
export interface Offering {
  identifier: string;
  availablePackages: Package[];
  monthly: Package | null;
  annual: Package | null;
}

/** RevenueCat's `PurchasesOfferings`. */
export interface Offerings {
  current: Offering | null;
  all: Record<string, Offering>;
}

/** Where a subscription was bought. `MOCK_STORE` is the test store (no charge). */
export type Store = 'APP_STORE' | 'PLAY_STORE' | 'MOCK_STORE';

/** RevenueCat's `PurchasesEntitlementInfo`. Dates are ISO 8601 strings. */
export interface EntitlementInfo {
  identifier: string;
  isActive: boolean;
  willRenew: boolean;
  periodType: 'NORMAL' | 'TRIAL';
  latestPurchaseDate: string;
  originalPurchaseDate: string;
  expirationDate: string | null;
  store: Store;
  productIdentifier: string;
  isSandbox: boolean;
  unsubscribeDetectedAt: string | null;
  billingIssueDetectedAt: string | null;
}

/** RevenueCat's `CustomerInfo`, for the signed-in store account. */
export interface CustomerInfo {
  entitlements: {
    active: Record<string, EntitlementInfo>;
    all: Record<string, EntitlementInfo>;
  };
  activeSubscriptions: string[];
  latestExpirationDate: string | null;
  originalAppUserId: string;
  /** The store's own management page. Null for the mock store, which is managed in the app. */
  managementURL: string | null;
}

/** RevenueCat's `MakePurchaseResult`. */
export interface PurchaseResult {
  productIdentifier: string;
  customerInfo: CustomerInfo;
}

/** RevenueCat's `PURCHASES_ERROR_CODE` values the app handles. */
export type BillingErrorCode =
  | 'PURCHASE_CANCELLED_ERROR'
  | 'PURCHASE_NOT_ALLOWED_ERROR'
  | 'PRODUCT_ALREADY_PURCHASED_ERROR'
  | 'NETWORK_ERROR'
  | 'STORE_PROBLEM_ERROR'
  | 'CONFIGURATION_ERROR'
  | 'UNKNOWN_ERROR';

/** A failed billing call. `userCancelled` mirrors RevenueCat's flag. */
export class BillingError extends Error {
  readonly userCancelled: boolean;

  constructor(
    readonly code: BillingErrorCode,
    /** A stable server code such as `billing.already_premium`, when the store gave one. */
    readonly reason?: string,
  ) {
    super(reason ? `${code}: ${reason}` : code);
    this.name = 'BillingError';
    this.userCancelled = code === 'PURCHASE_CANCELLED_ERROR';
  }
}

/**
 * One billing implementation: the mock store now, RevenueCat later. Method names and
 * results follow `react-native-purchases`.
 */
export interface BillingProvider {
  readonly name: BillingProviderName;
  /** Signs the store account in as the Supabase user (RevenueCat's `logIn`). */
  logIn(appUserId: string): Promise<void>;
  logOut(): Promise<void>;
  /** RevenueCat's `setAttributes`: the household the purchase is for (architecture 8). */
  setAttributes(attributes: { household_id: string }): Promise<void>;
  getOfferings(): Promise<Offerings>;
  purchasePackage(pkg: Package): Promise<PurchaseResult>;
  restorePurchases(): Promise<CustomerInfo>;
  getCustomerInfo(): Promise<CustomerInfo>;
}

/** The entitlement identifier configured in the store (D-10). */
export const PREMIUM_ENTITLEMENT = 'premium';
