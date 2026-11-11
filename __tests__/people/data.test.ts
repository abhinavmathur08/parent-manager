import { dietaryChanges, setDietary, sortPeople, toPerson } from '@/features/people/data';

const mockInsert = jest.fn();
const mockUpdateChain = { eq: jest.fn(), is: jest.fn() };
const mockUpdate = jest.fn(() => mockUpdateChain);
jest.mock('@/lib/supabase', () => ({
  getSupabase: () => ({ from: () => ({ insert: mockInsert, update: mockUpdate }) }),
}));

beforeEach(() => {
  jest.clearAllMocks();
  mockUpdateChain.eq.mockReturnValue(mockUpdateChain);
  mockUpdateChain.is.mockResolvedValue({ error: null });
});

describe('dietary changes (H-05: simultaneous edits keep both codes)', () => {
  it('touches only the codes the user turned on or off', () => {
    const changes = dietaryChanges(
      'h1',
      'p1',
      { allergies: ['allergen.milk', 'allergen.egg'], diets: ['diet.vegan'] },
      { allergies: ['allergen.egg', 'allergen.peanut'], diets: ['diet.vegan'] },
    );
    expect(changes).toEqual([
      { householdId: 'h1', personId: 'p1', type: 'allergy', code: 'allergen.peanut', on: true },
      { householdId: 'h1', personId: 'p1', type: 'allergy', code: 'allergen.milk', on: false },
    ]);
  });

  it('treats a code the other parent already added as done', async () => {
    mockInsert.mockResolvedValue({ error: { code: '23505', message: 'duplicate' } });
    await expect(
      setDietary({
        householdId: 'h1',
        personId: 'p1',
        type: 'allergy',
        code: 'allergen.soy',
        on: true,
      }),
    ).resolves.toBeUndefined();
    mockInsert.mockResolvedValue({ error: { code: '42501', message: 'denied' } });
    await expect(
      setDietary({
        householdId: 'h1',
        personId: 'p1',
        type: 'allergy',
        code: 'allergen.soy',
        on: true,
      }),
    ).rejects.toMatchObject({ code: '42501' });
  });

  it('removes one code by soft-deleting just its live row', async () => {
    await setDietary({
      householdId: 'h1',
      personId: 'p1',
      type: 'diet',
      code: 'diet.halal',
      on: false,
    });
    expect(mockUpdate).toHaveBeenCalledWith({ deleted_at: expect.any(String) });
    expect(mockUpdateChain.eq.mock.calls).toEqual([
      ['person_id', 'p1'],
      ['type', 'diet'],
      ['code', 'diet.halal'],
    ]);
    expect(mockUpdateChain.is).toHaveBeenCalledWith('deleted_at', null);
  });
});

describe('reading people', () => {
  it('keeps live, known codes only, and sorts adults then youngest first', () => {
    const row = (
      id: string,
      age_band: string,
      dietary: { type: string; code: string; deleted_at: string | null }[] = [],
    ) => ({
      id,
      display_name: id,
      age_band,
      due_month: age_band === 'expecting' ? '2027-02' : null,
      created_at: '2026-11-10T00:00:00Z',
      person_dietary: dietary,
    });
    const kid = toPerson(
      row('kid', 'toddler', [
        { type: 'allergy', code: 'allergen.peanut', deleted_at: null },
        { type: 'allergy', code: 'allergen.milk', deleted_at: '2026-11-10T00:00:00Z' },
        { type: 'allergy', code: 'allergen.unknown', deleted_at: null },
        { type: 'diet', code: 'diet.vegan', deleted_at: null },
      ]),
    );
    expect(kid).toMatchObject({ allergies: ['allergen.peanut'], diets: ['diet.vegan'] });
    expect(toPerson(row('x', 'teenager'))).toBeNull();
    const sorted = sortPeople(
      [row('kid', 'older_child'), row('baby', 'expecting'), row('mum', 'adult')].map((r) =>
        toPerson(r)!,
      ),
    );
    expect(sorted.map((p) => p.id)).toEqual(['mum', 'baby', 'kid']);
    expect(sorted[1].dueMonth).toBe('2027-02');
  });
});
