import {
  changeMemberRole,
  fetchMembers,
  isExpired,
  memberRefusal,
  removeMember,
} from '@/features/household/members';

const mockRpc = jest.fn();
const mockTables: Record<string, unknown[]> = {};

jest.mock('@/lib/supabase', () => ({
  getSupabase: () => ({
    rpc: mockRpc,
    from: (table: string) => {
      const chain: Record<string, unknown> = {};
      for (const method of ['select', 'eq', 'is', 'in', 'order']) chain[method] = () => chain;
      chain.then = (resolve: (value: unknown) => void) =>
        resolve({ data: mockTables[table], error: null });
      return chain;
    },
  }),
}));

beforeEach(() => mockRpc.mockReset().mockResolvedValue({ data: null, error: null }));

describe('members (FR-HH-10)', () => {
  it('lists parents first, then by join date, with display names', async () => {
    mockTables.household_members = [
      { user_id: 'c', role: 'caregiver', joined_at: '2026-11-03' },
      { user_id: 'p2', role: 'parent', joined_at: '2026-11-02' },
      { user_id: 'p1', role: 'parent', joined_at: '2026-11-01' },
    ];
    mockTables.profiles = [
      { id: 'p1', display_name: 'Sam' },
      { id: 'c', display_name: null },
    ];
    const members = await fetchMembers('h1');
    expect(members.map((m) => [m.userId, m.displayName])).toEqual([
      ['p1', 'Sam'],
      ['p2', null],
      ['c', null],
    ]);
  });

  it('calls the role and removal RPCs', async () => {
    await changeMemberRole('h1', 'u1', 'family');
    expect(mockRpc).toHaveBeenCalledWith('change_member_role', {
      household_id: 'h1',
      user_id: 'u1',
      role: 'family',
    });
    await removeMember('h1', 'u1');
    expect(mockRpc).toHaveBeenCalledWith('remove_member', { household_id: 'h1', user_id: 'u1' });
  });

  it('reads refusals from the hint', () => {
    expect(memberRefusal({ hint: 'member.last_parent' })).toBe('last_parent');
    expect(memberRefusal({ hint: 'member.seat_limit' })).toBe('seat_limit');
    expect(memberRefusal(new Error('offline'))).toBeNull();
  });

  it('marks invites at or past their expiry as expired', () => {
    const now = new Date('2026-11-10T12:00:00Z');
    expect(isExpired({ id: 'i', role: 'parent', expiresAt: '2026-11-10T12:00:00Z' }, now)).toBe(
      true,
    );
    expect(isExpired({ id: 'i', role: 'parent', expiresAt: '2026-11-17T12:00:00Z' }, now)).toBe(
      false,
    );
  });
});
