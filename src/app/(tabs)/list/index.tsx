import { ListScreen } from '@/features/grocery/list-screen';
import { useHousehold } from '@/features/household/membership';

export default function ListRoute() {
  const { state } = useHousehold();
  if (state.status !== 'member') return null;
  const { membership } = state;
  return (
    <ListScreen
      household={{
        id: membership.householdId,
        locale: membership.locale,
        unitSystem: membership.unitSystem,
        weekStart: membership.weekStart === 1 ? 1 : 7,
        timezone: membership.timezone ?? null,
        canRegenerate: membership.role !== 'caregiver',
      }}
    />
  );
}
