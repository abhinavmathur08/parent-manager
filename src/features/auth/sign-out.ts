import { clearAllDrafts } from '@/hooks/use-draft-state';
import { getSupabase } from '@/lib/supabase';

type Cleanup = () => Promise<void> | void;

const cleanups = new Set<Cleanup>();

/**
 * Registers work to do on sign-out (FR-AUTH-7). Modules that keep data on the device add
 * their own: the sync layer clears its encrypted copy of household data, and notifications
 * remove this device's push token. Returns a function that unregisters it.
 */
export function onSignOut(cleanup: Cleanup): () => void {
  cleanups.add(cleanup);
  return () => {
    cleanups.delete(cleanup);
  };
}

/**
 * Signs out this device (FR-AUTH-7). Every registered cleanup runs and drafts are removed,
 * then the local session is deleted, which the auth listener turns into the sign-in screen.
 * With `scope: 'local'`, Supabase deletes the session on the device before it asks the
 * server to revoke the refresh token, so signing out works offline; a failed revocation is
 * ignored because the token is gone from the device either way.
 */
export async function signOut(): Promise<void> {
  // One failing cleanup mustn't keep the user signed in or skip the others.
  await Promise.allSettled([...cleanups].map(async (cleanup) => cleanup()));
  await clearAllDrafts().catch(() => undefined);
  await getSupabase().auth.signOut({ scope: 'local' });
}
