import type { Session } from '@supabase/supabase-js';
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';

import { DEFAULT_LOCALE, i18n, SUPPORTED_LOCALES } from '@/i18n';
import { getSupabase } from '@/lib/supabase';
import { supabaseConfig } from '@/lib/supabase-config';

export type AuthState =
  { status: 'loading' } | { status: 'signedOut' } | { status: 'signedIn'; session: Session };

const AuthContext = createContext<AuthState>({ status: 'loading' });

/**
 * Sets the profile's locale from the device the first time an account signs in (FR-AUTH-4).
 * The profile row itself is created by the database when the account is.
 */
async function ensureProfileLocale(userId: string) {
  // i18n starts in the device's locale (src/i18n/instance.ts).
  const locale = (SUPPORTED_LOCALES as readonly string[]).includes(i18n.language)
    ? i18n.language
    : DEFAULT_LOCALE;
  await getSupabase().from('profiles').update({ locale }).eq('id', userId).is('locale', null);
}

/**
 * Follows the Supabase session (FR-AUTH-5): restored from encrypted storage at launch,
 * refreshed automatically, and cleared on sign-out or when the refresh token is revoked.
 * Without a backend configured, the app stays signed out.
 */
export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>(() =>
    supabaseConfig ? { status: 'loading' } : { status: 'signedOut' },
  );

  useEffect(() => {
    if (!supabaseConfig) return;
    const supabase = getSupabase();
    const { data } = supabase.auth.onAuthStateChange((event, session) => {
      setState(session ? { status: 'signedIn', session } : { status: 'signedOut' });
      if (event === 'SIGNED_IN' && session) {
        // Not awaited inside the listener: Supabase warns that awaiting there can deadlock.
        setTimeout(() => {
          ensureProfileLocale(session.user.id).catch(() => undefined);
        }, 0);
      }
    });
    return () => data.subscription.unsubscribe();
  }, []);

  return <AuthContext.Provider value={state}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  return useContext(AuthContext);
}
