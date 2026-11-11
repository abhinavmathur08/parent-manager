import { ALLERGEN_CODES, type AllergenCode } from '@/features/ingredients/catalog-ids';

/**
 * Language-neutral IDs for household people (architecture section 3.3, NFR-L10N-5). The
 * database checks the same lists (supabase/migrations/*_onboarding_people.sql). Display names
 * come from the locale files: people.ageBands.<band> and people.diets.<key>.
 */

/** Children's age bands, youngest first (decision D-6: pregnancy to age 5, then older). */
export const CHILD_AGE_BANDS = [
  'expecting',
  'infant_0_6m',
  'infant_6_12m',
  'toddler',
  'preschool',
  'older_child',
] as const;

export type ChildAgeBand = (typeof CHILD_AGE_BANDS)[number];
export type AgeBand = ChildAgeBand | 'adult';

export const AGE_BANDS: readonly AgeBand[] = [...CHILD_AGE_BANDS, 'adult'];

export function isAgeBand(value: unknown): value is AgeBand {
  return typeof value === 'string' && (AGE_BANDS as readonly string[]).includes(value);
}

/** Diets offered for each person (FR-HH-12). */
export const DIET_CODES = [
  'diet.vegetarian',
  'diet.vegan',
  'diet.pescatarian',
  'diet.halal',
  'diet.kosher',
] as const;

export type DietCode = (typeof DIET_CODES)[number];

/**
 * Allergies offered in Phase 1: the US major allergens (FR-HH-12). The rest of the UK and EU
 * 14 are in the data for later, and are still shown if a person already has one.
 */
export const OFFERED_ALLERGEN_CODES = ALLERGEN_CODES.slice(0, 9) as readonly AllergenCode[];

export const isAllergenCode = (value: string): value is AllergenCode =>
  (ALLERGEN_CODES as readonly string[]).includes(value);
export const isDietCode = (value: string): value is DietCode =>
  (DIET_CODES as readonly string[]).includes(value);

/** Translation keys. */
export const ageBandKey = (band: AgeBand) => `people.ageBands.${band}`;
export const dietKey = (code: DietCode) => `people.diets.${code.slice(5)}`;

/** Allergies and diets aren't recorded for someone not yet born (NFR-SEC-4). */
export const hasDietary = (band: AgeBand) => band !== 'expecting';

/** A due month, 'YYYY-MM'. Never a full date (FR-ONB-4, D-6). */
export type DueMonth = `${number}-${number}`;

const DUE_MONTH = /^(\d{4})-(0[1-9]|1[0-2])$/;

export function isDueMonth(value: unknown): value is DueMonth {
  return typeof value === 'string' && DUE_MONTH.test(value);
}

/** The due months offered: this month and the next nine, covering a whole pregnancy. */
export function dueMonthOptions(today: Date, count = 10): DueMonth[] {
  const year = today.getFullYear();
  const month = today.getMonth();
  return Array.from({ length: count }, (_, i) => {
    const d = new Date(year, month + i, 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}` as DueMonth;
  });
}

/** A date in the middle of the due month, for formatting its name only. */
export function dueMonthDate(month: DueMonth): Date {
  const [, y, m] = DUE_MONTH.exec(month) ?? [];
  return new Date(Date.UTC(Number(y), Number(m) - 1, 15, 12));
}
