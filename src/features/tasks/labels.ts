import type { TFunction } from 'i18next';

import { daysBetween, toDate, type PlanDate } from '@/features/planner/week';
import { formatDate, formatRelativeDay, formatTime } from '@/i18n/format';

import type { TaskRow } from './tables';

const DAY_FORMAT: Intl.DateTimeFormatOptions = {
  weekday: 'short',
  month: 'short',
  day: 'numeric',
  timeZone: 'UTC',
};

/** A day's label: "Today", "Tomorrow" or "Yesterday" from Intl, else "Fri, Dec 4" (NFR3-L10N-1). */
export function dayLabel(date: PlanDate, today: PlanDate, locale: string): string {
  return (
    formatRelativeDay(daysBetween(today, date), locale) ??
    formatDate(toDate(date), locale, DAY_FORMAT)
  );
}

/**
 * When a task is due, in the household's timezone (FR3-TASK-3): the day, plus the time for a
 * timed task. Null for Anytime.
 */
export function dueLabel(
  task: Pick<TaskRow, 'due_at'>,
  date: PlanDate | null,
  options: { today: PlanDate; locale: string; timeZone: string; t: TFunction },
): string | null {
  if (!date) return null;
  const day = dayLabel(date, options.today, options.locale);
  if (!task.due_at) return day;
  const time = formatTime(new Date(task.due_at), options.locale, options.timeZone);
  return options.t('tasks.due.dateTime', { date: day, time });
}

/**
 * A task's title: the member's text, or an unedited checklist item's text from the locale
 * files by its ID (R3-TASK-2).
 */
export function taskTitle(task: Pick<TaskRow, 'title' | 'template_item_id'>, t: TFunction): string {
  if (task.title) return task.title;
  return task.template_item_id
    ? t(task.template_item_id, { defaultValue: t('tasks.untitled') })
    : '';
}
