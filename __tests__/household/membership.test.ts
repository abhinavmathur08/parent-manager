import { fetchMembership } from '@/features/household/membership';

let mockRow: unknown = null;
jest.mock('@/lib/supabase', () => ({
  getSupabase: () => {
    const chain: Record<string, unknown> = {};
    for (const method of ['from', 'select', 'eq', 'is', 'limit']) chain[method] = () => chain;
    chain.maybeSingle = async () => ({ data: mockRow, error: null });
    return chain;
  },
}));
jest.mock('@/features/auth/session', () => ({ useAuth: () => ({ status: 'signedOut' }) }));

describe('fetchMembership', () => {
  it('includes the caller role, for parent-only actions', async () => {
    mockRow = {
      household_id: 'h1',
      role: 'family',
      households: {
        region: 'GB',
        locale: 'en-GB',
        unit_system: 'metric',
        week_start: 1,
        timezone: 'Europe/London',
      },
    };
    await expect(fetchMembership('u1')).resolves.toEqual({
      householdId: 'h1',
      role: 'family',
      region: 'GB',
      locale: 'en-GB',
      unitSystem: 'metric',
      weekStart: 1,
      timezone: 'Europe/London',
    });
  });

  it('treats an unknown role as the least privileged', async () => {
    mockRow = { household_id: 'h1', role: 'owner', households: { region: 'US', locale: 'en-US' } };
    await expect(fetchMembership('u1')).resolves.toMatchObject({ role: 'caregiver' });
  });
});
