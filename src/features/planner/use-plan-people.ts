import { useEffect, useState } from 'react';

import { onSignOut } from '@/features/auth/sign-out';
import { fetchPeople } from '@/features/people/data';

import type { PlanPerson } from './plan';

type State = { people: PlanPerson[]; status: 'loading' | 'ready' | 'unavailable' };

// The last list fetched this session, so the plan opened offline after one online load
// still has portions and allergen markers. Memory only: allergies are health data, and this
// goes with the app process and is cleared on sign-out. People aren't synced yet.
let cache: { householdId: string; people: PlanPerson[] } | null = null;

/**
 * The household's people, for default portions (R-SERV-1) and allergen markers
 * (FR-PLAN-11). `status` says whether they could be loaded.
 */
export function usePlanPeople(householdId: string): State {
  const cached = cache?.householdId === householdId ? cache.people : null;
  const [state, setState] = useState<State>(
    cached ? { people: cached, status: 'ready' } : { people: [], status: 'loading' },
  );

  useEffect(() => {
    let active = true;
    fetchPeople(householdId).then(
      (people) => {
        const slim = people.map(({ id, displayName, ageBand, allergies }) => ({
          id,
          displayName,
          ageBand,
          allergies,
        }));
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

export function clearPlanPeopleCache(): void {
  cache = null;
}

onSignOut(clearPlanPeopleCache);
