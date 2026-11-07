import 'react-native-url-polyfill/auto';

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import 'expo-sqlite/localStorage/install';

import { supabaseConfig } from '@/lib/supabase-config';

let client: SupabaseClient | undefined;

/**
 * Returns the shared Supabase client, creating it on first use so that the app
 * can still start when the backend isn't configured yet.
 */
export function getSupabase(): SupabaseClient {
  if (!supabaseConfig) {
    throw new Error(
      'Supabase is not configured. Copy .env.example to .env.local and set EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY.',
    );
  }
  client ??= createClient(supabaseConfig.url, supabaseConfig.publishableKey, {
    auth: {
      storage: localStorage,
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: false,
    },
  });
  return client;
}
