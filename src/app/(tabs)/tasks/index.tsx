import { useTranslation } from 'react-i18next';

import { EmptyState } from '@/components/empty-state';
import { Screen } from '@/components/screen';

/** S-44 Tasks (FR3-TASK-1), in the Recipes tab's former slot (D-29). T-02.1 part 2 fills it in. */
export default function TasksRoute() {
  const { t } = useTranslation();
  return (
    <Screen title={t('tasks.title')} testID="tasks-screen">
      <EmptyState icon="tasks" message={t('tasks.empty')} testID="tasks-empty" />
    </Screen>
  );
}
