import { useAuth } from '@/features/auth/session';
import { ListScreen } from '@/features/grocery/list-screen';
import { useHousehold } from '@/features/household/membership';

export default function ListRoute() {
  const { state } = useHousehold();
  const auth = useAuth();
  if (state.status !== 'member') return null;
  const { membership } = state;
  return (
    <ListScreen
      household={{
        id: membership.householdId,
        locale: membership.locale,
        region: membership.region,
        unitSystem: membership.unitSystem,
        weekStart: membership.weekStart === 1 ? 1 : 7,
        timezone: membership.timezone ?? null,
        canRegenerate: membership.role !== 'caregiver',
        userId: auth.status === 'signedIn' ? auth.session.user.id : null,
      }}
    />
  );
}
