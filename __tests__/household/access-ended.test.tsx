import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { Text } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { AccessEnded } from '@/features/household/access-ended';
import { markRemovalSeen, onHouseholdAccessLost } from '@/features/household/access-lost';
import { HouseholdProvider, useHousehold } from '@/features/household/membership';

const mockRpc = jest.fn();
const mockRefresh = jest.fn();
let mockMemberRow: unknown = null;
let mockUseRealHousehold = true;

jest.mock('@/lib/supabase', () => ({
  getSupabase: () => {
    const chain: Record<string, unknown> = { rpc: mockRpc };
    for (const method of ['from', 'select', 'eq', 'is', 'limit']) chain[method] = () => chain;
    chain.maybeSingle = async () => ({ data: mockMemberRow, error: null });
    return chain;
  },
}));
jest.mock('@/features/auth/session', () => ({
  useAuth: () => ({ status: 'signedIn', session: { user: { id: 'u1' } } }),
}));
jest.mock('@/features/household/membership', () => {
  const actual = jest.requireActual('@/features/household/membership');
  return {
    ...actual,
    useHousehold: () =>
      mockUseRealHousehold ? actual.useHousehold() : { state: {}, refresh: mockRefresh },
  };
});
jest.mock('@/hooks/use-online', () => ({ useOnline: () => true }));
jest.mock('expo-sqlite/kv-store', () => {
  const store = new Map<string, string>();
  return {
    __esModule: true,
    default: {
      getItemSync: (key: string) => store.get(key) ?? null,
      setItemSync: (key: string, value: string) => void store.set(key, value),
      removeItemSync: (key: string) => store.delete(key),
    },
  };
});

const metrics = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 47, left: 0, right: 0, bottom: 34 },
};

function Status() {
  const { state } = useHousehold();
  return <Text testID="status">{JSON.stringify(state)}</Text>;
}

const renderProvider = () =>
  render(
    <HouseholdProvider>
      <Status />
    </HouseholdProvider>,
  );

beforeEach(() => {
  jest.clearAllMocks();
  mockUseRealHousehold = true;
  mockMemberRow = null;
  mockRefresh.mockResolvedValue(undefined);
});

describe('access ending (FR-HH-10, FR-PAY-9)', () => {
  it('clears household data on the device once a member is removed, and shows S-35', async () => {
    const cleanup = jest.fn();
    const unregister = onHouseholdAccessLost(cleanup);
    mockMemberRow = {
      household_id: 'h1',
      role: 'caregiver',
      households: { region: 'US', locale: 'en-US' },
    };
    const first = await renderProvider();
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent(/"member"/));
    await first.unmount();

    mockMemberRow = null;
    mockRpc.mockResolvedValue({
      data: { status: 'removed', household_id: 'h1', household_name: 'Home', role: 'caregiver' },
      error: null,
    });
    await renderProvider();
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent(/"ended"/));
    expect(screen.getByTestId('status')).toHaveTextContent(/"removed"/);
    expect(cleanup).toHaveBeenCalledTimes(1);
    unregister();
  });

  it('shows a paused member S-35 every time, and a removed one only until they move on', async () => {
    mockRpc.mockResolvedValue({
      data: { status: 'paused', household_id: 'h1', household_name: 'Home', role: 'caregiver' },
      error: null,
    });
    const paused = await renderProvider();
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent(/"paused"/));
    await paused.unmount();

    markRemovalSeen('u1', 'h2');
    mockRpc.mockResolvedValue({
      data: { status: 'removed', household_id: 'h2', household_name: 'Old', role: 'family' },
      error: null,
    });
    await renderProvider();
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent(/"none"/));
  });
});

describe('S-35 removed or paused', () => {
  const renderScreen = (reason: 'removed' | 'paused') =>
    render(
      <SafeAreaProvider initialMetrics={metrics}>
        <AccessEnded reason={reason} householdId="h1" householdName="Home" />
      </SafeAreaProvider>,
    );

  beforeEach(() => {
    mockUseRealHousehold = false;
  });

  it('lets a removed member move on to create or join', async () => {
    await renderScreen('removed');
    expect(screen.getByText("You're no longer in Home")).toBeOnTheScreen();
    await fireEvent.press(screen.getByTestId('access-ended-continue'));
    expect(mockRefresh).toHaveBeenCalled();
  });

  it('lets a paused member check again, or leave after confirming', async () => {
    mockRpc.mockResolvedValue({ data: { deleted: false }, error: null });
    await renderScreen('paused');
    expect(screen.getByText('Your access to Home is paused')).toBeOnTheScreen();
    await fireEvent.press(screen.getByTestId('access-ended-leave'));
    expect(mockRpc).not.toHaveBeenCalled();
    expect(screen.getByTestId('access-ended-leave-warning')).toBeOnTheScreen();
    await fireEvent.press(screen.getByTestId('access-ended-leave'));
    expect(mockRpc).toHaveBeenCalledWith('leave_household', { household_id: 'h1' });
    await waitFor(() => expect(mockRefresh).toHaveBeenCalled());
  });
});
