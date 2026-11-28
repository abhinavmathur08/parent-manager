import type { TFunction } from 'i18next';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AppState } from 'react-native';

import { onSignOut } from '@/features/auth/sign-out';
import { householdTimeZone } from '@/features/calendar/agenda';
import { wallTime } from '@/features/calendar/repeat';
import type { Membership } from '@/features/household/membership';
import { addDays } from '@/features/planner/week';
import { useTaskRows } from '@/features/tasks/data';
import { taskTitle } from '@/features/tasks/labels';
import { formatDate, formatTime } from '@/i18n';
import { readPushPermission } from '@/lib/notifications/push';

import { onEventDetailsChanged, showEventDetails } from './event-details';
import { setLocalNotifications, type LocalNotification } from './local-budget';
import { cachedPrefs, onPrefsChanged } from './prefs';
import {
  oneOffDues,
  TASK_REMINDER_ID_PREFIX,
  taskReminderSchedule,
  TASKS_TODAY_ID_PREFIX,
  tasksTodaySchedule,
  type TaskReminderEntry,
  type TasksTodayEntry,
} from './task-reminders';

export type TaskTextOptions = {
  t: TFunction;
  locale: string;
  timeZone: string;
  /** "Show details in notifications" (FR3-NOT-2), shared with event reminders. */
  details: boolean;
};

/**
 * A reminder's text (FR3-NOT-2): that a task is due and when. The title appears only when the
 * member turned details on for this device; notes never do.
 */
export function taskReminderText(
  { due, fireAt }: TaskReminderEntry,
  { t, locale, timeZone, details }: TaskTextOptions,
): { title: string; body: string } {
  const fireDate = wallTime(fireAt.getTime(), timeZone).date;
  const time = due.dueAt ? formatTime(new Date(due.dueAt), locale, timeZone) : null;
  const timed = time ? 'At' : '';
  const body =
    due.date === fireDate
      ? t(`notifications.task.dueToday${timed}`, { time })
      : due.date === addDays(fireDate, 1)
        ? t(`notifications.task.dueTomorrow${timed}`, { time })
        : t(`notifications.task.dueOn${timed}`, {
            time,
            day: formatDate(new Date(`${due.date}T12:00:00Z`), locale, {
              weekday: 'long',
              month: 'short',
              day: 'numeric',
              timeZone: 'UTC',
            }),
          });
  const title = details ? taskTitle(due.task, t) : '';
  return { title: title || t('notifications.task.title'), body };
}

/** The local notification for a reminder: opens the task. IDs only in `data`. */
export function taskReminderNotification(
  entry: TaskReminderEntry,
  text: { title: string; body: string },
): LocalNotification {
  return {
    id: entry.id,
    fireAt: entry.fireAt,
    ...text,
    data: {
      type: 'task_reminder',
      task_id: entry.due.task.id,
      ...(entry.due.originalDate ? { date: entry.due.originalDate } : {}),
    },
    categoryIdentifier: 'task_reminder',
  };
}

/** Today's tasks (FR3-NOT-4): the count only. Opens the Tasks tab. */
export function tasksTodayNotification(entry: TasksTodayEntry, t: TFunction): LocalNotification {
  return {
    id: entry.id,
    fireAt: entry.fireAt,
    title: t('notifications.tasksToday.title'),
    body: t('notifications.tasksToday.body', { count: entry.count }),
    data: { type: 'tasks_today', date: entry.date },
    categoryIdentifier: 'tasks_today',
  };
}

// Reminders can name household tasks, so they don't outlive the session on this device.
onSignOut(() =>
  Promise.all([
    setLocalNotifications(TASK_REMINDER_ID_PREFIX, []),
    setLocalNotifications(TASKS_TODAY_ID_PREFIX, []),
  ]),
);

/**
 * Keeps task reminders (FR3-NOT-1) and today's tasks (FR3-NOT-4) scheduled on this device from
 * the synced tasks, within the budget shared with events and defrost reminders: when tasks or
 * settings change, and when the app returns to the foreground. Each is off while its switch is
 * off or permission isn't granted.
 */
export function TaskReminderScheduler({
  userId,
  membership,
}: {
  userId: string;
  membership: Membership;
}) {
  const { t, i18n } = useTranslation();
  const timeZone = householdTimeZone(membership.timezone);
  const isParent = membership.role === 'parent';
  const { tasks, loading } = useTaskRows();
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const bump = () => setTick((n) => n + 1);
    const appState = AppState.addEventListener('change', (state) => {
      if (state === 'active') bump();
    });
    const prefs = onPrefsChanged(bump);
    const details = onEventDetailsChanged(bump);
    return () => {
      appState.remove();
      prefs();
      details();
    };
  }, []);

  useEffect(() => {
    if (loading) return;
    let cancelled = false;
    void (async () => {
      const prefs = cachedPrefs(userId);
      const granted = (await readPushPermission()) === 'granted';
      if (cancelled) return;
      const input = {
        dues: oneOffDues(tasks, timeZone),
        userId,
        isParent,
        timeZone,
        now: new Date(),
        quietStartMinute: prefs.quietStartMinute,
        quietEndMinute: prefs.quietEndMinute,
      };
      const options = {
        t,
        locale: i18n.language,
        timeZone,
        details: showEventDetails(userId),
      };
      const reminders =
        granted && prefs.task_reminders
          ? taskReminderSchedule(input).map((r) =>
              taskReminderNotification(r, taskReminderText(r, options)),
            )
          : [];
      const today =
        granted && prefs.tasks_today
          ? tasksTodaySchedule(input).map((entry) => tasksTodayNotification(entry, t))
          : [];
      await setLocalNotifications(TASK_REMINDER_ID_PREFIX, reminders);
      await setLocalNotifications(TASKS_TODAY_ID_PREFIX, today);
    })().catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [tasks, loading, timeZone, isParent, userId, tick, t, i18n.language]);

  return null;
}
