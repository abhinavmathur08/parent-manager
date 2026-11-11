import { fireEvent, render, screen } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { JoinScreen } from '@/features/onboarding/join-screen';

const mockRpc = jest.fn();
const mockRefresh = jest.fn();
let mockOnline = true;

jest.mock('@/lib/supabase', () => ({ getSupabase: () => ({ rpc: mockRpc }) }));
jest.mock('@/features/household/membership', () => ({
  useHousehold: () => ({ state: { status: 'none' }, refresh: mockRefresh }),
}));
jest.mock('@/hooks/use-online', () => ({ useOnline: () => mockOnline }));
jest.mock('expo-router', () => ({
  router: { back: jest.fn(), replace: jest.fn(), canGoBack: () => true },
}));

const metrics = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 47, left: 0, right: 0, bottom: 34 },
};

async function enterCode(code: string) {
  await render(
    <SafeAreaProvider initialMetrics={metrics}>
      <JoinScreen />
    </SafeAreaProvider>,
  );
  await fireEvent.changeText(screen.getByTestId('join-code'), code);
  await fireEvent.press(screen.getByTestId('join-continue'));
}

beforeEach(() => {
  jest.clearAllMocks();
  mockOnline = true;
  mockRefresh.mockResolvedValue(undefined);
});

describe('S-09 join with a code (FR-HH-4, FR-HH-6, FR-HH-7)', () => {
  it('previews the household, inviter and role, then joins', async () => {
    mockRpc.mockImplementation(async (name: string) =>
      name === 'preview_invitation'
        ? {
            data: { status: 'ok', household_name: 'The Lees', inviter_name: 'Sam', role: 'parent' },
            error: null,
          }
        : { data: { status: 'ok', household_id: 'h1', role: 'parent' }, error: null },
    );
    await enterCode('k7m q3x');
    expect(mockRpc).toHaveBeenCalledWith('preview_invitation', { code: 'K7MQ3X' });
    expect(await screen.findByTestId('join-household-name')).toHaveTextContent('The Lees');
    expect(screen.getByText('Invited by Sam')).toBeOnTheScreen();
    expect(screen.getByTestId('join-role')).toHaveTextContent("You'll join as a parent.");

    await fireEvent.press(screen.getByTestId('join-accept'));
    expect(mockRpc).toHaveBeenCalledWith('accept_invitation', { code: 'K7MQ3X' });
    expect(mockRefresh).toHaveBeenCalled();
  });

  it('checks the code shape before spending an attempt', async () => {
    await enterCode('K7M0Q');
    expect(mockRpc).not.toHaveBeenCalled();
    expect(screen.getByTestId('join-error')).toHaveTextContent(/6 letters and numbers/);
  });

  it.each([
    ['revoked', /no longer valid/],
    ['used', /already been used/],
    ['expired', /has expired/],
    ['rate_limited', /Wait an hour/],
    ['invalid', /couldn't find that code/],
  ])('explains a %s invite', async (status, message) => {
    mockRpc.mockResolvedValue({ data: { status }, error: null });
    await enterCode('K7MQ3X');
    expect(await screen.findByTestId('join-error')).toHaveTextContent(message);
    expect(screen.queryByTestId('join-preview')).toBeNull();
  });

  it('shows a refusal at accept time, such as a seat taken meanwhile', async () => {
    mockRpc.mockImplementation(async (name: string) =>
      name === 'preview_invitation'
        ? {
            data: { status: 'ok', household_name: 'Home', inviter_name: null, role: 'parent' },
            error: null,
          }
        : { data: { status: 'seat_limit' }, error: null },
    );
    await enterCode('K7MQ3X');
    await fireEvent.press(await screen.findByTestId('join-accept'));
    expect(await screen.findByTestId('join-error')).toHaveTextContent(/no free place/);
    expect(mockRefresh).not.toHaveBeenCalled();
  });

  it('needs a connection', async () => {
    mockOnline = false;
    await enterCode('K7MQ3X');
    expect(screen.getByTestId('offline-banner')).toBeOnTheScreen();
    expect(mockRpc).not.toHaveBeenCalled();
  });
});
