import { act, render, screen } from '@testing-library/react-native';
import { Text } from 'react-native';

import {
  ENTITLEMENT_POLL_MS,
  EntitlementProvider,
  useEntitlement,
} from '@/features/subscription/entitlement';

const row = (tier: 'free' | 'premium', status = tier === 'premium' ? 'trialing' : 'none') => ({
  tier,
  status,
  source: tier === 'premium' ? 'mock' : null,
  product_id: null,
  pending_product_id: null,
  period_ends_at: null,
  trial_ends_at: null,
  grace_ends_at: null,
  will_renew: tier === 'premium',
  purchaser_user_id: null,
});

let mockRow: ReturnType<typeof row> = row('free');
let mockRealtime: ((payload: unknown) => void) | null = null;
const mockFilter = jest.fn();
const mockRemove = jest.fn();
const mockLogIn = jest.fn();
const mockSetAttributes = jest.fn();

jest.mock('@/lib/supabase', () => ({
  getSupabase: () => ({
    from: () => {
      const chain: Record<string, unknown> = {};
      chain.select = () => chain;
      chain.eq = () => chain;
      chain.maybeSingle = async () => ({ data: mockRow, error: null });
      return chain;
    },
    channel: () => {
      const channel = {
        on: (_type: string, filter: unknown, callback: (payload: unknown) => void) => {
          mockFilter(filter);
          mockRealtime = callback;
          return channel;
        },
        subscribe: () => channel,
      };
      return channel;
    },
    removeChannel: mockRemove,
  }),
}));
jest.mock('@/lib/billing', () => ({
  getBilling: () => ({
    logIn: mockLogIn,
    logOut: jest.fn(),
    setAttributes: mockSetAttributes,
  }),
}));
jest.mock('@/features/auth/session', () => ({
  useAuth: () => ({ status: 'signedIn', session: { user: { id: 'me' } } }),
}));
jest.mock('@/features/household/membership', () => ({
  useHousehold: () => ({
    state: { status: 'member', membership: { householdId: 'h1', role: 'parent' } },
  }),
}));

function Probe() {
  const { entitlement, isPremium } = useEntitlement();
  return (
    <Text testID="tier">{entitlement ? `${entitlement.status}:${isPremium}` : 'loading'}</Text>
  );
}

beforeEach(() => {
  jest.useFakeTimers();
  jest.clearAllMocks();
  mockRow = row('free');
});
afterEach(() => jest.useRealTimers());

it('loads the household tier from the server (FR-PAY-1)', async () => {
  await render(
    <EntitlementProvider>
      <Probe />
    </EntitlementProvider>,
  );
  expect(await screen.findByText('none:false')).toBeOnTheScreen();
  expect(mockLogIn).toHaveBeenCalledWith('me');
  expect(mockSetAttributes).toHaveBeenCalledWith({ household_id: 'h1' });
});

it('shows Premium as soon as Realtime delivers it (FR-PAY-8)', async () => {
  await render(
    <EntitlementProvider>
      <Probe />
    </EntitlementProvider>,
  );
  await screen.findByText('none:false');
  expect(mockFilter).toHaveBeenCalledWith(
    expect.objectContaining({ table: 'household_entitlements', filter: 'household_id=eq.h1' }),
  );
  await act(async () => mockRealtime?.({ eventType: 'UPDATE', new: row('premium') }));
  expect(screen.getByText('trialing:true')).toBeOnTheScreen();
});

it('checks again within 60 seconds when Realtime is quiet', async () => {
  await render(
    <EntitlementProvider>
      <Probe />
    </EntitlementProvider>,
  );
  await screen.findByText('none:false');
  mockRow = row('premium', 'active');
  await act(async () => {
    jest.advanceTimersByTime(ENTITLEMENT_POLL_MS);
  });
  expect(await screen.findByText('active:true')).toBeOnTheScreen();
  expect(ENTITLEMENT_POLL_MS).toBeLessThanOrEqual(60_000);
});
