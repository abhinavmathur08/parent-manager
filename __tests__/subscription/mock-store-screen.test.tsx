import { fireEvent, render, screen } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { MockStoreScreen } from '@/features/subscription/mock-store-screen';
import { setBillingForTesting } from '@/lib/billing';
import { MockBillingProvider } from '@/lib/billing/mock-provider';

let mockAllowed = true;
let mockEnabled = true;
const mockAdvance = jest.fn();
const mockManage = jest.fn();
const mockRefresh = jest.fn();

jest.mock('expo-router', () => ({ router: { back: jest.fn(), canGoBack: () => true } }));
jest.mock('@/features/household/membership', () => ({
  useHousehold: () => ({
    state: { status: 'member', membership: { householdId: 'h1', role: 'parent' } },
  }),
}));
jest.mock('@/features/subscription/entitlement', () => ({
  useEntitlement: () => ({ refresh: mockRefresh }),
}));
jest.mock('@/lib/billing/config', () => ({
  ...jest.requireActual('@/lib/billing/config'),
  mockAllowedInBuild: () => mockAllowed,
}));
const live = {
  productId: 'pm_premium_monthly',
  householdId: 'h1',
  periodType: 'TRIAL',
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
jest.mock('@/lib/billing/http-backend', () => ({
  httpMockStoreBackend: { subscription: async () => live },
  mockStoreAdmin: {
    enabled: async () => mockEnabled,
    advance: (...a: unknown[]) => mockAdvance(...a),
    manage: (...a: unknown[]) => mockManage(...a),
  },
}));

const renderScreen = () =>
  render(
    <SafeAreaProvider
      initialMetrics={{
        frame: { x: 0, y: 0, width: 390, height: 844 },
        insets: { top: 47, left: 0, right: 0, bottom: 34 },
      }}
    >
      <MockStoreScreen />
    </SafeAreaProvider>,
  );

beforeEach(() => {
  jest.clearAllMocks();
  mockAllowed = true;
  mockEnabled = true;
  setBillingForTesting(
    new MockBillingProvider({
      backend: { subscription: jest.fn(), purchase: jest.fn(), restore: jest.fn() },
      storefront: 'US',
      locale: () => 'en-US',
    }),
  );
});
afterAll(() => setBillingForTesting(null));

it('runs the test clock and the store settings on the household subscription', async () => {
  await renderScreen();
  await fireEvent.press(await screen.findByTestId('mock-clock-trial-end'));
  expect(mockAdvance).toHaveBeenCalledWith('h1', 'trial_end');
  await fireEvent.press(await screen.findByTestId('mock-store-cancel'));
  expect(mockManage).toHaveBeenCalledWith('cancel', undefined);
  await fireEvent.press(screen.getByTestId('mock-store-switch'));
  expect(mockManage).toHaveBeenCalledWith('change_product', 'pm_premium_annual');
  expect(mockRefresh).toHaveBeenCalled();
});

it('shows nothing to use where the build does not allow the mock', async () => {
  mockAllowed = false;
  await renderScreen();
  expect(screen.queryByTestId('mock-clock-renewal')).toBeNull();
});

it('shows nothing to use when the server has the mock off', async () => {
  mockEnabled = false;
  await renderScreen();
  expect(await screen.findByText("Purchases aren't available in this build.")).toBeOnTheScreen();
  expect(screen.queryByTestId('mock-clock-renewal')).toBeNull();
});
