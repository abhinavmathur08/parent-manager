import { useHousehold } from '@/features/household/membership';
import { PlanWeekScreen } from '@/features/planner/week-screen';

export default function PlanRoute() {
  const { state } = useHousehold();
  if (state.status !== 'member') return null;
  const { membership } = state;
  return (
    <PlanWeekScreen
      household={{
        id: membership.householdId,
        locale: membership.locale,
        weekStart: membership.weekStart === 1 ? 1 : 7,
        timezone: membership.timezone ?? null,
      }}
      canWrite={membership.role !== 'caregiver'}
    />
  );
}
