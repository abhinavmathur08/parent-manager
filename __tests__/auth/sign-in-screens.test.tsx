import { AuthApiError } from '@supabase/supabase-js';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { router } from 'expo-router';
import { useNetworkState } from 'expo-network';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { readPendingSignIn, savePendingSignIn } from '@/features/auth/pending-sign-in';
import { onSignOut, signOut } from '@/features/auth/sign-out';
import { SignInScreen } from '@/features/auth/sign-in-screen';
import { VerifyCodeScreen } from '@/features/auth/verify-code-screen';

const mockAuth = {
  signInWithOtp: jest.fn(),
  verifyOtp: jest.fn(),
  signOut: jest.fn(),
};

jest.mock('@/lib/supabase', () => ({ getSupabase: () => ({ auth: mockAuth }) }));
jest.mock('expo-linking', () => ({
  createURL: (path: string) => `parentmanager://${path}`,
}));
jest.mock('expo-network', () => ({ useNetworkState: jest.fn() }));
jest.mock('expo-router', () => ({
  router: { push: jest.fn(), back: jest.fn(), replace: jest.fn(), canGoBack: () => true },
}));
jest.mock('expo-sqlite/kv-store', () => {
  const store = new Map<string, string>();
  return {
    __esModule: true,
    default: {
      getItemSync: (key: string) => store.get(key) ?? null,
      setItemSync: (key: string, value: string) => void store.set(key, value),
      removeItemSync: (key: string) => store.delete(key),
      getAllKeys: async () => [...store.keys()],
      removeItem: async (key: string) => void store.delete(key),
    },
  };
});

const metrics = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 47, left: 0, right: 0, bottom: 34 },
};
const wrap = (node: React.ReactElement) => (
  <SafeAreaProvider initialMetrics={metrics}>{node}</SafeAreaProvider>
);

const network = useNetworkState as jest.Mock;
const wrongCode = () => new AuthApiError('Token has expired or is invalid', 403, 'otp_expired');

beforeEach(() => {
  jest.clearAllMocks();
  network.mockReturnValue({ isConnected: true, isInternetReachable: true });
  mockAuth.signInWithOtp.mockResolvedValue({ data: {}, error: null });
  mockAuth.verifyOtp.mockResolvedValue({ data: {}, error: null });
  mockAuth.signOut.mockResolvedValue({ error: null });
});

describe('S-02 sign in', () => {
  it('sends a code to the normalized address and opens the code screen', async () => {
    await render(wrap(<SignInScreen />));
    await fireEvent.changeText(screen.getByTestId('sign-in-email'), ' Sam@Example.com ');
    await fireEvent.press(screen.getByTestId('sign-in-continue'));

    expect(mockAuth.signInWithOtp).toHaveBeenCalledWith({
      email: 'sam@example.com',
      options: {
        shouldCreateUser: true,
        data: { locale: 'en-US' },
        emailRedirectTo: 'parentmanager://auth-callback',
      },
    });
    expect(router.push).toHaveBeenCalledWith('/verify');
    expect(readPendingSignIn()?.email).toBe('sam@example.com');
  });

  it('asks for a full address before calling the server', async () => {
    await render(wrap(<SignInScreen />));
    await fireEvent.changeText(screen.getByTestId('sign-in-email'), 'sam@example');
    await fireEvent.press(screen.getByTestId('sign-in-continue'));
    expect(mockAuth.signInWithOtp).not.toHaveBeenCalled();
    expect(screen.getByTestId('sign-in-email-error')).toHaveTextContent(
      'Enter a full email address, like name@example.com.',
    );
  });

  it('shows the server error in the user language', async () => {
    mockAuth.signInWithOtp.mockResolvedValue({
      data: {},
      error: new AuthApiError('Rate limit', 429, 'over_email_send_rate_limit'),
    });
    await render(wrap(<SignInScreen />));
    await fireEvent.changeText(screen.getByTestId('sign-in-email'), 'new@example.com');
    await fireEvent.press(screen.getByTestId('sign-in-continue'));
    expect(screen.getByTestId('sign-in-email-error')).toHaveTextContent(/Too many tries/);
    expect(router.push).not.toHaveBeenCalled();
  });

  it('shows the offline message and disables sign-in while offline', async () => {
    network.mockReturnValue({ isConnected: false, isInternetReachable: false });
    await render(wrap(<SignInScreen />));
    expect(screen.getByTestId('offline-banner')).toHaveTextContent(/You're offline/);
    expect(screen.getByTestId('sign-in-continue')).toBeDisabled();
  });
});

describe('S-03 enter code', () => {
  beforeEach(() => {
    savePendingSignIn({ email: 'sam@example.com', sentAt: Date.now() });
  });

  it('signs in with a correct code', async () => {
    await render(wrap(<VerifyCodeScreen />));
    expect(screen.getByTestId('verify-sent-to')).toHaveTextContent(/sam@example.com/);
    await fireEvent.changeText(screen.getByTestId('verify-code'), '123456');
    expect(mockAuth.verifyOtp).toHaveBeenCalledWith({
      email: 'sam@example.com',
      token: '123456',
      type: 'email',
    });
    expect(readPendingSignIn()).toBeNull();
  });

  it('stops accepting the code after 5 wrong tries until a new one is sent', async () => {
    mockAuth.verifyOtp.mockResolvedValue({ data: {}, error: wrongCode() });
    await render(wrap(<VerifyCodeScreen />));
    for (let i = 0; i < 5; i += 1) {
      await fireEvent.changeText(screen.getByTestId('verify-code'), '000000');
    }
    expect(mockAuth.verifyOtp).toHaveBeenCalledTimes(5);
    expect(screen.getByTestId('verify-code-error')).toHaveTextContent(/too many wrong tries/);

    await fireEvent.changeText(screen.getByTestId('verify-code'), '000000');
    expect(mockAuth.verifyOtp).toHaveBeenCalledTimes(5);
  });

  it('limits resending to every 30 seconds, and a new code resets the count', async () => {
    jest.useFakeTimers({ now: Date.now() });
    try {
      mockAuth.verifyOtp.mockResolvedValue({ data: {}, error: wrongCode() });
      await render(wrap(<VerifyCodeScreen />));
      expect(screen.getByTestId('verify-resend')).toBeDisabled();
      expect(screen.getByTestId('verify-resend-wait')).toHaveTextContent(
        'You can send a new code in 30 seconds.',
      );
      for (let i = 0; i < 5; i += 1) {
        await fireEvent.changeText(screen.getByTestId('verify-code'), '000000');
      }

      await act(async () => {
        jest.advanceTimersByTime(31_000);
      });
      expect(screen.getByTestId('verify-resend')).toBeEnabled();
      await fireEvent.press(screen.getByTestId('verify-resend'));
      expect(mockAuth.signInWithOtp).toHaveBeenCalledTimes(1);
      expect(screen.getByTestId('verify-notice')).toHaveTextContent('We sent a new code.');

      mockAuth.verifyOtp.mockResolvedValue({ data: {}, error: null });
      await fireEvent.changeText(screen.getByTestId('verify-code'), '654321');
      expect(mockAuth.verifyOtp).toHaveBeenCalledTimes(6);
    } finally {
      jest.useRealTimers();
    }
  });
});

describe('sign-out (FR-AUTH-7)', () => {
  it('runs every cleanup, clears drafts and the pending email, then the session', async () => {
    savePendingSignIn({ email: 'sam@example.com', sentAt: 1 });
    const order: string[] = [];
    const failing = onSignOut(() => {
      order.push('failing');
      throw new Error('push token removal failed');
    });
    const sync = onSignOut(async () => {
      order.push('sync');
    });
    mockAuth.signOut.mockImplementation(async () => {
      order.push('session');
      return { error: null };
    });

    await signOut();

    expect(order).toEqual(['failing', 'sync', 'session']);
    expect(mockAuth.signOut).toHaveBeenCalledWith({ scope: 'local' });
    expect(readPendingSignIn()).toBeNull();
    failing();
    sync();
  });
});
