import type { MemberRole } from '@/features/household/invitations';
import { getSupabase } from '@/lib/supabase';

/** The caller's membership as the server sees it, including what RLS hides from them. */
export type MembershipStatus =
  | { status: 'none' }
  | {
      status: 'member' | 'paused' | 'removed';
      householdId: string;
      householdName: string;
      role: MemberRole;
      /** Leaving would delete the household (FR-HH-8). */
      onlyMember: boolean;
    };

export async function fetchMembershipStatus(): Promise<MembershipStatus> {
  const { data, error } = await getSupabase().rpc('membership_status');
  if (error) throw error;
  const row = data as {
    status: string;
    household_id?: string;
    household_name?: string;
    role?: MemberRole;
    only_member?: boolean;
  };
  if (
    (row.status === 'member' || row.status === 'paused' || row.status === 'removed') &&
    row.household_id &&
    row.role
  ) {
    return {
      status: row.status,
      householdId: row.household_id,
      householdName: row.household_name ?? '',
      role: row.role,
      onlyMember: row.only_member === true,
    };
  }
  return { status: 'none' };
}

/** Leaves the household; resolves to whether that deleted it (the caller was its only member). */
export async function leaveHousehold(householdId: string): Promise<{ deleted: boolean }> {
  const { data, error } = await getSupabase().rpc('leave_household', { household_id: householdId });
  if (error) throw error;
  return { deleted: (data as { deleted?: boolean } | null)?.deleted === true };
}

/** Whether leaving was refused because the caller is the last parent (FR-HH-14). */
export function isLastParent(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { hint?: unknown }).hint === 'member.last_parent'
  );
}
