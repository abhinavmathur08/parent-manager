import { fireEvent, render, screen } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { AccountScreen } from '@/features/account/account-screen';
import { signInMethod } from '@/features/account/sign-in-method';

const mockSave = jest.fn();
const mockSignOut = jest.fn();

jest.mock('@/features/auth/session', () => ({
  useAuth: () => ({
    status: 'signedIn',
    session: { user: { id: 'u1', email: 'sam@example.com', app_metadata: { provider: 'email' } } },
  }),
}));
jest.mock('@/features/onboarding/profile', () => ({
  fetchDisplayName: async () => 'Sam',
  saveDisplayName: (...args: unknown[]) => mockSave(...args),
}));
jest.mock('@/features/auth/sign-out', () => ({ signOut: () => mockSignOut() }));
jest.mock('@/features/biometric/lock-settings', () => ({ LockSettingsSection: () => null }));
jest.mock('@/hooks/use-online', () => ({ useOnline: () => true }));
jest.mock('expo-router', () => ({
  router: { back: jest.fn(), replace: jest.fn(), canGoBack: () => true },
}));

const metrics = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 47, left: 0, right: 0, bottom: 34 },
};
const renderScreen = () =>
  render(
    <SafeAreaProvider initialMetrics={metrics}>
      <AccountScreen />
    </SafeAreaProvider>,
  );

beforeEach(() => {
  jest.clearAllMocks();
  mockSave.mockResolvedValue(undefined);
  mockSignOut.mockResolvedValue(undefined);
});

describe('account (S-31)', () => {
  it('shows who is signed in and how', async () => {
    await renderScreen();
    expect(screen.getByTestId('account-email')).toHaveTextContent('sam@example.com');
    expect(screen.getByTestId('account-method')).toHaveTextContent('Signed in with an email code');
    expect(await screen.findByDisplayValue('Sam')).toBeOnTheScreen();
  });

  it('saves a changed display name, trimmed', async () => {
    await renderScreen();
    await screen.findByDisplayValue('Sam');
    expect(screen.queryByTestId('account-save-name')).toBeNull();
    await fireEvent.changeText(screen.getByTestId('account-display-name'), ' Sammy ');
    await fireEvent.press(screen.getByTestId('account-save-name'));
    expect(mockSave).toHaveBeenCalledWith('u1', ' Sammy ');
    expect(await screen.findByText('Name saved.')).toBeOnTheScreen();
    expect(screen.queryByTestId('account-save-name')).toBeNull();
  });

  it('refuses an empty name', async () => {
    await renderScreen();
    await screen.findByDisplayValue('Sam');
    await fireEvent.changeText(screen.getByTestId('account-display-name'), '  ');
    await fireEvent.press(screen.getByTestId('account-save-name'));
    expect(mockSave).not.toHaveBeenCalled();
    expect(screen.getByTestId('account-message')).toHaveTextContent(/Enter a name/);
  });

  it('signs out', async () => {
    await renderScreen();
    await fireEvent.press(screen.getByTestId('sign-out'));
    expect(mockSignOut).toHaveBeenCalled();
  });

  it('names the sign-in method from the provider', () => {
    expect(signInMethod({ app_metadata: { provider: 'apple' } })).toBe('apple');
    expect(signInMethod({ app_metadata: { provider: 'google' } })).toBe('google');
    expect(signInMethod({ app_metadata: {} })).toBe('email');
  });
});
