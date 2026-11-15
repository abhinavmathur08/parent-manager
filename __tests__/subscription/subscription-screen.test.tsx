import { fireEvent, render, screen } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import type { Entitlement } from '@/features/subscription/entitlement';
import { statusSummary } from '@/features/subscription/status';
import { SubscriptionScreen } from '@/features/subscription/subscription-screen';
import { setBillingForTesting } from '@/lib/billing';
import { MockBillingProvider, type MockStoreBackend } from '@/lib/billing/mock-provider';

const mockTrack = jest.fn();
const mockRefresh = jest.fn();
const mockOpen = jest.fn();
const mockPush = jest.fn();
let mockEntitlement: Entitlement | null = null;
let mockRole = 'parent';

jest.mock('@/lib/analytics', () => ({ track: (...args: unknown[]) => mockTrack(...args) }));
jest.mock('expo-router', () => ({
  router: { push: (...a: unknown[]) => mockPush(...a), back: jest.fn(), canGoBack: () => true },
}));
jest.mock('@/features/auth/session', () => ({
  useAuth: () => ({ status: 'signedIn', session: { user: { id: 'me' } } }),
}));
jest.mock('@/features/household/membership', () => ({
  useHousehold: () => ({
    state: { status: 'member', membership: { householdId: 'h1', role: mockRole } },
  }),
}));
jest.mock('@/features/household/members', () => ({
  fetchMembers: async () => [{ userId: 'partner', role: 'parent', displayName: 'Alex' }],
}));
jest.mock('@/features/subscription/entitlement', () => ({
  useEntitlement: () => ({
    entitlement: mockEntitlement,
    isPremium: mockEntitlement?.tier === 'premium',
    refresh: mockRefresh,
  }),
}));
jest.mock('@/features/subscription/premium-sheet', () => ({
  usePremiumSheet: () => ({ openPremiumSheet: mockOpen }),
}));
jest.mock('@/lib/billing/config', () => ({
  ...jest.requireActual('@/lib/billing/config'),
  mockAllowedInBuild: () => true,
}));
jest.mock('@/lib/billing/http-backend', () => ({
  mockStoreAdmin: { enabled: async () => true },
}));

const premium = (over: Partial<Entitlement> = {}): Entitlement => ({
  tier: 'premium',
  status: 'active',
  source: 'mock',
  productId: 'pm_premium_monthly',
  pendingProductId: null,
  periodEndsAt: '2026-12-15T12:00:00Z',
  trialEndsAt: null,
  graceEndsAt: null,
  willRenew: true,
  purchaserUserId: 'me',
  ...over,
});

let backend: jest.Mocked<MockStoreBackend>;

async function renderScreen() {
  return render(
    <SafeAreaProvider
      initialMetrics={{
        frame: { x: 0, y: 0, width: 390, height: 844 },
        insets: { top: 47, left: 0, right: 0, bottom: 34 },
      }}
    >
      <SubscriptionScreen />
    </SafeAreaProvider>,
  );
}

beforeEach(async () => {
  jest.clearAllMocks();
  mockEntitlement = null;
  mockRole = 'parent';
  backend = {
    subscription: jest.fn().mockResolvedValue(null),
    purchase: jest.fn(),
    restore: jest.fn().mockResolvedValue(null),
  };
  const provider = new MockBillingProvider({ backend, storefront: 'US', locale: () => 'en-US' });
  await provider.logIn('me');
  setBillingForTesting(provider);
});
afterAll(() => setBillingForTesting(null));

describe('statusSummary', () => {
  it('describes each lifecycle state with its date', () => {
    expect(statusSummary(null)).toEqual({ kind: 'free' });
    expect(statusSummary(premium({ status: 'trialing', trialEndsAt: 'T' }))).toEqual({
      kind: 'trial',
      date: 'T',
    });
    expect(statusSummary(premium()).kind).toBe('renews');
    expect(statusSummary(premium({ willRenew: false })).kind).toBe('ends');
    expect(statusSummary(premium({ status: 'grace_period', graceEndsAt: 'G' }))).toEqual({
      kind: 'grace',
      date: 'G',
    });
    expect(statusSummary(premium({ tier: 'free', status: 'expired' })).kind).toBe('expired');
    expect(statusSummary(premium({ tier: 'free', status: 'refunded' })).kind).toBe('refunded');
  });
});

describe('S-33 subscription status (FR-PAY-8)', () => {
  it('shows Free with a way to see Premium', async () => {
    await renderScreen();
    expect(screen.getByTestId('subscription-tier')).toHaveTextContent('Free');
    await fireEvent.press(screen.getByTestId('subscription-see-premium'));
    expect(mockOpen).toHaveBeenCalledWith('premium_section');
  });

  it('shows the tier, renewal date, plan and buyer, and manages in the test store', async () => {
    mockEntitlement = premium();
    await renderScreen();
    expect(screen.getByTestId('subscription-tier')).toHaveTextContent('Premium');
    expect(screen.getByTestId('subscription-summary-renews')).toHaveTextContent(
      'Renews on Dec 15, 2026.',
    );
    expect(screen.getByTestId('subscription-plan')).toHaveTextContent(/Monthly/);
    expect(screen.getByTestId('subscription-buyer')).toHaveTextContent(/You/);
    expect(screen.getByTestId('subscription-mock')).toBeOnTheScreen();
    await fireEvent.press(await screen.findByTestId('subscription-manage'));
    expect(mockPush).toHaveBeenCalledWith('/household/mock-store');
  });

  it('names the other parent who bought it, and only they can manage', async () => {
    mockEntitlement = premium({ purchaserUserId: 'partner' });
    await renderScreen();
    expect(await screen.findByText('Alex')).toBeOnTheScreen();
    expect(screen.getByTestId('subscription-managed-by')).toBeOnTheScreen();
    expect(screen.queryByTestId('subscription-manage')).toBeNull();
  });

  it('restores after a reinstall, then waits for the server', async () => {
    backend.restore.mockResolvedValue({
      productId: 'pm_premium_monthly',
      householdId: 'h1',
      periodType: 'NORMAL',
      originalPurchasedAt: '2026-11-15T00:00:00Z',
      periodStartedAt: '2026-11-15T00:00:00Z',
      expiresAt: '2026-12-15T00:00:00Z',
      willRenew: true,
      unsubscribedAt: null,
      billingIssueAt: null,
      gracePeriodEndsAt: null,
      pendingProductId: null,
      isActive: true,
    });
    await renderScreen();
    await fireEvent.press(screen.getByTestId('subscription-restore'));
    expect(await screen.findByTestId('subscription-activating')).toBeOnTheScreen();
    expect(mockTrack).toHaveBeenCalledWith('purchases_restored', { found: true });
  });

  it('says when there is nothing to restore', async () => {
    await renderScreen();
    await fireEvent.press(screen.getByTestId('subscription-restore'));
    expect(await screen.findByTestId('subscription-restore-none')).toBeOnTheScreen();
  });

  it('shows status but no purchase actions to other members', async () => {
    mockRole = 'family';
    mockEntitlement = premium();
    await renderScreen();
    expect(screen.getByTestId('subscription-tier')).toHaveTextContent('Premium');
    expect(screen.queryByTestId('subscription-restore')).toBeNull();
  });
});
