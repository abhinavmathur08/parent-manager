import { useLocalSearchParams } from 'expo-router';

import { useHousehold } from '@/features/household/membership';
import { ReviewScreen } from '@/features/import/review-screen';

/** S-21: `/plan/recipes/import/review?job=<id>` reviews an import's draft before it's saved. */
export default function ImportReviewRoute() {
  const { job } = useLocalSearchParams<{ job?: string }>();
  const { state } = useHousehold();
  if (!job || state.status !== 'member' || state.membership.role === 'caregiver') return null;
  const { householdId, locale, region, unitSystem } = state.membership;
  return (
    <ReviewScreen key={job} job={job} household={{ id: householdId, locale, region, unitSystem }} />
  );
}
