import { useEffect, useState } from 'react';

import { onSignOut } from '@/features/auth/sign-out';
import { fetchPeople, type Person } from '@/features/people/data';

type Allergies = Pick<Person, 'displayName' | 'allergies'>[];

// The last list fetched this session, so detail screens opened offline after one online
// load still check allergies. Kept in memory only: allergies are health data, and this
// cache goes with the app process and is cleared on sign-out.
let cache: { householdId: string; people: Allergies } | null = null;

/**
 * The household's people and their allergy codes, for the allergen notice (FR-REC-9). It's
 * a safety feature and always free. `status` says whether the check could run.
 */
export function useHouseholdAllergies(householdId: string): {
  people: Allergies;
  status: 'loading' | 'ready' | 'unavailable';
} {
  const cached = cache?.householdId === householdId ? cache.people : null;
  const [state, setState] = useState<{
    people: Allergies;
    status: 'loading' | 'ready' | 'unavailable';
  }>(cached ? { people: cached, status: 'ready' } : { people: [], status: 'loading' });

  useEffect(() => {
    let active = true;
    fetchPeople(householdId).then(
      (people) => {
        const slim = people.map(({ displayName, allergies }) => ({ displayName, allergies }));
        cache = { householdId, people: slim };
        if (active) setState({ people: slim, status: 'ready' });
      },
      () => {
        if (active)
          setState((s) => (s.status === 'ready' ? s : { people: [], status: 'unavailable' }));
      },
    );
    return () => {
      active = false;
    };
  }, [householdId]);

  return state;
}

export function clearAllergyCache(): void {
  cache = null;
}

onSignOut(clearAllergyCache);
