import { ALLERGEN_CODES } from '@/features/ingredients/catalog-ids';
import {
  defaultPeople,
  newPerson,
  onboardingPayload,
  withAgeBand,
} from '@/features/onboarding/people';
import {
  dueMonthDate,
  dueMonthOptions,
  isDueMonth,
  OFFERED_ALLERGEN_CODES,
} from '@/features/people/codes';
import { i18n } from '@/i18n';

describe('due months (FR-ONB-4, D-6)', () => {
  it('offers this month and the next nine, crossing the year', () => {
    const months = dueMonthOptions(new Date(2026, 10, 30));
    expect(months).toHaveLength(10);
    expect(months[0]).toBe('2026-11');
    expect(months[2]).toBe('2027-01');
    expect(months[9]).toBe('2027-08');
  });

  it('accepts a month and never a full date', () => {
    expect(isDueMonth('2027-03')).toBe(true);
    expect(isDueMonth('2027-03-15')).toBe(false);
    expect(isDueMonth('2027-13')).toBe(false);
    expect(dueMonthDate('2027-03').getUTCMonth()).toBe(2);
  });
});

describe('allergen codes (FR-HH-12)', () => {
  it('offers the 9 US major allergens from the catalog list', () => {
    expect(OFFERED_ALLERGEN_CODES).toEqual(ALLERGEN_CODES.slice(0, 9));
    expect(OFFERED_ALLERGEN_CODES).toContain('allergen.sesame');
  });
});

describe('onboarding payload', () => {
  const t = i18n.t.bind(i18n);

  it('drops codes and the due month where they do not apply', () => {
    const baby = {
      ...withAgeBand(newPerson('expecting'), 'expecting'),
      dueMonth: '2027-02' as const,
    };
    const toddler = { ...newPerson('toddler'), allergies: ['allergen.egg' as const] };
    const changed = withAgeBand(
      { ...newPerson('toddler'), allergies: ['allergen.milk' as const] },
      'expecting',
    );
    expect(changed.allergies).toEqual([]);
    const payload = onboardingPayload([...defaultPeople(), baby, toddler], null, t, true);
    expect(payload.map((p) => p.display_name)).toEqual(['You', 'Baby', 'Child 1']);
    expect(payload[1]).toMatchObject({ due_month: '2027-02', allergies: [] });
    expect(payload[2]).toMatchObject({ due_month: null, allergies: ['allergen.egg'] });
    expect(onboardingPayload([toddler], null, t, false)[0].allergies).toEqual([]);
  });
});
