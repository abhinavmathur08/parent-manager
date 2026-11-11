import { fireEvent, render, screen } from '@testing-library/react-native';
import { Share } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { InviteSheet } from '@/features/household/invite-sheet';

const mockRpc = jest.fn();
const mockSetString = jest.fn();
let mockParents = 1;
let mockTier = 'free';
let mockOnline = true;

function mockQuery(result: unknown) {
  const chain: Record<string, unknown> = {};
  for (const method of ['select', 'eq', 'is']) chain[method] = () => chain;
  chain.maybeSingle = async () => ({ data: result, error: null });
  chain.then = (resolve: (value: unknown) => void) => resolve({ data: result, error: null });
  return chain;
}

jest.mock('@/lib/supabase', () => ({
  getSupabase: () => ({
    rpc: mockRpc,
    from: (table: string) =>
      table === 'household_members'
        ? mockQuery(Array.from({ length: mockParents }, () => ({ role: 'parent' })))
        : mockQuery({ tier: mockTier }),
  }),
}));
jest.mock('@/features/household/membership', () => ({
  useHousehold: () => ({
    state: {
      status: 'member',
      membership: { householdId: 'h1', role: 'parent', region: 'US', locale: 'en-US' },
    },
    refresh: jest.fn(),
  }),
}));
jest.mock('@/hooks/use-online', () => ({ useOnline: () => mockOnline }));
jest.mock('expo-clipboard', () => ({
  setStringAsync: (...args: unknown[]) => mockSetString(...args),
}));

const metrics = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 47, left: 0, right: 0, bottom: 34 },
};
const renderSheet = () =>
  render(
    <SafeAreaProvider initialMetrics={metrics}>
      <InviteSheet visible onClose={jest.fn()} />
    </SafeAreaProvider>,
  );

beforeEach(() => {
  jest.clearAllMocks();
  mockParents = 1;
  mockTier = 'free';
  mockOnline = true;
  mockSetString.mockResolvedValue(true);
  mockRpc.mockResolvedValue({
    data: {
      id: 'i1',
      role: 'parent',
      code: 'K7MQ3X',
      token: 'tok',
      expires_at: '2026-11-17T12:00:00Z',
    },
    error: null,
  });
});

describe('S-27 invite sheet (FR-HH-1, FR-HH-3)', () => {
  it('creates a parent invite and shares text with the code', async () => {
    const share = jest
      .spyOn(Share, 'share')
      .mockResolvedValue({ action: 'sharedAction', activityType: undefined });
    await renderSheet();
    await fireEvent.press(await screen.findByTestId('invite-create'));
    expect(mockRpc).toHaveBeenCalledWith('create_invitation', {
      household_id: 'h1',
      role: 'parent',
    });
    expect(await screen.findByTestId('invite-code')).toHaveTextContent('K7MQ3X');

    await fireEvent.press(screen.getByTestId('invite-share'));
    const message = share.mock.calls[0][0].message ?? '';
    expect(message).toContain('K7MQ3X');
    expect(message).toContain('as a parent');

    await fireEvent.press(screen.getByTestId('invite-copy'));
    expect(mockSetString).toHaveBeenCalledWith(message);
    expect(await screen.findByText('Copied')).toBeOnTheScreen();
  });

  it('disables the parent role with the reason when there are 2 parents', async () => {
    mockParents = 2;
    await renderSheet();
    expect(
      await screen.findByText('Your household already has 2 parents, the most it can have.'),
    ).toBeOnTheScreen();
    expect(screen.getByTestId('invite-role-parent')).toBeDisabled();
    expect(screen.getByTestId('invite-create')).toBeDisabled();
  });

  it('shows the upgrade prompt for Premium roles on Free', async () => {
    await renderSheet();
    await fireEvent.press(await screen.findByTestId('invite-role-caregiver'));
    expect(screen.getByTestId('invite-upgrade')).toBeOnTheScreen();
    expect(screen.getByTestId('invite-create')).toBeDisabled();
  });

  it('shows the server refusal when seats changed since the sheet opened', async () => {
    mockRpc.mockResolvedValue({ data: null, error: { hint: 'invite.seat_limit' } });
    await renderSheet();
    await fireEvent.press(await screen.findByTestId('invite-create'));
    expect(await screen.findByTestId('invite-error')).toHaveTextContent(/already has 2 parents/);
  });

  it('needs a connection to create an invite', async () => {
    mockOnline = false;
    await renderSheet();
    expect(await screen.findByTestId('invite-offline')).toBeOnTheScreen();
    expect(screen.getByTestId('invite-create')).toBeDisabled();
  });
});
