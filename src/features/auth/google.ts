import {
  GoogleSignin,
  isErrorWithCode,
  isSuccessResponse,
  statusCodes,
} from '@react-native-google-signin/google-signin';

import { googleConfig } from '@/features/auth/provider-config';
import { onSignOut } from '@/features/auth/sign-out';
import { saveProviderName, type SocialSignInResult } from '@/features/auth/social';
import { getSupabase } from '@/lib/supabase';

let configured = false;

function configure() {
  if (configured) return;
  GoogleSignin.configure({
    webClientId: googleConfig.webClientId ?? undefined,
    iosClientId: googleConfig.iosClientId ?? undefined,
    scopes: ['email', 'profile'],
  });
  configured = true;
}

/**
 * Native Google sign-in (FR-AUTH-1): Google's account picker returns an ID token, which
 * Supabase verifies with `signInWithIdToken`. A Google account whose verified email already
 * has an account signs into that account: Supabase links identities with the same verified
 * email, so there's never a duplicate (FR-AUTH-3).
 */
export async function signInWithGoogle(): Promise<SocialSignInResult> {
  configure();
  let idToken: string | null;
  let givenName: string | null;
  try {
    await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true });
    const response = await GoogleSignin.signIn();
    if (!isSuccessResponse(response)) return 'cancelled';
    idToken = response.data.idToken;
    givenName = response.data.user.givenName;
  } catch (error) {
    if (isGoogleCancel(error)) return 'cancelled';
    throw error;
  }
  if (!idToken) throw new Error('Google returned no ID token');
  const { data, error } = await getSupabase().auth.signInWithIdToken({
    provider: 'google',
    token: idToken,
  });
  if (error) throw error;
  if (data.user) await saveProviderName(data.user.id, givenName).catch(() => undefined);
  return 'signedIn';
}

/** A dismissed picker, or a second tap while one is open, isn't an error. */
export function isGoogleCancel(error: unknown): boolean {
  return (
    isErrorWithCode(error) &&
    (error.code === statusCodes.SIGN_IN_CANCELLED || error.code === statusCodes.IN_PROGRESS)
  );
}

// Signing out of the app also forgets the Google account on this device, so the next
// sign-in shows the account picker (FR-AUTH-7). The root layout imports this module.
onSignOut(async () => {
  if (!googleConfig.webClientId) return;
  configure();
  await GoogleSignin.signOut();
});
