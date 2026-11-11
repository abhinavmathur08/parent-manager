import { fireEvent, render, screen } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { MembersScreen } from '@/features/household/members-screen';

const mockRpc = jest.fn();
let mockRole = 'parent';
const mockData: Record<string, unknown> = {};

jest.mock('@/lib/supabase', () => ({
  getSupabase: () => ({
    rpc: mockRpc,
    from: (table: string) => {
      const chain: Record<string, unknown> = {};
      for (const method of ['select', 'eq', 'is', 'in', 'order']) chain[method] = () => chain;
      chain.maybeSingle = async () => ({ data: mockData[table], error: null });
      chain.then = (resolve: (value: unknown) => void) =>
        resolve({ data: mockData[table], error: null });
      return chain;
    },
  }),
}));
jest.mock('@/features/auth/session', () => ({
  useAuth: () => ({ status: 'signedIn', session: { user: { id: 'me' } } }),
}));
jest.mock('@/features/household/membership', () => ({
  useHousehold: () => ({
    state: {
      status: 'member',
      membership: { householdId: 'h1', role: mockRole, region: 'US', locale: 'en-US' },
    },
    refresh: jest.fn(),
  }),
}));
jest.mock('@/hooks/use-online', () => ({ useOnline: () => true }));
jest.mock('expo-router', () => ({
  router: { back: jest.fn(), replace: jest.fn(), canGoBack: () => true },
}));
jest.mock('expo-clipboard', () => ({ setStringAsync: jest.fn() }));

const metrics = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 47, left: 0, right: 0, bottom: 34 },
};
const renderScreen = () =>
  render(
    <SafeAreaProvider initialMetrics={metrics}>
      <MembersScreen />
    </SafeAreaProvider>,
  );

beforeEach(() => {
  jest.clearAllMocks();
  mockRole = 'parent';
  mockRpc.mockResolvedValue({ data: null, error: null });
  mockData.household_members = [
    { user_id: 'me', role: 'parent', joined_at: '2026-11-01T12:00:00Z' },
    { user_id: 'c1', role: 'caregiver', joined_at: '2026-11-05T12:00:00Z' },
  ];
  mockData.profiles = [
    { id: 'me', display_name: 'Sam' },
    { id: 'c1', display_name: 'Rosa' },
  ];
  mockData.household_entitlements = { tier: 'premium' };
  mockData.invitations = [
    { id: 'i1', role: 'parent', expires_at: '2099-01-01T12:00:00Z' },
    { id: 'i2', role: 'parent', expires_at: '2020-01-01T12:00:00Z' },
  ];
});

describe('S-26 members and invitations (FR-HH-9, FR-HH-10)', () => {
  it('lists members with roles and join dates, and pending invites with expiry', async () => {
    await renderScreen();
    expect(await screen.findByText('Sam (you)')).toBeOnTheScreen();
    expect(screen.getByText('Parent · Joined Nov 1, 2026')).toBeOnTheScreen();
    expect(screen.getByText('Rosa')).toBeOnTheScreen();
    expect(screen.getByText('Expires Jan 1, 2099')).toBeOnTheScreen();
    expect(screen.getByText(/Expired Jan 1, 2020/)).toBeOnTheScreen();
  });

  it('revokes an invite and reloads', async () => {
    await renderScreen();
    await fireEvent.press(await screen.findByTestId('invite-0-revoke'));
    expect(mockRpc).toHaveBeenCalledWith('revoke_invitation', { invitation_id: 'i1' });
  });

  it('is read-only for other roles', async () => {
    mockRole = 'caregiver';
    await renderScreen();
    expect(await screen.findByText('Rosa')).toBeOnTheScreen();
    expect(screen.queryByTestId('open-invite')).toBeNull();
    expect(screen.queryByTestId('invite-0')).toBeNull();
  });
});
