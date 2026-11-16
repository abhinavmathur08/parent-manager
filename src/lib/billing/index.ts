import { getLocales } from 'expo-localization';

import { i18n } from '@/i18n';

import { storefrontFor } from './catalog';
import { configuredBillingProvider } from './config';
import { httpMockStoreBackend } from './http-backend';
import { MockBillingProvider } from './mock-provider';
import { BillingError, type BillingProvider } from './types';

export * from './types';
export { PRODUCTS, TRIAL_DAYS, packageTypeOf } from './catalog';
export { configuredBillingProvider, selectBillingProvider } from './config';

/** A build without a store: offerings are empty and buying fails with a clear code. */
const noProvider: BillingProvider = {
  name: 'none',
  async logIn() {},
  async logOut() {},
  async setAttributes() {},
  async getOfferings() {
    return { current: null, all: {} };
  },
  async purchasePackage() {
    throw new BillingError('CONFIGURATION_ERROR', 'billing.unavailable');
  },
  async restorePurchases() {
    throw new BillingError('CONFIGURATION_ERROR', 'billing.unavailable');
  },
  async getCustomerInfo() {
    throw new BillingError('CONFIGURATION_ERROR', 'billing.unavailable');
  },
};

function deviceRegion(): string | null {
  try {
    return getLocales()[0]?.regionCode ?? null;
  } catch {
    return null;
  }
}

let provider: BillingProvider | null = null;

/** The build's billing provider (M-01.1). RevenueCat becomes a second case here (D-10). */
export function getBilling(): BillingProvider {
  if (!provider) {
    provider =
      configuredBillingProvider() === 'mock'
        ? new MockBillingProvider({
            backend: httpMockStoreBackend,
            storefront: storefrontFor(deviceRegion()),
            locale: () => i18n.language,
          })
        : noProvider;
  }
  return provider;
}

/** Tests only. */
export function setBillingForTesting(next: BillingProvider | null) {
  provider = next;
}
