import { Redirect } from 'expo-router';

import { useAuth } from '@/features/auth/session';
import { useHousehold } from '@/features/household/membership';
import { readOnboardingStep } from '@/features/onboarding/draft';

/**
 * Where the app opens: sign-in when signed out, onboarding (resuming at the saved step,
 * FR-ONB-7) without a household, otherwise the Plan tab (architecture section 2).
 */
export default function Index() {
  const auth = useAuth();
  const { state } = useHousehold();
  if (auth.status === 'loading') return null;
  if (auth.status === 'signedOut') return <Redirect href="/sign-in" />;
  if (state.status === 'member') return <Redirect href="/plan" />;
  if (state.status === 'none') return <Redirect href={`/${readOnboardingStep()}`} />;
  return null;
}
