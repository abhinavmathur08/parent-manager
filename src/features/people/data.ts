import type { AllergenCode } from '@/features/ingredients/catalog-ids';
import {
  isAgeBand,
  isAllergenCode,
  isDietCode,
  isDueMonth,
  type AgeBand,
  type DietCode,
  type DueMonth,
} from '@/features/people/codes';
import { getSupabase } from '@/lib/supabase';

/** Someone the household feeds (FR-HH-11), with their live codes (FR-HH-12). */
export type Person = {
  id: string;
  displayName: string;
  ageBand: AgeBand;
  dueMonth: DueMonth | null;
  allergies: AllergenCode[];
  diets: DietCode[];
};

export type PersonInput = { displayName: string; ageBand: AgeBand; dueMonth: DueMonth | null };

type PersonRow = {
  id: string;
  display_name: string;
  age_band: string;
  due_month: string | null;
  created_at: string;
  person_dietary: { type: string; code: string; deleted_at: string | null }[];
};

/** Adults first, then children youngest first, each in the order they were added. */
const BAND_ORDER: Record<AgeBand, number> = {
  adult: 0,
  expecting: 1,
  infant_0_6m: 2,
  infant_6_12m: 3,
  toddler: 4,
  preschool: 5,
  older_child: 6,
};

export function toPerson(row: PersonRow): Person | null {
  if (!isAgeBand(row.age_band)) return null;
  const live = row.person_dietary.filter((d) => d.deleted_at === null);
  return {
    id: row.id,
    displayName: row.display_name,
    ageBand: row.age_band,
    dueMonth: isDueMonth(row.due_month) ? row.due_month : null,
    allergies: live
      .filter((d) => d.type === 'allergy')
      .map((d) => d.code)
      .filter(isAllergenCode),
    diets: live
      .filter((d) => d.type === 'diet')
      .map((d) => d.code)
      .filter(isDietCode),
  };
}

export function sortPeople(people: Person[]): Person[] {
  return [...people].sort((a, b) => BAND_ORDER[a.ageBand] - BAND_ORDER[b.ageBand]);
}

/** The household's people. RLS limits this to the caller's household (NFR-SEC-2). */
export async function fetchPeople(householdId: string): Promise<Person[]> {
  const { data, error } = await getSupabase()
    .from('household_people')
    .select(
      'id, display_name, age_band, due_month, created_at, person_dietary(type, code, deleted_at)',
    )
    .eq('household_id', householdId)
    .is('deleted_at', null)
    .order('created_at')
    .returns<PersonRow[]>();
  if (error) throw error;
  return sortPeople((data ?? []).map(toPerson).filter((p): p is Person => p !== null));
}

/** Whether the caller can edit people: parents and family members (spec 2.2, rows 13 and 14). */
export async function fetchCanEdit(householdId: string, userId: string): Promise<boolean> {
  const { data, error } = await getSupabase()
    .from('household_members')
    .select('role')
    .eq('household_id', householdId)
    .eq('user_id', userId)
    .maybeSingle<{ role: string }>();
  if (error) throw error;
  return data?.role === 'parent' || data?.role === 'family';
}

function columns(input: PersonInput) {
  const adult = input.ageBand === 'adult';
  return {
    display_name: input.displayName.trim(),
    kind: adult ? 'adult' : 'child',
    age_band: input.ageBand,
    // The due month only, and only for expecting (FR-ONB-4, D-6).
    due_month: input.ageBand === 'expecting' ? input.dueMonth : null,
  };
}

/** Adds a person and returns their ID. */
export async function addPerson(householdId: string, input: PersonInput): Promise<string> {
  const { data, error } = await getSupabase()
    .from('household_people')
    .insert({ household_id: householdId, ...columns(input) })
    .select('id')
    .single<{ id: string }>();
  if (error) throw error;
  return data.id;
}

export async function updatePerson(id: string, input: PersonInput): Promise<void> {
  const { error } = await getSupabase()
    .from('household_people')
    .update(columns(input))
    .eq('id', id);
  if (error) throw error;
  // Nobody not yet born has codes (NFR-SEC-4).
  if (input.ageBand === 'expecting') {
    const { error: codesError } = await getSupabase()
      .from('person_dietary')
      .update({ deleted_at: new Date().toISOString() })
      .eq('person_id', id)
      .is('deleted_at', null);
    if (codesError) throw codesError;
  }
}

/** A soft delete, so it syncs. The database removes the person's codes with them. */
export async function removePerson(id: string): Promise<void> {
  const { error } = await getSupabase()
    .from('household_people')
    .update({ deleted_at: new Date().toISOString() })
    .eq('id', id);
  if (error) throw error;
}

export type DietaryChange = {
  householdId: string;
  personId: string;
  type: 'allergy' | 'diet';
  code: AllergenCode | DietCode;
  on: boolean;
};

type Codes = { allergies: readonly AllergenCode[]; diets: readonly DietCode[] };

/**
 * Only the codes the user actually turned on or off. Codes they didn't touch, including any
 * the other parent added meanwhile, are left alone (backlog H-05).
 */
export function dietaryChanges(
  householdId: string,
  personId: string,
  before: Codes,
  after: Codes,
): DietaryChange[] {
  const diff = <C extends AllergenCode | DietCode>(
    type: 'allergy' | 'diet',
    was: readonly C[],
    now: readonly C[],
  ): DietaryChange[] => [
    ...now
      .filter((c) => !was.includes(c))
      .map((code) => ({ householdId, personId, type, code, on: true })),
    ...was
      .filter((c) => !now.includes(c))
      .map((code) => ({ householdId, personId, type, code, on: false })),
  ];
  return [
    ...diff('allergy', before.allergies, after.allergies),
    ...diff('diet', before.diets, after.diets),
  ];
}

const UNIQUE_VIOLATION = '23505';

/**
 * Adds or removes one code. Each code is its own row and only that row is touched, so two
 * parents editing the same person at once keep both changes (spec section 3.3).
 */
export async function setDietary({ householdId, personId, type, code, on }: DietaryChange) {
  const table = getSupabase().from('person_dietary');
  if (on) {
    const { error } = await table.insert({
      household_id: householdId,
      person_id: personId,
      type,
      code,
    });
    // Already added, perhaps by the other parent: that's the state we wanted.
    if (error && error.code !== UNIQUE_VIOLATION) throw error;
    return;
  }
  const { error } = await table
    .update({ deleted_at: new Date().toISOString() })
    .eq('person_id', personId)
    .eq('type', type)
    .eq('code', code)
    .is('deleted_at', null);
  if (error) throw error;
}
