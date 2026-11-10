import { fireEvent, render, screen } from '@testing-library/react-native';
import * as AppleAuthentication from 'expo-apple-authentication';
import { Platform } from 'react-native';

import { AppleButton } from '@/features/auth/apple-button';
import { signInWithAppleNative } from '@/features/auth/apple';
import { SocialSignIn } from '@/features/auth/social-sign-in';

const mockSignInWithIdToken = jest.fn();
const mockProfileUpdate = jest.fn();

jest.mock('@/lib/supabase', () => ({
  getSupabase: () => ({
    auth: { signInWithIdToken: mockSignInWithIdToken },
    from: () => ({
      update: (values: unknown) => {
        mockProfileUpdate(values);
        const chain = { eq: () => chain, is: async () => ({ error: null }) };
        return chain;
      },
    }),
  }),
}));
jest.mock('expo-crypto', () => ({
  CryptoDigestAlgorithm: { SHA256: 'SHA-256' },
  randomUUID: () => 'raw-nonce',
  digestStringAsync: async (_algorithm: string, value: string) => `sha256(${value})`,
}));
jest.mock('expo-apple-authentication', () => {
  const { View } = jest.requireActual('react-native');
  return {
    isAvailableAsync: jest.fn(async () => true),
    signInAsync: jest.fn(),
    AppleAuthenticationScope: { FULL_NAME: 0, EMAIL: 1 },
    AppleAuthenticationButtonType: { CONTINUE: 1 },
    AppleAuthenticationButtonStyle: { WHITE: 0, BLACK: 2 },
    AppleAuthenticationButton: (props: { onPress: () => void }) => (
      <View testID="native-apple-button" onTouchEnd={props.onPress} />
    ),
  };
});
jest.mock('expo-linking', () => ({ createURL: (path: string) => `parentmanager://${path}` }));
jest.mock('expo-web-browser', () => ({ openAuthSessionAsync: jest.fn() }));

const signInAsync = AppleAuthentication.signInAsync as jest.Mock;

beforeEach(() => {
  jest.clearAllMocks();
  Platform.OS = 'ios';
  mockSignInWithIdToken.mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null });
});

describe('Sign in with Apple (FR-AUTH-1, FR-AUTH-4)', () => {
  it('sends Apple the hashed nonce and Supabase the raw one, then saves the name', async () => {
    signInAsync.mockResolvedValue({
      identityToken: 'apple.jwt',
      fullName: { givenName: 'Sam', familyName: 'Lee' },
    });
    await expect(signInWithAppleNative()).resolves.toBe('signedIn');
    expect(signInAsync).toHaveBeenCalledWith({
      requestedScopes: [0, 1],
      nonce: 'sha256(raw-nonce)',
    });
    expect(mockSignInWithIdToken).toHaveBeenCalledWith({
      provider: 'apple',
      token: 'apple.jwt',
      nonce: 'raw-nonce',
    });
    expect(mockProfileUpdate).toHaveBeenCalledWith({ display_name: 'Sam' });
  });

  it('treats a cancel as no error and no sign-in', async () => {
    signInAsync.mockRejectedValue(
      Object.assign(new Error('canceled'), { code: 'ERR_REQUEST_CANCELED' }),
    );
    await expect(signInWithAppleNative()).resolves.toBe('cancelled');
    expect(mockSignInWithIdToken).not.toHaveBeenCalled();
  });

  it('skips the name when Apple sends none (later sign-ins)', async () => {
    signInAsync.mockResolvedValue({ identityToken: 'apple.jwt', fullName: null });
    await signInWithAppleNative();
    expect(mockProfileUpdate).not.toHaveBeenCalled();
  });

  it('reports a failure, but not a cancel, to the sign-in screen', async () => {
    const onError = jest.fn();
    signInAsync.mockRejectedValueOnce(
      Object.assign(new Error('canceled'), { code: 'ERR_REQUEST_CANCELED' }),
    );
    await render(<AppleButton onError={onError} />);
    await fireEvent(screen.getByTestId('native-apple-button'), 'touchEnd');
    expect(onError).not.toHaveBeenCalled();

    signInAsync.mockRejectedValueOnce(new Error('ERR_REQUEST_FAILED'));
    await fireEvent(screen.getByTestId('native-apple-button'), 'touchEnd');
    expect(onError).toHaveBeenCalledTimes(1);
  });

  it('is shown on iOS, and hidden on Android until web sign-in is configured', async () => {
    const view = await render(<SocialSignIn disabled={false} onError={jest.fn()} />);
    expect(await screen.findByTestId('sign-in-apple')).toBeOnTheScreen();
    await view.unmount();

    Platform.OS = 'android';
    await render(<SocialSignIn disabled={false} onError={jest.fn()} />);
    expect(screen.queryByTestId('sign-in-apple')).toBeNull();
  });
});
