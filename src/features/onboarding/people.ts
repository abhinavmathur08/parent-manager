import type { TFunction } from 'i18next';

import type { AllergenCode } from '@/features/ingredients/catalog-ids';
import {
  hasDietary,
  isAgeBand,
  type AgeBand,
  type ChildAgeBand,
  type DietCode,
  type DueMonth,
} from '@/features/people/codes';

export const MAX_PERSON_NAME = 100;
/** The server accepts at most 20 people from onboarding. */
export const MAX_ONBOARDING_PEOPLE = 20;

/**
 * Someone the household feeds, as entered during onboarding. Only what the spec asks for:
 * a display name, an age band, the due month for expecting, and fixed codes (NFR-SEC-4).
 */
export type DraftPerson = {
  /** A local key for lists and test IDs. Never sent to the server. */
  key: string;
  /** Empty means "use the default name" (the user's own name, "Baby", and so on). */
  name: string;
  ageBand: AgeBand;
  dueMonth: DueMonth | null;
  /** The signed-in user, linked to their account. */
  isSelf: boolean;
  allergies: AllergenCode[];
  diets: DietCode[];
};

let counter = 0;
export function newKey(): string {
  counter += 1;
  return `p${Date.now().toString(36)}${counter}`;
}

export function newPerson(ageBand: AgeBand, isSelf = false): DraftPerson {
  return { key: newKey(), name: '', ageBand, dueMonth: null, isSelf, allergies: [], diets: [] };
}

/** Step 3's starting answer: just the user (FR-ONB-2). */
export function defaultPeople(): DraftPerson[] {
  return [{ ...newPerson('adult', true), key: 'self' }];
}

/** Keeps a draft read back from storage usable, dropping anything malformed. */
export function sanitizePeople(value: unknown): DraftPerson[] | null {
  if (!Array.isArray(value)) return null;
  return value.filter(
    (p): p is DraftPerson =>
      typeof p === 'object' &&
      p !== null &&
      typeof p.key === 'string' &&
      typeof p.name === 'string' &&
      isAgeBand(p.ageBand) &&
      Array.isArray(p.allergies) &&
      Array.isArray(p.diets),
  );
}

export const isChild = (p: DraftPerson) => p.ageBand !== 'adult';

/** Changes a person's age band, dropping what no longer applies to it. */
export function withAgeBand(person: DraftPerson, ageBand: ChildAgeBand): DraftPerson {
  const expecting = ageBand === 'expecting';
  return {
    ...person,
    ageBand,
    dueMonth: expecting ? person.dueMonth : null,
    allergies: expecting ? [] : person.allergies,
    diets: expecting ? [] : person.diets,
  };
}

export function toggle<T>(list: readonly T[], item: T): T[] {
  return list.includes(item) ? list.filter((x) => x !== item) : [...list, item];
}

/**
 * The name shown and saved when a person's name is left empty. For the user, their own
 * name; for others, a numbered placeholder ("Adult 2", "Child 1", "Baby").
 */
export function defaultName(
  people: readonly DraftPerson[],
  person: DraftPerson,
  selfName: string | null,
  t: TFunction,
): string {
  if (person.isSelf) return selfName ?? t('onboarding.people.you');
  if (person.ageBand === 'expecting') return t('onboarding.people.babyName');
  const same = people.filter(
    (p) => !p.isSelf && p.ageBand !== 'expecting' && isChild(p) === isChild(person),
  );
  const n = same.findIndex((p) => p.key === person.key) + 1 + (isChild(person) ? 0 : 1);
  return isChild(person)
    ? t('onboarding.people.childName', { n })
    : t('onboarding.people.adultName', { n });
}

export type OnboardingPersonPayload = {
  display_name: string;
  age_band: AgeBand;
  due_month: DueMonth | null;
  is_self: boolean;
  allergies: AllergenCode[];
  diets: DietCode[];
};

/**
 * What `complete_onboarding` receives. `includeDietary` is false when the user skipped
 * step 4, so no allergies or diets are saved.
 */
export function onboardingPayload(
  people: readonly DraftPerson[],
  selfName: string | null,
  t: TFunction,
  includeDietary: boolean,
): OnboardingPersonPayload[] {
  return people.slice(0, MAX_ONBOARDING_PEOPLE).map((p) => {
    const dietary = includeDietary && hasDietary(p.ageBand);
    return {
      display_name: (p.name.trim() || defaultName(people, p, selfName, t)).slice(
        0,
        MAX_PERSON_NAME,
      ),
      age_band: p.ageBand,
      due_month: p.ageBand === 'expecting' ? p.dueMonth : null,
      is_self: p.isSelf,
      allergies: dietary ? [...new Set(p.allergies)] : [],
      diets: dietary ? [...new Set(p.diets)] : [],
    };
  });
}
