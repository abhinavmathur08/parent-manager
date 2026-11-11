import { getSupabase } from '@/lib/supabase';

/** Roles a member can hold (spec section 1.3). */
export const MEMBER_ROLES = ['parent', 'family', 'caregiver'] as const;
export type MemberRole = (typeof MEMBER_ROLES)[number];

/** The invite code's length and symbols: no 0, O, 1 or I (FR-HH-2). */
export const INVITE_CODE_LENGTH = 6;
const CODE_SYMBOLS = /^[2-9A-HJ-NP-Z]*$/;

/** What `create_invitation` returns. The code and token are shown once and never stored. */
export type CreatedInvitation = {
  id: string;
  role: MemberRole;
  code: string;
  token: string;
  expiresAt: string;
};

/** Why an invitation can or can't be accepted, from the server (FR-HH-7, NFR-SEC-8). */
export type InviteStatus =
  | 'ok'
  | 'invalid'
  | 'rate_limited'
  | 'revoked'
  | 'used'
  | 'expired'
  | 'premium_required'
  | 'already_member'
  | 'in_other_household'
  | 'seat_limit';

export type InvitePreview =
  | {
      status: 'ok' | 'in_other_household';
      householdName: string;
      inviterName: string | null;
      role: MemberRole;
    }
  | { status: Exclude<InviteStatus, 'ok' | 'in_other_household'> };

export type AcceptResult =
  { status: 'ok'; householdId: string; role: MemberRole } | { status: Exclude<InviteStatus, 'ok'> };

/** Why creating an invitation was refused, from the error's hint. */
export type CreateRefusal = 'seat_limit' | 'premium_required';

const KNOWN_STATUSES: readonly InviteStatus[] = [
  'ok',
  'invalid',
  'rate_limited',
  'revoked',
  'used',
  'expired',
  'premium_required',
  'already_member',
  'in_other_household',
  'seat_limit',
];

function toStatus(value: unknown): InviteStatus {
  return KNOWN_STATUSES.includes(value as InviteStatus) ? (value as InviteStatus) : 'invalid';
}

/** A code as the server compares it: uppercase, with spaces and dashes removed (FR-HH-4). */
export function normalizeInviteCode(input: string): string {
  return input.replace(/[\s-]/g, '').toUpperCase();
}

/** Whether a typed code could be an invite code, so the app doesn't spend an attempt on it. */
export function isInviteCodeShaped(input: string): boolean {
  const code = normalizeInviteCode(input);
  return code.length === INVITE_CODE_LENGTH && CODE_SYMBOLS.test(code);
}

export async function createInvitation(
  householdId: string,
  role: MemberRole,
): Promise<CreatedInvitation> {
  const { data, error } = await getSupabase().rpc('create_invitation', {
    household_id: householdId,
    role,
  });
  if (error) throw error;
  const row = data as {
    id: string;
    role: MemberRole;
    code: string;
    token: string;
    expires_at: string;
  };
  return {
    id: row.id,
    role: row.role,
    code: row.code,
    token: row.token,
    expiresAt: row.expires_at,
  };
}

/** The refusal behind a `createInvitation` error, or null for any other failure. */
export function createRefusal(error: unknown): CreateRefusal | null {
  const hint =
    typeof error === 'object' && error !== null ? (error as { hint?: unknown }).hint : null;
  if (hint === 'invite.seat_limit') return 'seat_limit';
  if (hint === 'invite.premium_required') return 'premium_required';
  return null;
}

export async function previewInvitation(code: string): Promise<InvitePreview> {
  const { data, error } = await getSupabase().rpc('preview_invitation', {
    code: normalizeInviteCode(code),
  });
  if (error) throw error;
  const row = data as {
    status: string;
    household_name?: string;
    inviter_name?: string | null;
    role?: MemberRole;
  };
  const status = toStatus(row.status);
  if ((status === 'ok' || status === 'in_other_household') && row.household_name && row.role) {
    return {
      status,
      householdName: row.household_name,
      inviterName: row.inviter_name ?? null,
      role: row.role,
    };
  }
  return { status: status === 'ok' || status === 'in_other_household' ? 'invalid' : status };
}

export async function acceptInvitation(code: string): Promise<AcceptResult> {
  const { data, error } = await getSupabase().rpc('accept_invitation', {
    code: normalizeInviteCode(code),
  });
  if (error) throw error;
  const row = data as { status: string; household_id?: string; role?: MemberRole };
  const status = toStatus(row.status);
  if (status === 'ok' && row.household_id && row.role) {
    return { status, householdId: row.household_id, role: row.role };
  }
  return { status: status === 'ok' ? 'invalid' : status };
}

export async function revokeInvitation(invitationId: string): Promise<void> {
  const { error } = await getSupabase().rpc('revoke_invitation', { invitation_id: invitationId });
  if (error) throw error;
}
