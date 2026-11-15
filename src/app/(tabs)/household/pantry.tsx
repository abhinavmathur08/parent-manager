import { useHousehold } from '@/features/household/membership';
import { PantryScreen } from '@/features/pantry/pantry-screen';

export default function PantryRoute() {
  const { state } = useHousehold();
  if (state.status !== 'member') return null;
  const { membership } = state;
  return (
    <PantryScreen
      household={{
        id: membership.householdId,
        locale: membership.locale,
        weekStart: membership.weekStart === 1 ? 1 : 7,
        timezone: membership.timezone ?? null,
        canEditStaples: membership.role !== 'caregiver',
      }}
    />
  );
}
