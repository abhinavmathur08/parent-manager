import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { Button } from '@/components/button';
import { EmptyState } from '@/components/empty-state';
import { ListRow } from '@/components/list-row';
import { Screen } from '@/components/screen';
import { Text } from '@/components/text';
import { Toast } from '@/components/toast';
import { wallInstant } from '@/features/calendar/editor';
import { useCalendarMembers } from '@/features/calendar/use-members';
import { todayIn } from '@/features/planner/week';
import { useTheme } from '@/hooks/use-theme';
import { formatDate, formatList, formatTime } from '@/i18n/format';

import { AssignSheet } from './assign-sheet';
import { useTaskRows } from './data';
import { dueLabel, taskTitle } from './labels';
import { isChore } from './tables';
import { REMINDER_MINUTES } from './task-editor-sheet';
import { requestTaskDelete } from './task-events';
import { dueDate } from './view';
import { useTaskWrites } from './writes';

export type TaskDetailScreenProps = {
  taskId: string;
  household: { id: string; locale: string; timeZone: string };
  userId: string | null;
  isParent: boolean;
  isPremium: boolean;
  onBack: () => void;
};

/**
 * S-46 task detail (FR3-TASK-7): the title, due, assignee, reminder, notes, repeat and rotation,
 * its source, and who created, last changed and completed it. Complete, assign and delete are
 * here too (FR3-TASK-4, FR3-TASK-5, FR3-TASK-8). Read from the local copy, so it opens offline.
 */
export function TaskDetailScreen({
  taskId,
  household,
  userId,
  isParent,
  isPremium,
  onBack,
}: TaskDetailScreenProps) {
  const { t } = useTranslation();
  const theme = useTheme();
  const { locale, timeZone } = household;
  const { tasks, loading } = useTaskRows();
  const members = useCalendarMembers(household.id);
  const writes = useTaskWrites(userId);
  const [assigning, setAssigning] = useState(false);
  const [error, setError] = useState(false);
  const failed = () => setError(true);
  const task = tasks.find((row) => row.id === taskId);

  if (!task) {
    return (
      <Screen title={t('tasks.detail.title')} onBack={onBack} testID="task-missing">
        {loading ? null : (
          <EmptyState
            icon="tasks"
            message={t('tasks.detail.missing')}
            testID="task-missing-state"
          />
        )}
      </Screen>
    );
  }

  const today = todayIn(timeZone);
  const date = dueDate(task, timeZone);
  const nameOf = (id: string | null): string => {
    // A cleared ID is a member who deleted their account (FR3-PRIV-2).
    if (!id) return t('tasks.detail.formerMember');
    if (id === userId) return t('tasks.detail.you');
    return members.find((m) => m.userId === id)?.displayName ?? t('tasks.assignee.member');
  };
  const when = (instant: string | null) =>
    instant
      ? t('tasks.due.dateTime', {
          date: formatDate(new Date(instant), locale, { month: 'short', day: 'numeric', timeZone }),
          time: formatTime(new Date(instant), locale, timeZone),
        })
      : '';
  const canEdit = isParent || task.created_by === userId;
  const assignable = members.filter(
    (m) => m.userId !== userId && (m.role === 'parent' || (isParent && isPremium)),
  );
  const mayAssign =
    !task.done &&
    (canEdit || task.assignee_user_id === userId) &&
    !(task.shared && !task.assignee_user_id && !isParent);

  const reminder = task.reminder
    ? t(`tasks.editor.reminders.${task.reminder.slice('reminder.'.length)}`, {
        time: formatTime(
          wallInstant(date ?? today, REMINDER_MINUTES[task.reminder] ?? 0, timeZone),
          locale,
          timeZone,
        ),
      })
    : t('tasks.editor.reminders.none');
  const rotation = task.rotation_user_ids?.length
    ? formatList(task.rotation_user_ids.map(nameOf), locale)
    : null;

  const remove = () => {
    onBack();
    // The list holds it behind its undo bar; if it isn't mounted, write it now.
    if (!requestTaskDelete(task.id)) void writes.remove(task).catch(failed);
  };

  return (
    <View style={{ flex: 1 }}>
      <Screen title={taskTitle(task, t)} onBack={onBack} hasTabBar testID="task-detail">
        <View style={{ gap: theme.space[1] }}>
          <ListRow
            title={t('tasks.editor.due')}
            variant="value"
            value={
              dueLabel(task, date, { today, locale, timeZone, t }) ?? t('tasks.groups.anytime')
            }
            testID="task-detail-due"
          />
          <ListRow
            title={t('tasks.editor.assignee')}
            variant="value"
            accessibilityHint={mayAssign ? t('tasks.detail.assignHint') : undefined}
            value={task.assignee_user_id ? nameOf(task.assignee_user_id) : t('tasks.editor.anyone')}
            onPress={mayAssign ? () => setAssigning(true) : undefined}
            testID="task-detail-assignee"
          />
          <ListRow
            title={t('tasks.editor.reminder')}
            variant="value"
            value={reminder}
            testID="task-detail-reminder"
          />
          {isChore(task) ? (
            <ListRow
              title={t('tasks.detail.repeat')}
              variant="value"
              value={
                rotation
                  ? t('tasks.detail.rotation', { members: rotation })
                  : t('tasks.row.repeats')
              }
              testID="task-detail-repeat"
            />
          ) : null}
          {task.source_kind ? (
            <ListRow
              title={t('tasks.detail.source')}
              variant="value"
              value={t(`tasks.detail.sources.${task.source_kind.slice('source.'.length)}`)}
              testID="task-detail-source"
            />
          ) : null}
        </View>

        {task.notes ? (
          <View style={{ gap: theme.space[1] }}>
            <Text variant="label" accessibilityRole="header">
              {t('tasks.editor.notes')}
            </Text>
            <Text testID="task-detail-notes">{task.notes}</Text>
          </View>
        ) : null}

        <View style={{ gap: theme.space[1] }} testID="task-detail-history">
          <Text color="textSecondary">
            {t('tasks.detail.created', {
              name: nameOf(task.created_by),
              when: when(task.created_at),
            })}
          </Text>
          {task.updated_by && task.updated_at !== task.created_at ? (
            <Text color="textSecondary">
              {t('tasks.detail.changed', {
                name: nameOf(task.updated_by),
                when: when(task.updated_at),
              })}
            </Text>
          ) : null}
          {task.done ? (
            <Text color="textSecondary" testID="task-detail-completed">
              {t('tasks.detail.completed', {
                name: nameOf(task.done_by),
                when: when(task.done_at),
              })}
            </Text>
          ) : null}
        </View>

        <View style={{ gap: theme.space[2] }}>
          <Button
            label={t(task.done ? 'tasks.actions.reopen' : 'tasks.actions.complete')}
            icon={task.done ? undefined : 'check'}
            onPress={() =>
              void (
                task.done
                  ? writes.reopen(task)
                  : writes.complete(task, date !== null && date < today)
              ).catch(failed)
            }
            fullWidth
            testID="task-detail-toggle"
          />
          {canEdit ? (
            <Button
              variant="secondary"
              label={t('tasks.actions.delete')}
              onPress={remove}
              fullWidth
              testID="task-detail-delete"
            />
          ) : null}
        </View>
      </Screen>
      <AssignSheet
        visible={assigning}
        current={task.assignee_user_id}
        userId={userId}
        assignable={assignable}
        onPick={(id, role) => {
          void writes.assign(task, id, role, 'detail').catch(failed);
          setAssigning(false);
        }}
        onClose={() => setAssigning(false)}
      />
      <Toast
        visible={error}
        message={t('tasks.failed')}
        onDismiss={() => setError(false)}
        testID="task-detail-failed"
      />
    </View>
  );
}
