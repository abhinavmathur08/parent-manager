import { router } from 'expo-router';

import { CalendarSettingsScreen } from '@/features/calendar/device/settings-screen';
import { useHousehold } from '@/features/household/membership';

/** S-39 from the Household tab. */
export default function CalendarSettingsRoute() {
  const { state } = useHousehold();
  if (state.status !== 'member') return null;
  return (
    <CalendarSettingsScreen
      householdId={state.membership.householdId}
      onBack={() => (router.canGoBack() ? router.back() : router.replace('/household'))}
    />
  );
}
