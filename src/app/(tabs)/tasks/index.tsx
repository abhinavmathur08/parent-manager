import { useTranslation } from 'react-i18next';

import { useAuth } from '@/features/auth/session';
import { householdTimeZone } from '@/features/calendar/agenda';
import { useHousehold, type Membership } from '@/features/household/membership';
import { AddTaskButton } from '@/features/tasks/add-task-button';
import { TasksScreen } from '@/features/tasks/tasks-screen';
import { useTaskEditor } from '@/features/tasks/use-task-editor';

export default function TasksRoute() {
  const { state } = useHousehold();
  if (state.status !== 'member') return null;
  return <Tasks membership={state.membership} />;
}

function Tasks({ membership }: { membership: Membership }) {
  const { t } = useTranslation();
  const auth = useAuth();
  const userId = auth.status === 'signedIn' ? auth.session.user.id : null;
  const editor = useTaskEditor({
    householdId: membership.householdId,
    locale: membership.locale,
    timeZone: householdTimeZone(membership.timezone),
    userId,
    isParent: membership.role === 'parent',
  });
  return (
    <>
      <TasksScreen
        household={{
          id: membership.householdId,
          locale: membership.locale,
          timezone: membership.timezone ?? null,
        }}
        userId={userId}
        footer={<AddTaskButton label={t('tasks.add')} onPress={editor.open} />}
      />
      {editor.sheet}
    </>
  );
}
