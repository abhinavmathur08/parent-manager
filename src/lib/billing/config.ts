import Constants from 'expo-constants';

import type { BillingProviderName } from './types';

/**
 * Which billing implementation this build uses (M-01.1).
 *
 * `EXPO_PUBLIC_BILLING_PROVIDER` asks for one: `mock` now, `revenuecat` once it exists.
 * The mock store is only ever selected where app.config.ts allows it (`billingMockAllowed`):
 * development and preview builds, and the release builds made for end-to-end tests against
 * the local stack. A production build never selects it, whatever the variable says. The
 * server refuses mock purchases too unless `BILLING_MOCK_ENABLED` is set on that project.
 */
export function selectBillingProvider(
  requested: string | undefined,
  mockAllowed: boolean,
): BillingProviderName {
  const value = requested?.trim().toLowerCase();
  if (value === 'mock') return mockAllowed ? 'mock' : 'none';
  // RevenueCat plugs in here as a second implementation (D-10). Until then there is none.
  return 'none';
}

/** Whether app.config.ts allowed the mock store in this build. */
export function mockAllowedInBuild(): boolean {
  return Constants.expoConfig?.extra?.billingMockAllowed === true;
}

/** This build's provider. Expo inlines EXPO_PUBLIC_* only in this exact dotted form. */
export function configuredBillingProvider(): BillingProviderName {
  return selectBillingProvider(process.env.EXPO_PUBLIC_BILLING_PROVIDER, mockAllowedInBuild());
}
