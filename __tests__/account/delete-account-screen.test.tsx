import { fireEvent, render, screen } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { DeleteAccountScreen } from '@/features/account/delete-account-screen';
import { DifferentAccountError } from '@/features/account/reauth';

const mockPreview = jest.fn();
const mockDelete = jest.fn();
const mockSendCode = jest.fn();
const mockVerify = jest.fn();
const mockSameAccount = jest.fn();
const mockSignOut = jest.fn();
let mockOnline = true;

jest.mock('@/features/account/deletion', () => ({
  ...jest.requireActual('@/features/account/deletion'),
  fetchDeletionPreview: () => mockPreview(),
  deleteAccount: () => mockDelete(),
}));
jest.mock('@/features/account/reauth', () => {
  class DifferentAccountError extends Error {}
  return {
    DifferentAccountError,
    requestReauthCode: (email: string) => mockSendCode(email),
    reauthenticateWithCode: (email: string, code: string) => mockVerify(email, code),
    reauthenticateWithProvider: jest.fn(),
    assertSameAccount: (id: string) => mockSameAccount(id),
  };
});
jest.mock('@/features/auth/session', () => ({
  useAuth: () => ({
    status: 'signedIn',
    session: { user: { id: 'u1', email: 'sam@example.com', app_metadata: { provider: 'email' } } },
  }),
}));
jest.mock('@/features/auth/sign-out', () => ({ signOut: () => mockSignOut() }));
jest.mock('@/hooks/use-online', () => ({ useOnline: () => mockOnline }));
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
      <DeleteAccountScreen />
    </SafeAreaProvider>,
  );

async function confirmWithCode() {
  await fireEvent.press(await screen.findByTestId('delete-account-start'));
  await fireEvent.press(screen.getByTestId('delete-account-reauth-send'));
  expect(mockSendCode).toHaveBeenCalledWith('sam@example.com');
  await fireEvent.changeText(screen.getByTestId('delete-account-reauth-code'), '123456');
  await fireEvent.press(screen.getByTestId('delete-account-reauth-confirm'));
}

beforeEach(() => {
  jest.clearAllMocks();
  mockOnline = true;
  mockPreview.mockResolvedValue({ outcome: 'leave', householdId: 'h1', householdName: 'Home' });
  mockDelete.mockResolvedValue({ householdDeleted: false });
  mockSendCode.mockResolvedValue(undefined);
  mockVerify.mockResolvedValue(undefined);
  mockSameAccount.mockResolvedValue(undefined);
  mockSignOut.mockResolvedValue(undefined);
});

describe('delete account (FR-PRIV-3)', () => {
  it('names what will be deleted and warns about store subscriptions', async () => {
    await renderScreen();
    expect(await screen.findByTestId('delete-account-outcome')).toHaveTextContent(
      /Home carries on for its other members/,
    );
    expect(screen.getByTestId('delete-account-subscription')).toHaveTextContent(
      /doesn't cancel a subscription/,
    );
    expect(screen.getByTestId('delete-account-backups')).toHaveTextContent(/within 30 days/);
  });

  it('says the household goes too when nobody else can keep it', async () => {
    mockPreview.mockResolvedValue({
      outcome: 'delete_household',
      householdId: 'h1',
      householdName: 'Home',
    });
    await renderScreen();
    expect(await screen.findByTestId('delete-account-outcome')).toHaveTextContent(
      /your account and Home, with all its recipes/,
    );
  });

  it('signs in again with a code, deletes, then signs out', async () => {
    await renderScreen();
    await confirmWithCode();
    expect(mockVerify).toHaveBeenCalledWith('sam@example.com', '123456');
    expect(mockSameAccount).toHaveBeenCalledWith('u1');
    expect(mockDelete).toHaveBeenCalled();
    expect(mockSignOut).toHaveBeenCalled();
  });

  it('deletes nothing when the new sign-in is a different account', async () => {
    mockSameAccount.mockRejectedValue(new DifferentAccountError());
    await renderScreen();
    await confirmWithCode();
    expect(mockDelete).not.toHaveBeenCalled();
    expect(mockSignOut).not.toHaveBeenCalled();
    expect(screen.getByTestId('delete-account-reauth-error')).toHaveTextContent(
      /different account/,
    );
  });

  it('keeps the user signed in if the server refuses', async () => {
    mockDelete.mockRejectedValue({ hint: 'account.reauthentication_required' });
    await renderScreen();
    await confirmWithCode();
    expect(mockSignOut).not.toHaveBeenCalled();
    expect(screen.getByTestId('delete-account-reauth-error')).toHaveTextContent(/took too long/);
  });

  it('offers members instead of deleting when they are the last parent', async () => {
    mockPreview.mockResolvedValue({
      outcome: 'last_parent',
      householdId: 'h1',
      householdName: 'Home',
    });
    await renderScreen();
    expect(await screen.findByTestId('delete-account-members')).toBeOnTheScreen();
    expect(screen.queryByTestId('delete-account-start')).toBeNull();
  });

  it('needs a connection', async () => {
    mockOnline = false;
    await renderScreen();
    expect(screen.getByTestId('offline-banner')).toBeOnTheScreen();
    expect(mockPreview).not.toHaveBeenCalled();
  });
});
