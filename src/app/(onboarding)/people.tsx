import { PeopleScreen } from '@/features/onboarding/people-screen';
import { useDisplayName } from '@/features/onboarding/use-display-name';

export default function PeopleRoute() {
  const displayName = useDisplayName();
  // Wait for the name, so the user's own entry doesn't change under them.
  if (displayName === undefined) return null;
  return <PeopleScreen displayName={displayName} />;
}
