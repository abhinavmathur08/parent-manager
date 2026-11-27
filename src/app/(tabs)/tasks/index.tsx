import { useAuth } from '@/features/auth/session';
import { useHousehold } from '@/features/household/membership';
import { TasksScreen } from '@/features/tasks/tasks-screen';

export default function TasksRoute() {
  const { state } = useHousehold();
  const auth = useAuth();
  if (state.status !== 'member') return null;
  const { membership } = state;
  return (
    <TasksScreen
      household={{
        id: membership.householdId,
        locale: membership.locale,
        timezone: membership.timezone ?? null,
      }}
      userId={auth.status === 'signedIn' ? auth.session.user.id : null}
    />
  );
}
