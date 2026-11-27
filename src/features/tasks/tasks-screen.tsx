import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { AppState, StyleSheet, View } from 'react-native';

import { Banner } from '@/components/banner';
import { Chip } from '@/components/chip';
import { EmptyState } from '@/components/empty-state';
import { Icon } from '@/components/icon';
import { ListRow } from '@/components/list-row';
import { Screen } from '@/components/screen';
import { SectionHeader } from '@/components/section-header';
import type { TopBarProps } from '@/components/top-bar';
import { householdTimeZone } from '@/features/calendar/agenda';
import { useCalendarMembers } from '@/features/calendar/use-members';
import type { Member } from '@/features/household/members';
import { todayIn } from '@/features/planner/week';
import { useOnline } from '@/hooks/use-online';
import { useTheme } from '@/hooks/use-theme';
import { track } from '@/lib/analytics';

import { useTaskRows } from './data';
import { dayLabel, dueLabel, taskTitle } from './labels';
import { useTaskLimits } from './limits';
import { buildTaskView, type TaskFilter, type TaskItem } from './view';

export type TasksScreenProps = {
  household: { id: string; locale: string; timezone: string | null };
  userId: string | null;
  /** Trailing header actions. */
  headerActions?: TopBarProps['actions'];
  /** The bottom-reachable add action (T-02.2), drawn after the list. */
  footer?: ReactNode;
};

/** Now, read again each minute and when the app comes back, so Today and Overdue move on. */
function useNow(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 60_000);
    const appState = AppState.addEventListener('change', (state) => {
      if (state === 'active') setNow(Date.now());
    });
    return () => {
      clearInterval(timer);
      appState.remove();
    };
  }, []);
  return now;
}

/**
 * S-44 Tasks (FR3-TASK-1): the household's tasks from the local copy, so it opens offline and
 * fast (FR3-TASK-6, NFR3-PERF-1), grouped as Overdue, Today, Upcoming (by day), Later, Anytime and
 * a collapsed Done, filtered to Mine, Everyone or one member. Due dates are in the household's
 * timezone with relative words (NFR3-L10N-1).
 */
export function TasksScreen({ household, userId, headerActions, footer }: TasksScreenProps) {
  const { t } = useTranslation();
  const theme = useTheme();
  const online = useOnline();
  const { locale } = household;
  const timeZone = householdTimeZone(household.timezone);
  const now = useNow();
  const today = todayIn(timeZone, new Date(now));
  const { tasks, loading } = useTaskRows();
  const { upcomingDays } = useTaskLimits();
  const members = useCalendarMembers(household.id);
  const [filter, setFilter] = useState<TaskFilter>({ kind: 'everyone' });
  const [showDone, setShowDone] = useState(false);

  // The React Compiler memoizes this.
  const view = buildTaskView(tasks, { filter, userId, timeZone, now: new Date(now), upcomingDays });

  useFocusEffect(
    useCallback(() => {
      track('tasks_viewed', { filter: filter.kind });
    }, [filter.kind]),
  );

  const others = members.filter((member) => member.userId !== userId);
  const nameOf = (id: string | null): string | null => {
    if (!id) return null;
    const member = members.find((m: Member) => m.userId === id);
    return member?.displayName ?? t('tasks.assignee.member');
  };

  const row = (item: TaskItem, testID: string, showDay: boolean) => {
    const due = showDay ? dueLabel(item.task, item.date, { today, locale, timeZone, t }) : null;
    const time =
      !showDay && item.task.due_at
        ? dueLabel(item.task, item.date, { today, locale, timeZone, t })
        : null;
    const assigneeId = item.task.assignee_user_id;
    const parts = [
      due ?? time,
      assigneeId === userId
        ? t('tasks.row.assigneeYou')
        : assigneeId
          ? t('tasks.row.assignee', { name: nameOf(assigneeId) })
          : null,
      item.task.done ? t('tasks.row.done') : null,
    ].filter((part): part is string => part !== null);
    return (
      <ListRow
        key={item.task.id}
        title={taskTitle(item.task, t)}
        subtitle={parts.length ? parts.join(t('tasks.row.separator')) : undefined}
        leading={
          <Icon
            name={item.task.done ? 'checkCircle' : 'circle'}
            color={item.task.done ? 'success' : 'textSecondary'}
          />
        }
        divider
        testID={testID}
      />
    );
  };

  const filters: { key: string; label: string; value: TaskFilter }[] = [
    { key: 'mine', label: t('tasks.filters.mine'), value: { kind: 'mine' } },
    { key: 'everyone', label: t('tasks.filters.everyone'), value: { kind: 'everyone' } },
    ...others.map((member) => ({
      key: `member-${member.userId}`,
      label: member.displayName ?? t('tasks.assignee.member'),
      value: { kind: 'member' as const, userId: member.userId },
    })),
  ];
  const isSelected = (value: TaskFilter) =>
    value.kind === filter.kind &&
    (value.kind !== 'member' || (filter.kind === 'member' && filter.userId === value.userId));

  const open =
    view.overdue.length +
    view.today.length +
    view.upcoming.length +
    view.later.length +
    view.anytime.length;

  return (
    <Screen
      title={t('tasks.title')}
      actions={headerActions}
      banner={
        !online ? (
          <Banner variant="offline" message={t('tasks.offline')} testID="tasks-offline" />
        ) : null
      }
      testID="tasks-screen"
    >
      <View
        accessibilityLabel={t('tasks.filters.label')}
        style={[styles.wrap, { gap: theme.space[2] }]}
      >
        {filters.map((item, i) => (
          <Chip
            key={item.key}
            label={item.label}
            selected={isSelected(item.value)}
            onPress={() => setFilter(item.value)}
            testID={
              item.value.kind === 'member'
                ? `tasks-filter-member-${i - 2}`
                : `tasks-filter-${item.key}`
            }
          />
        ))}
      </View>

      {!loading && view.total === 0 ? (
        <EmptyState
          icon="tasks"
          message={t(filter.kind === 'everyone' ? 'tasks.empty' : 'tasks.emptyFiltered')}
          testID="tasks-empty"
        />
      ) : null}

      {view.overdue.length ? (
        <View testID="tasks-overdue">
          <SectionHeader title={t('tasks.groups.overdue')} />
          {view.overdue.map((item, i) => row(item, `tasks-overdue-${i}`, true))}
        </View>
      ) : null}

      {view.today.length ? (
        <View testID="tasks-today">
          <SectionHeader title={t('tasks.groups.today')} />
          {view.today.map((item, i) => row(item, `tasks-today-${i}`, false))}
        </View>
      ) : null}

      {view.upcoming.length ? (
        <View testID="tasks-upcoming" style={{ gap: theme.space[2] }}>
          <SectionHeader title={t('tasks.groups.upcoming')} />
          {view.upcoming.map((day, d) => (
            <View key={day.date}>
              <SectionHeader variant="group" title={dayLabel(day.date, today, locale)} />
              {day.items.map((item, i) => row(item, `tasks-upcoming-${d}-${i}`, false))}
            </View>
          ))}
        </View>
      ) : null}

      {view.later.length ? (
        <View testID="tasks-later">
          <SectionHeader title={t('tasks.groups.later')} />
          {view.later
            .flatMap((day) => day.items)
            .map((item, i) => row(item, `tasks-later-${i}`, true))}
        </View>
      ) : null}

      {view.anytime.length ? (
        <View testID="tasks-anytime">
          <SectionHeader title={t('tasks.groups.anytime')} />
          {view.anytime.map((item, i) => row(item, `tasks-anytime-${i}`, false))}
        </View>
      ) : null}

      {view.done.length ? (
        <View testID="tasks-done">
          <ListRow
            title={t(showDone ? 'tasks.groups.hideDone' : 'tasks.groups.showDone', {
              count: view.done.length,
            })}
            variant="navigation"
            onPress={() => setShowDone((shown) => !shown)}
            testID="tasks-done-toggle"
          />
          {showDone ? view.done.map((item, i) => row(item, `tasks-done-${i}`, true)) : null}
        </View>
      ) : null}

      {!loading && view.total > 0 && open === 0 ? (
        <ListRow title={t('tasks.allDone')} testID="tasks-all-done" />
      ) : null}
      {footer}
    </Screen>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
});
