import { fireEvent, render, screen } from '@testing-library/react-native';
import { GoogleSignin, statusCodes } from '@react-native-google-signin/google-signin';
import { Platform } from 'react-native';

import { googleSignInPlugins } from '../../app.config';
import { signInWithGoogle } from '@/features/auth/google';
import { isGoogleConfigured } from '@/features/auth/provider-config';
import { signOut } from '@/features/auth/sign-out';
import { SocialSignIn } from '@/features/auth/social-sign-in';

const mockSignInWithIdToken = jest.fn();
const mockProfileUpdate = jest.fn();
const mockAuthSignOut = jest.fn(async () => ({ error: null }));

jest.mock('@/features/auth/provider-config', () => ({
  ...jest.requireActual('@/features/auth/provider-config'),
  googleConfig: { webClientId: 'web.apps.googleusercontent.com', iosClientId: 'ios-id' },
  isGoogleConfigured: jest.fn(() => true),
}));
jest.mock('@/lib/supabase', () => ({
  getSupabase: () => ({
    auth: { signInWithIdToken: mockSignInWithIdToken, signOut: mockAuthSignOut },
    from: () => ({
      update: (values: unknown) => {
        mockProfileUpdate(values);
        const chain = { eq: () => chain, is: async () => ({ error: null }) };
        return chain;
      },
    }),
  }),
}));
jest.mock('@react-native-google-signin/google-signin', () => {
  const codes = { SIGN_IN_CANCELLED: 'CANCELLED', IN_PROGRESS: 'IN_PROGRESS' };
  return {
    GoogleSignin: {
      configure: jest.fn(),
      hasPlayServices: jest.fn(async () => true),
      signIn: jest.fn(),
      signOut: jest.fn(async () => null),
    },
    statusCodes: codes,
    isSuccessResponse: (response: { type: string }) => response.type === 'success',
    isErrorWithCode: (error: unknown) =>
      typeof error === 'object' && error !== null && 'code' in error,
  };
});
jest.mock('expo-apple-authentication', () => ({ isAvailableAsync: async () => false }));
jest.mock('expo-crypto', () => ({}));
jest.mock('expo-linking', () => ({ createURL: (path: string) => `parentmanager://${path}` }));
jest.mock('expo-web-browser', () => ({ openAuthSessionAsync: jest.fn() }));
jest.mock('expo-sqlite/kv-store', () => ({
  __esModule: true,
  default: { getAllKeys: async () => [], removeItem: async () => undefined },
}));

const googleSignIn = GoogleSignin.signIn as jest.Mock;

beforeEach(() => {
  jest.clearAllMocks();
  Platform.OS = 'android';
  mockSignInWithIdToken.mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null });
});

describe('Google sign-in (FR-AUTH-1, FR-AUTH-3)', () => {
  it("signs in with Google's ID token and keeps the name", async () => {
    googleSignIn.mockResolvedValue({
      type: 'success',
      data: { idToken: 'google.jwt', user: { givenName: 'Alex' } },
    });
    await expect(signInWithGoogle()).resolves.toBe('signedIn');
    expect(GoogleSignin.configure).toHaveBeenCalledWith({
      webClientId: 'web.apps.googleusercontent.com',
      iosClientId: 'ios-id',
      scopes: ['email', 'profile'],
    });
    // One account per verified email is Supabase's identity linking: the app only hands
    // over the token, and never creates or merges users itself.
    expect(mockSignInWithIdToken).toHaveBeenCalledWith({ provider: 'google', token: 'google.jwt' });
    expect(mockProfileUpdate).toHaveBeenCalledWith({ display_name: 'Alex' });
  });

  it('returns to sign-in quietly when the picker is dismissed', async () => {
    googleSignIn.mockResolvedValueOnce({ type: 'cancelled', data: null });
    await expect(signInWithGoogle()).resolves.toBe('cancelled');
    googleSignIn.mockRejectedValueOnce({ code: statusCodes.SIGN_IN_CANCELLED });
    await expect(signInWithGoogle()).resolves.toBe('cancelled');
    expect(mockSignInWithIdToken).not.toHaveBeenCalled();
  });

  it('shows a failure under the buttons', async () => {
    googleSignIn.mockRejectedValue(new Error('DEVELOPER_ERROR'));
    const onError = jest.fn();
    await render(<SocialSignIn disabled={false} onError={onError} />);
    await fireEvent.press(screen.getByTestId('sign-in-google'));
    expect(onError).toHaveBeenCalledTimes(1);
  });

  it('forgets the Google account on sign-out', async () => {
    await signOut();
    expect(GoogleSignin.signOut).toHaveBeenCalled();
    expect(mockAuthSignOut).toHaveBeenCalledWith({ scope: 'local' });
  });
});

describe('Google configuration', () => {
  const actual = jest.requireActual<typeof import('@/features/auth/provider-config')>(
    '@/features/auth/provider-config',
  );

  it('hides the button until the client IDs are set', () => {
    const none = { webClientId: null, iosClientId: null };
    const webOnly = { webClientId: 'web', iosClientId: null };
    const both = { webClientId: 'web', iosClientId: 'ios' };
    expect(actual.isGoogleConfigured('android', none)).toBe(false);
    expect(actual.isGoogleConfigured('android', webOnly)).toBe(true);
    expect(actual.isGoogleConfigured('ios', webOnly)).toBe(false);
    expect(actual.isGoogleConfigured('ios', both)).toBe(true);
    expect(isGoogleConfigured).toBeDefined();
  });

  it("adds the iOS URL scheme only when there's an iOS client ID", () => {
    expect(googleSignInPlugins(undefined)).toEqual([]);
    expect(googleSignInPlugins('123-abc.apps.googleusercontent.com')).toEqual([
      [
        '@react-native-google-signin/google-signin',
        { iosUrlScheme: 'com.googleusercontent.apps.123-abc' },
      ],
    ]);
  });
});
