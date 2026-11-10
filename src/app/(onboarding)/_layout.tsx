import { Stack } from 'expo-router';

import { OnboardingDraftProvider } from '@/features/onboarding/draft';

/** S-05 onwards, shown only to a signed-in user with no household (see the root layout). */
export default function OnboardingLayout() {
  return (
    <OnboardingDraftProvider>
      <Stack screenOptions={{ headerShown: false }} />
    </OnboardingDraftProvider>
  );
}
