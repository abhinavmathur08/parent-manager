import * as AppleAuthentication from 'expo-apple-authentication';
import { CryptoDigestAlgorithm, digestStringAsync, randomUUID } from 'expo-crypto';

import { saveProviderName, type SocialSignInResult } from '@/features/auth/social';
import { getSupabase } from '@/lib/supabase';

/**
 * Sign in with Apple on iOS, natively, through `signInWithIdToken` (FR-AUTH-1). Apple gets
 * the SHA-256 of a one-time nonce and Supabase the nonce itself, so a token can't be replayed.
 * A verified Apple email that matches an existing account signs into that account, because
 * Supabase links identities with the same verified email (FR-AUTH-3).
 */
export async function signInWithAppleNative(): Promise<SocialSignInResult> {
  const nonce = randomUUID();
  const hashedNonce = await digestStringAsync(CryptoDigestAlgorithm.SHA256, nonce);
  let credential: AppleAuthentication.AppleAuthenticationCredential;
  try {
    credential = await AppleAuthentication.signInAsync({
      requestedScopes: [
        AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
        AppleAuthentication.AppleAuthenticationScope.EMAIL,
      ],
      nonce: hashedNonce,
    });
  } catch (error) {
    if (isAppleCancel(error)) return 'cancelled';
    throw error;
  }
  if (!credential.identityToken) throw new Error('Apple returned no identity token');
  const { data, error } = await getSupabase().auth.signInWithIdToken({
    provider: 'apple',
    token: credential.identityToken,
    nonce,
  });
  if (error) throw error;
  // Apple sends the name only on the first sign-in, and never in the token.
  const name = credential.fullName?.givenName ?? credential.fullName?.nickname;
  if (data.user) await saveProviderName(data.user.id, name).catch(() => undefined);
  return 'signedIn';
}

export function isAppleCancel(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { code?: string }).code === 'ERR_REQUEST_CANCELED'
  );
}
