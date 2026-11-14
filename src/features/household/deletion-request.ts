import { getSupabase } from '@/lib/supabase';

/** A parent's open request to delete the household (FR-PRIV-7). */
export type DeletionRequest = { requestedBy: string; expiresAt: string };

/** The household's open request, or null. Every member can read it; a lapsed one is ignored. */
export async function fetchDeletionRequest(
  householdId: string,
  now: Date = new Date(),
): Promise<DeletionRequest | null> {
  const { data, error } = await getSupabase()
    .from('household_deletion_requests')
    .select('requested_by, expires_at')
    .eq('household_id', householdId)
    .maybeSingle<{ requested_by: string; expires_at: string }>();
  if (error) throw error;
  if (!data || new Date(data.expires_at).getTime() <= now.getTime()) return null;
  return { requestedBy: data.requested_by, expiresAt: data.expires_at };
}

/**
 * Deletes the household at once when the caller is its only parent, or asks the other
 * parent to confirm within 7 days. Needs a sign-in in the last 10 minutes.
 */
export async function requestHouseholdDeletion(
  householdId: string,
): Promise<'deleted' | 'requested'> {
  const { data, error } = await getSupabase().rpc('request_household_deletion', {
    household_id: householdId,
  });
  if (error) throw error;
  return (data as { status?: string })?.status === 'deleted' ? 'deleted' : 'requested';
}

/** The other parent confirms, which deletes the household. Needs a recent sign-in. */
export async function confirmHouseholdDeletion(householdId: string): Promise<void> {
  const { error } = await getSupabase().rpc('confirm_household_deletion', {
    household_id: householdId,
  });
  if (error) throw error;
}

/** Either parent withdraws or declines the request. */
export async function cancelHouseholdDeletion(householdId: string): Promise<void> {
  const { error } = await getSupabase().rpc('cancel_household_deletion', {
    household_id: householdId,
  });
  if (error) throw error;
}
