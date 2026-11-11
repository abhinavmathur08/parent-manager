import { CreateHouseholdScreen } from '@/features/onboarding/create-household-screen';
import { useDisplayName } from '@/features/onboarding/use-display-name';

export default function CreateHouseholdRoute() {
  const displayName = useDisplayName();
  // Wait for the name, so the household name's default doesn't change under the user.
  if (displayName === undefined) return null;
  return <CreateHouseholdScreen displayName={displayName} />;
}
