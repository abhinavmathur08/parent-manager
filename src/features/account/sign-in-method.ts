import type { User } from '@supabase/supabase-js';

export type SignInMethod = 'email' | 'apple' | 'google';

/** How the account signs in, for the Account screen (S-31). Unknown providers read as email. */
export function signInMethod(user: Pick<User, 'app_metadata'>): SignInMethod {
  const provider = user.app_metadata?.provider;
  return provider === 'apple' || provider === 'google' ? provider : 'email';
}
