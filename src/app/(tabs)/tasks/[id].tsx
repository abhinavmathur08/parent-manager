import { router, useLocalSearchParams } from 'expo-router';

import { useAuth } from '@/features/auth/session';
import { householdTimeZone } from '@/features/calendar/agenda';
import { useHousehold } from '@/features/household/membership';
import { useEntitlement } from '@/features/subscription/entitlement';
import { TaskDetailScreen } from '@/features/tasks/task-detail-screen';

/** S-46 task detail, opened from a row on S-44. */
export default function TaskDetailRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { state } = useHousehold();
  const auth = useAuth();
  const { isPremium } = useEntitlement();
  if (state.status !== 'member') return null;
  const { membership } = state;
  return (
    <TaskDetailScreen
      taskId={id}
      household={{
        id: membership.householdId,
        locale: membership.locale,
        timeZone: householdTimeZone(membership.timezone),
      }}
      userId={auth.status === 'signedIn' ? auth.session.user.id : null}
      isParent={membership.role === 'parent'}
      isPremium={isPremium}
      onBack={() => (router.canGoBack() ? router.back() : router.replace('/tasks'))}
    />
  );
}
