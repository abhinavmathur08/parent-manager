import type { MemberRole } from '@/features/household/invitations';
import { getSupabase } from '@/lib/supabase';

export type Member = {
  userId: string;
  role: MemberRole;
  joinedAt: string;
  displayName: string | null;
};

export type PendingInvite = { id: string; role: MemberRole; expiresAt: string };

/** Why a role change or removal was refused, from the error's hint. */
export type MemberRefusal = 'seat_limit' | 'premium_required' | 'last_parent' | 'not_found';

const ROLE_ORDER: Record<MemberRole, number> = { parent: 0, family: 1, caregiver: 2 };

/** Active members, parents first, then by when they joined (FR-HH-10). */
export async function fetchMembers(householdId: string): Promise<Member[]> {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from('household_members')
    .select('user_id, role, joined_at')
    .eq('household_id', householdId)
    .eq('status', 'active')
    .is('deleted_at', null);
  if (error) throw error;
  const rows = (data ?? []) as { user_id: string; role: MemberRole; joined_at: string }[];
  // household_members points at auth.users, so profiles are a second read. RLS returns only
  // profiles of people who share the caller's household.
  const profiles = rows.length
    ? await supabase
        .from('profiles')
        .select('id, display_name')
        .in(
          'id',
          rows.map((row) => row.user_id),
        )
    : { data: [], error: null };
  if (profiles.error) throw profiles.error;
  const names = new Map(
    ((profiles.data ?? []) as { id: string; display_name: string | null }[]).map((p) => [
      p.id,
      p.display_name,
    ]),
  );
  return rows
    .map((row) => ({
      userId: row.user_id,
      role: row.role,
      joinedAt: row.joined_at,
      displayName: names.get(row.user_id) ?? null,
    }))
    .sort(
      (a, b) => ROLE_ORDER[a.role] - ROLE_ORDER[b.role] || a.joinedAt.localeCompare(b.joinedAt),
    );
}

/** Invitations not yet accepted or revoked, including expired ones so the inviter sees them. */
export async function fetchPendingInvites(householdId: string): Promise<PendingInvite[]> {
  const { data, error } = await getSupabase()
    .from('invitations')
    .select('id, role, expires_at')
    .eq('household_id', householdId)
    .is('accepted_at', null)
    .is('revoked_at', null)
    .is('deleted_at', null)
    .order('expires_at', { ascending: true });
  if (error) throw error;
  return ((data ?? []) as { id: string; role: MemberRole; expires_at: string }[]).map((row) => ({
    id: row.id,
    role: row.role,
    expiresAt: row.expires_at,
  }));
}

export function isExpired(invite: PendingInvite, now: Date = new Date()): boolean {
  return new Date(invite.expiresAt).getTime() <= now.getTime();
}

export async function changeMemberRole(
  householdId: string,
  userId: string,
  role: MemberRole,
): Promise<void> {
  const { error } = await getSupabase().rpc('change_member_role', {
    household_id: householdId,
    user_id: userId,
    role,
  });
  if (error) throw error;
}

export async function removeMember(householdId: string, userId: string): Promise<void> {
  const { error } = await getSupabase().rpc('remove_member', {
    household_id: householdId,
    user_id: userId,
  });
  if (error) throw error;
}

/** The refusal behind a role change or removal error, or null for any other failure. */
export function memberRefusal(error: unknown): MemberRefusal | null {
  const hint =
    typeof error === 'object' && error !== null ? (error as { hint?: unknown }).hint : null;
  switch (hint) {
    case 'member.seat_limit':
      return 'seat_limit';
    case 'member.premium_required':
      return 'premium_required';
    case 'member.last_parent':
      return 'last_parent';
    case 'member.not_found':
      return 'not_found';
    default:
      return null;
  }
}
