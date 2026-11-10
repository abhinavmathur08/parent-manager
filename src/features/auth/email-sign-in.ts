import * as Linking from 'expo-linking';

import { normalizeEmail } from '@/features/auth/email';
import type { AppLocale } from '@/i18n';
import { getSupabase } from '@/lib/supabase';

/** The route the magic link in the sign-in email opens (`src/app/auth-callback.tsx`). */
export const MAGIC_LINK_PATH = 'auth-callback';

/**
 * Emails a 6-digit code, plus a magic link, to the address (FR-AUTH-2). New addresses get an
 * account. The locale is saved in the new user's metadata, which picks the email's copy.
 * Throws the Supabase error, for `authErrorKey`.
 */
export async function requestEmailCode(email: string, locale: AppLocale): Promise<void> {
  const { error } = await getSupabase().auth.signInWithOtp({
    email: normalizeEmail(email),
    options: {
      shouldCreateUser: true,
      data: { locale },
      emailRedirectTo: Linking.createURL(MAGIC_LINK_PATH),
    },
  });
  if (error) throw error;
}

/** Checks the code. On success Supabase stores the session and the app moves on. */
export async function verifyEmailCode(email: string, code: string): Promise<void> {
  const { error } = await getSupabase().auth.verifyOtp({
    email: normalizeEmail(email),
    token: code,
    type: 'email',
  });
  if (error) throw error;
}

export type MagicLinkResult =
  | { kind: 'session'; accessToken: string; refreshToken: string }
  | { kind: 'error' }
  | { kind: 'none' };

/**
 * Reads the magic link redirect. Supabase puts the tokens, or an error, in the URL fragment
 * (implicit flow): `…/auth-callback#access_token=…&refresh_token=…`.
 */
export function parseMagicLink(url: string | null): MagicLinkResult {
  if (!url) return { kind: 'none' };
  const hash = url.indexOf('#');
  const query = url.indexOf('?');
  const raw = hash >= 0 ? url.slice(hash + 1) : query >= 0 ? url.slice(query + 1) : '';
  const params = new URLSearchParams(raw);
  if (params.get('error') || params.get('error_code')) return { kind: 'error' };
  const accessToken = params.get('access_token');
  const refreshToken = params.get('refresh_token');
  if (accessToken && refreshToken) return { kind: 'session', accessToken, refreshToken };
  return { kind: 'none' };
}

/** Signs in with the tokens from a magic link. */
export async function completeMagicLink(accessToken: string, refreshToken: string) {
  const { error } = await getSupabase().auth.setSession({
    access_token: accessToken,
    refresh_token: refreshToken,
  });
  if (error) throw error;
}
