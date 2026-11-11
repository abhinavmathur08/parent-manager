import * as Linking from 'expo-linking';
import * as WebBrowser from 'expo-web-browser';

import { completeMagicLink, MAGIC_LINK_PATH, parseMagicLink } from '@/features/auth/email-sign-in';
import { getSupabase } from '@/lib/supabase';

/** What a sign-in attempt ended with. A cancel is not an error (spec: no error message). */
export type SocialSignInResult = 'signedIn' | 'cancelled';

/**
 * Saves a name from Apple or Google as the display name, only if the profile has none yet
 * (FR-AUTH-4). Best effort: onboarding asks for a name if this didn't happen.
 */
export async function saveProviderName(userId: string, name: string | null | undefined) {
  const trimmed = name?.trim();
  if (!trimmed) return;
  await getSupabase()
    .from('profiles')
    .update({ display_name: trimmed.slice(0, 100) })
    .eq('id', userId)
    .is('display_name', null);
}

/**
 * Signs in through the provider's web page in an in-app browser session (Supabase OAuth),
 * for where there's no native SDK: Sign in with Apple on Android. Supabase redirects back to
 * the app's `auth-callback` link with the session in the URL fragment.
 */
export async function signInWithBrowser(provider: 'apple' | 'google'): Promise<SocialSignInResult> {
  const redirectTo = Linking.createURL(MAGIC_LINK_PATH);
  const { data, error } = await getSupabase().auth.signInWithOAuth({
    provider,
    options: { redirectTo, skipBrowserRedirect: true },
  });
  if (error) throw error;
  const result = await WebBrowser.openAuthSessionAsync(data.url, redirectTo);
  if (result.type !== 'success') return 'cancelled';
  const parsed = parseMagicLink(result.url);
  if (parsed.kind !== 'session') throw new Error('Sign-in did not return a session');
  await completeMagicLink(parsed.accessToken, parsed.refreshToken);
  return 'signedIn';
}
