// The subscription products (M-01.1, FR-PAY-7). The identifiers match the app's catalog
// (src/lib/billing/catalog.ts) and the ones the product owner will create in the stores (D-10).

export const PRODUCTS = {
  pm_premium_monthly: { months: 1 },
  pm_premium_annual: { months: 12 },
} as const;

export type ProductId = keyof typeof PRODUCTS;

export function isProductId(value: unknown): value is ProductId {
  return typeof value === 'string' && Object.hasOwn(PRODUCTS, value);
}

/** PROPOSED (spec FR-PAY-7, D-10): the free trial length. */
export const TRIAL_DAYS = 14;

/** The mock store's billing grace period, like the App Store's 16 days. */
export const GRACE_DAYS = 16;

const DAY_MS = 24 * 60 * 60 * 1000;

export function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * DAY_MS);
}

/** Adds calendar months in UTC, clamping to the month's last day (Jan 31 + 1 month = Feb 28). */
export function addMonths(date: Date, months: number): Date {
  const result = new Date(date.getTime());
  const day = result.getUTCDate();
  result.setUTCDate(1);
  result.setUTCMonth(result.getUTCMonth() + months);
  const last = new Date(
    Date.UTC(result.getUTCFullYear(), result.getUTCMonth() + 1, 0),
  ).getUTCDate();
  result.setUTCDate(Math.min(day, last));
  return result;
}

export function periodEnd(product: ProductId, start: Date): Date {
  return addMonths(start, PRODUCTS[product].months);
}
