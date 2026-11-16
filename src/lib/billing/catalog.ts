import type { PackageType } from './types';

/**
 * The mock store's catalog (M-01.1, FR-PAY-7). Product identifiers match the ones the
 * product owner will create in App Store Connect, Play Console and RevenueCat (D-10), and
 * the server's mock store (`supabase/functions/_shared/billing/products.ts`).
 *
 * PROPOSED: every price here is a placeholder for the mock store only. Real prices are set
 * by the product owner in the stores before the beta (D-10). Nobody is ever charged them.
 */

export const OFFERING_ID = 'default';

/** PROPOSED (spec FR-PAY-7, D-10): the free trial length, in days. */
export const TRIAL_DAYS = 14;

export const PRODUCTS = {
  MONTHLY: { identifier: 'pm_premium_monthly', packageId: '$rc_monthly', period: 'P1M' },
  ANNUAL: { identifier: 'pm_premium_annual', packageId: '$rc_annual', period: 'P1Y' },
} as const satisfies Record<PackageType, { identifier: string; packageId: string; period: string }>;

export type ProductId = (typeof PRODUCTS)[PackageType]['identifier'];

export function packageTypeOf(productId: string): PackageType | null {
  if (productId === PRODUCTS.MONTHLY.identifier) return 'MONTHLY';
  if (productId === PRODUCTS.ANNUAL.identifier) return 'ANNUAL';
  return null;
}

/** The mock store's storefronts. A storefront sets the currency, as a real store does. */
export type Storefront = 'US' | 'GB' | 'AU';

/**
 * PROPOSED placeholder prices per storefront, in the store's currency. Not the product
 * owner's prices (D-10): they exist so the Premium sheet can show something realistic.
 */
export const PLACEHOLDER_PRICES: Record<
  Storefront,
  { currencyCode: string } & Record<PackageType, number>
> = {
  US: { currencyCode: 'USD', MONTHLY: 4.99, ANNUAL: 39.99 },
  GB: { currencyCode: 'GBP', MONTHLY: 4.49, ANNUAL: 34.99 },
  AU: { currencyCode: 'AUD', MONTHLY: 7.99, ANNUAL: 59.99 },
};

/**
 * The store region follows the device's store account, not the household (spec 3.13 edge
 * cases). The mock store reads the device region, and falls back to the US store.
 */
export function storefrontFor(regionCode: string | null | undefined): Storefront {
  return regionCode === 'GB' || regionCode === 'AU' ? regionCode : 'US';
}
