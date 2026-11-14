import { fireEvent, render, screen } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { DeleteHouseholdScreen } from '@/features/household/delete-household-screen';
import {
  fetchDeletionRequest,
  requestHouseholdDeletion,
} from '@/features/household/deletion-request';

const mockRpc = jest.fn();
const mockRequestRow = jest.fn();
const mockRefresh = jest.fn();
const mockMembers = jest.fn();
let mockRole = 'parent';

jest.mock('@/lib/supabase', () => ({
  getSupabase: () => ({
    rpc: mockRpc,
    from: () => {
      const chain: Record<string, unknown> = {};
      chain.select = () => chain;
      chain.eq = () => chain;
      chain.maybeSingle = async () => ({ data: mockRequestRow(), error: null });
      return chain;
    },
  }),
}));
jest.mock('@/features/household/members', () => ({ fetchMembers: () => mockMembers() }));
jest.mock('@/features/household/membership', () => ({
  useHousehold: () => ({
    state: { status: 'member', membership: { householdId: 'h1', role: mockRole } },
    refresh: mockRefresh,
  }),
}));
jest.mock('@/features/auth/session', () => ({
  useAuth: () => ({
    status: 'signedIn',
    session: { user: { id: 'me', email: 'sam@example.com', app_metadata: { provider: 'email' } } },
  }),
}));
// The sheet's sign-in is tested with the account deletion; here it confirms straight away.
jest.mock('@/features/account/reauth-sheet', () => {
  const { Pressable } = jest.requireActual('react-native');
  return {
    ReauthSheet: ({ visible, onConfirmed }: { visible: boolean; onConfirmed: () => void }) =>
      visible ? <Pressable testID="reauth-ok" onPress={onConfirmed} /> : null,
  };
});
jest.mock('@/hooks/use-online', () => ({ useOnline: () => true }));
jest.mock('expo-router', () => ({
  router: { back: jest.fn(), replace: jest.fn(), push: jest.fn(), canGoBack: () => true },
}));

const metrics = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 47, left: 0, right: 0, bottom: 34 },
};
const renderScreen = () =>
  render(
    <SafeAreaProvider initialMetrics={metrics}>
      <DeleteHouseholdScreen />
    </SafeAreaProvider>,
  );
const member = (userId: string, role: string, displayName: string) => ({
  userId,
  role,
  displayName,
  joinedAt: '2026-11-01T00:00:00Z',
});
const LATER = '2099-01-08T12:00:00Z';

beforeEach(() => {
  jest.clearAllMocks();
  mockRole = 'parent';
  mockRequestRow.mockReturnValue(null);
  mockMembers.mockResolvedValue([member('me', 'parent', 'Sam'), member('p2', 'parent', 'Alex')]);
  mockRpc.mockResolvedValue({ data: { status: 'requested' }, error: null });
  mockRefresh.mockResolvedValue(undefined);
});

describe('delete household (FR-PRIV-7)', () => {
  it('ignores a lapsed request', async () => {
    mockRequestRow.mockReturnValue({ requested_by: 'p2', expires_at: '2026-11-01T00:00:00Z' });
    await expect(fetchDeletionRequest('h1', new Date('2026-11-13T00:00:00Z'))).resolves.toBeNull();
    mockRequestRow.mockReturnValue({ requested_by: 'p2', expires_at: LATER });
    await expect(fetchDeletionRequest('h1')).resolves.toEqual({
      requestedBy: 'p2',
      expiresAt: LATER,
    });
  });

  it('reads whether the household went at once', async () => {
    mockRpc.mockResolvedValue({ data: { status: 'deleted' }, error: null });
    await expect(requestHouseholdDeletion('h1')).resolves.toBe('deleted');
    expect(mockRpc).toHaveBeenCalledWith('request_household_deletion', { household_id: 'h1' });
  });

  it('with two parents, asks the other parent to confirm', async () => {
    await renderScreen();
    expect(await screen.findByTestId('delete-household-body')).toHaveTextContent(
      /Alex must confirm within 7 days/,
    );
    await fireEvent.press(screen.getByText('Ask to delete household'));
    mockRequestRow.mockReturnValue({ requested_by: 'me', expires_at: LATER });
    await fireEvent.press(screen.getByTestId('reauth-ok'));
    expect(mockRpc).toHaveBeenCalledWith('request_household_deletion', { household_id: 'h1' });
    expect(mockRefresh).not.toHaveBeenCalled();
    expect(await screen.findByText(/It's deleted if Alex confirms/)).toBeOnTheScreen();
    expect(screen.getByTestId('delete-household-cancel')).toHaveTextContent('Cancel request');
    expect(screen.queryByTestId('delete-household-start')).toBeNull();
  });

  it('the only parent deletes at once, and the app leaves the household', async () => {
    mockMembers.mockResolvedValue([member('me', 'parent', 'Sam'), member('c', 'caregiver', 'Jo')]);
    mockRpc.mockResolvedValue({ data: { status: 'deleted' }, error: null });
    await renderScreen();
    await fireEvent.press(await screen.findByTestId('delete-household-start'));
    await fireEvent.press(screen.getByTestId('reauth-ok'));
    expect(mockRefresh).toHaveBeenCalled();
  });

  it('the other parent confirms, or keeps the household', async () => {
    mockRequestRow.mockReturnValue({ requested_by: 'p2', expires_at: LATER });
    await renderScreen();
    expect(await screen.findByTestId('delete-household-body')).toHaveTextContent(
      /Alex asked to delete the household/,
    );
    await fireEvent.press(screen.getByTestId('delete-household-cancel'));
    expect(mockRpc).toHaveBeenCalledWith('cancel_household_deletion', { household_id: 'h1' });

    mockRpc.mockClear();
    mockRpc.mockResolvedValue({ data: null, error: null });
    mockRequestRow.mockReturnValue({ requested_by: 'p2', expires_at: LATER });
    await screen.unmount();
    await renderScreen();
    await fireEvent.press(await screen.findByTestId('delete-household-start'));
    await fireEvent.press(screen.getByTestId('reauth-ok'));
    expect(mockRpc).toHaveBeenCalledWith('confirm_household_deletion', { household_id: 'h1' });
    expect(mockRefresh).toHaveBeenCalled();
  });

  it('is for parents only', async () => {
    mockRole = 'family';
    await renderScreen();
    expect(screen.getByTestId('delete-household-parents-only')).toBeOnTheScreen();
    expect(screen.queryByTestId('delete-household-start')).toBeNull();
    expect(mockMembers).not.toHaveBeenCalled();
  });
});
