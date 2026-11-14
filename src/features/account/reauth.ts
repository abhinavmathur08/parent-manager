import { Platform } from 'react-native';

import type { SignInMethod } from '@/features/account/sign-in-method';
import { signInWithAppleNative } from '@/features/auth/apple';
import { normalizeEmail } from '@/features/auth/email';
import { verifyEmailCode } from '@/features/auth/email-sign-in';
import { signInWithGoogle } from '@/features/auth/google';
import { signInWithBrowser, type SocialSignInResult } from '@/features/auth/social';
import { getSupabase } from '@/lib/supabase';

/** Signing in again ended up in a different account, so nothing may be deleted. */
export class DifferentAccountError extends Error {
  constructor() {
    super('Signed in to a different account');
  }
}

/**
 * Emails a sign-in code to the account's own address, for re-authentication before a
 * deletion (FR-PRIV-3). Never creates an account.
 */
export async function requestReauthCode(email: string): Promise<void> {
  const { error } = await getSupabase().auth.signInWithOtp({
    email: normalizeEmail(email),
    options: { shouldCreateUser: false },
  });
  if (error) throw error;
}

/** Signs in again with Apple or Google, the way the account signs in. */
export async function reauthenticateWithProvider(
  method: Exclude<SignInMethod, 'email'>,
): Promise<SocialSignInResult> {
  if (method === 'google') return signInWithGoogle();
  return Platform.OS === 'ios' ? signInWithAppleNative() : signInWithBrowser('apple');
}

/** Checks the code from `requestReauthCode`. */
export async function reauthenticateWithCode(email: string, code: string): Promise<void> {
  await verifyEmailCode(email, code);
}

/**
 * Throws `DifferentAccountError` unless the session now belongs to `userId`. Apple and Google
 * let the user pick any account, and deleting must only ever touch the one that started.
 */
export async function assertSameAccount(userId: string): Promise<void> {
  const { data } = await getSupabase().auth.getSession();
  if (data.session?.user.id !== userId) throw new DifferentAccountError();
}
