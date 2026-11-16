import { BillingError, PREMIUM_ENTITLEMENT, type CustomerInfo, type Package } from '@/lib/billing';

/** FR-PAY-8 edge case: the buying device shows "activating" for up to 5 minutes. */
export const ACTIVATING_TIMEOUT_MS = 5 * 60_000;
/** How often the buying device checks the entitlement while activating. */
export const ACTIVATING_POLL_MS = 3_000;

export type PurchaseErrorKey =
  'network' | 'alreadyPremium' | 'alreadySubscribed' | 'notAllowed' | 'unavailable' | 'generic';

/** The sheet's message for a failed purchase or restore, or null when the user cancelled. */
export function purchaseErrorKey(error: unknown): PurchaseErrorKey | null {
  if (!(error instanceof BillingError)) return 'generic';
  if (error.userCancelled) return null;
  switch (error.code) {
    case 'NETWORK_ERROR':
      return 'network';
    case 'PRODUCT_ALREADY_PURCHASED_ERROR':
      return error.reason === 'billing.already_subscribed' ? 'alreadySubscribed' : 'alreadyPremium';
    case 'PURCHASE_NOT_ALLOWED_ERROR':
      return 'notAllowed';
    case 'CONFIGURATION_ERROR':
      return 'unavailable';
    default:
      return 'generic';
  }
}

/** A stable code for `purchase_failed`, never free text. */
export function purchaseErrorCode(error: unknown): string {
  if (error instanceof BillingError) {
    return error.reason ?? `billing.${error.code.toLowerCase()}`;
  }
  return 'billing.unknown';
}

export function productPeriod(pkg: Package): 'monthly' | 'annual' {
  return pkg.packageType === 'ANNUAL' ? 'annual' : 'monthly';
}

/**
 * Whether this store account can still get the free trial: stores give one introductory
 * offer per subscription group, so any earlier Premium subscription uses it up.
 */
export function trialEligible(info: CustomerInfo | null): boolean {
  return !info?.entitlements.all[PREMIUM_ENTITLEMENT];
}

/** Whether a restore found an active subscription. */
export function restoreFound(info: CustomerInfo): boolean {
  return Boolean(info.entitlements.active[PREMIUM_ENTITLEMENT]);
}
