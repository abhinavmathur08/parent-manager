import { AllergiesScreen } from '@/features/onboarding/allergies-screen';
import { useDisplayName } from '@/features/onboarding/use-display-name';

export default function AllergiesRoute() {
  const displayName = useDisplayName();
  if (displayName === undefined) return null;
  return <AllergiesScreen displayName={displayName} />;
}
