import { fetchMembershipStatus, isLastParent, leaveHousehold } from '@/features/household/leave';

const mockRpc = jest.fn();
jest.mock('@/lib/supabase', () => ({ getSupabase: () => ({ rpc: mockRpc }) }));

describe('membership status and leaving (FR-HH-8, FR-HH-14)', () => {
  it('maps a paused membership', async () => {
    mockRpc.mockResolvedValue({
      data: {
        status: 'paused',
        household_id: 'h1',
        household_name: 'Home',
        role: 'caregiver',
        only_member: false,
      },
      error: null,
    });
    await expect(fetchMembershipStatus()).resolves.toEqual({
      status: 'paused',
      householdId: 'h1',
      householdName: 'Home',
      role: 'caregiver',
      onlyMember: false,
    });
  });

  it('treats anything unexpected as no household', async () => {
    mockRpc.mockResolvedValue({ data: { status: 'left' }, error: null });
    await expect(fetchMembershipStatus()).resolves.toEqual({ status: 'none' });
  });

  it('reports whether leaving deleted the household', async () => {
    mockRpc.mockResolvedValue({ data: { deleted: true }, error: null });
    await expect(leaveHousehold('h1')).resolves.toEqual({ deleted: true });
    expect(mockRpc).toHaveBeenCalledWith('leave_household', { household_id: 'h1' });
  });

  it('recognises the last-parent refusal', () => {
    expect(isLastParent({ hint: 'member.last_parent' })).toBe(true);
    expect(isLastParent(new Error('offline'))).toBe(false);
  });
});
