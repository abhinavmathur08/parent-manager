import {
  acceptInvitation,
  createInvitation,
  createRefusal,
  isInviteCodeShaped,
  normalizeInviteCode,
  previewInvitation,
  revokeInvitation,
} from '@/features/household/invitations';

const mockRpc = jest.fn();
jest.mock('@/lib/supabase', () => ({ getSupabase: () => ({ rpc: mockRpc }) }));

beforeEach(() => mockRpc.mockReset());

describe('invite codes (FR-HH-2, FR-HH-4)', () => {
  it('accepts any case and ignores spaces and dashes', () => {
    expect(normalizeInviteCode(' ab3 - k7z ')).toBe('AB3K7Z');
    expect(isInviteCodeShaped('ab3 k7z')).toBe(true);
  });

  it('rejects codes of the wrong length or with confusable characters', () => {
    expect(isInviteCodeShaped('AB3K7')).toBe(false);
    expect(isInviteCodeShaped('AB3K7ZZ')).toBe(false);
    for (const code of ['AB0K7Z', 'ABOK7Z', 'AB1K7Z', 'ABIK7Z']) {
      expect(isInviteCodeShaped(code)).toBe(false);
    }
  });
});

describe('invitation RPCs (H-03.1)', () => {
  it('creates an invitation and maps the result', async () => {
    mockRpc.mockResolvedValue({
      data: { id: 'i1', role: 'parent', code: 'ABCDEF', token: 't', expires_at: '2026-11-17' },
      error: null,
    });
    await expect(createInvitation('h1', 'parent')).resolves.toEqual({
      id: 'i1',
      role: 'parent',
      code: 'ABCDEF',
      token: 't',
      expiresAt: '2026-11-17',
    });
    expect(mockRpc).toHaveBeenCalledWith('create_invitation', {
      household_id: 'h1',
      role: 'parent',
    });
  });

  it('reads why creating was refused from the hint', () => {
    expect(createRefusal({ hint: 'invite.seat_limit' })).toBe('seat_limit');
    expect(createRefusal({ hint: 'invite.premium_required' })).toBe('premium_required');
    expect(createRefusal(new Error('offline'))).toBeNull();
  });

  it('previews with the normalized code', async () => {
    mockRpc.mockResolvedValue({
      data: { status: 'ok', household_name: 'Home', inviter_name: 'Sam', role: 'parent' },
      error: null,
    });
    await expect(previewInvitation('ab cdef')).resolves.toEqual({
      status: 'ok',
      householdName: 'Home',
      inviterName: 'Sam',
      role: 'parent',
    });
    expect(mockRpc).toHaveBeenCalledWith('preview_invitation', { code: 'ABCDEF' });
  });

  it('passes failure statuses through and treats unknown ones as invalid', async () => {
    mockRpc.mockResolvedValueOnce({ data: { status: 'expired' }, error: null });
    await expect(previewInvitation('ABCDEF')).resolves.toEqual({ status: 'expired' });
    mockRpc.mockResolvedValueOnce({ data: { status: 'something_new' }, error: null });
    await expect(acceptInvitation('ABCDEF')).resolves.toEqual({ status: 'invalid' });
  });

  it('accepts and returns the household', async () => {
    mockRpc.mockResolvedValue({
      data: { status: 'ok', household_id: 'h1', role: 'parent' },
      error: null,
    });
    await expect(acceptInvitation('abcdef')).resolves.toEqual({
      status: 'ok',
      householdId: 'h1',
      role: 'parent',
    });
  });

  it('throws network and server errors', async () => {
    const error = { message: 'fetch failed' };
    mockRpc.mockResolvedValue({ data: null, error });
    await expect(acceptInvitation('ABCDEF')).rejects.toBe(error);
    await expect(revokeInvitation('i1')).rejects.toBe(error);
  });
});
