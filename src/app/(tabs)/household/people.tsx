import { useHousehold } from '@/features/household/membership';
import { PeopleProfilesScreen } from '@/features/people/people-screen';

export default function PeopleRoute() {
  const { state } = useHousehold();
  if (state.status !== 'member') return null;
  return (
    <PeopleProfilesScreen
      householdId={state.membership.householdId}
      locale={state.membership.locale}
    />
  );
}
