import { getSupabase } from '@/lib/supabase';

/** What deleting the account does (FR-PRIV-3), from `account_deletion_preview()`. */
export type DeletionOutcome = 'delete_household' | 'leave' | 'last_parent' | 'no_household';

export type DeletionPreview = {
  outcome: DeletionOutcome;
  householdId: string | null;
  householdName: string | null;
};

const OUTCOMES: readonly DeletionOutcome[] = [
  'delete_household',
  'leave',
  'last_parent',
  'no_household',
];

export async function fetchDeletionPreview(): Promise<DeletionPreview> {
  const { data, error } = await getSupabase().rpc('account_deletion_preview');
  if (error) throw error;
  const row = (data ?? {}) as { outcome?: string; household_id?: string; household_name?: string };
  if (!OUTCOMES.includes(row.outcome as DeletionOutcome)) {
    throw new Error('Unknown deletion outcome');
  }
  return {
    outcome: row.outcome as DeletionOutcome,
    householdId: row.household_id ?? null,
    householdName: row.household_name ?? null,
  };
}

/** Deletes the signed-in account on the server. Needs a sign-in in the last 10 minutes. */
export async function deleteAccount(): Promise<{ householdDeleted: boolean }> {
  const { data, error } = await getSupabase().rpc('delete_account');
  if (error) throw error;
  return {
    householdDeleted: Boolean((data as { household_deleted?: boolean })?.household_deleted),
  };
}

function hint(error: unknown): string | undefined {
  return typeof error === 'object' && error !== null
    ? ((error as { hint?: string }).hint ?? undefined)
    : undefined;
}

/** The server wants a fresh sign-in first. */
export function needsReauthentication(error: unknown): boolean {
  return hint(error) === 'account.reauthentication_required';
}

/** The last parent must promote someone or delete the household first (FR-HH-14). */
export function isLastParentRefusal(error: unknown): boolean {
  return hint(error) === 'member.last_parent';
}
