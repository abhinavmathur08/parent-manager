/**
 * Task reminders and today's tasks (T-04.1, FR3-NOT-1, FR3-NOT-2, FR3-NOT-4): local
 * notifications worked out on the device from the synced tasks, so they fire offline. The
 * device only holds tasks the member can see (T-01.2), so nothing here checks visibility again.
 */
import { wallTime, zonedInstant } from '@/features/calendar/repeat';
import { addDays, todayIn, type PlanDate } from '@/features/planner/week';
import { isChore, type TaskReminder, type TaskRow } from '@/features/tasks/tables';
import { dueDate } from '@/features/tasks/view';

import { afterQuietHours } from './event-reminders';

/** Local notification IDs start with these, so the app can find and replace its own. */
export const TASK_REMINDER_ID_PREFIX = 'task.';
export const TASKS_TODAY_ID_PREFIX = 'tasks_today.';

/** How far ahead reminders are scheduled; refills on start, foreground and sync add later ones. */
export const TASK_REMINDER_DAYS_AHEAD = 14;
/** How many mornings of "today's tasks" are scheduled ahead, counted from the current copy. */
export const TASKS_TODAY_DAYS_AHEAD = 7;

/** "In the morning" is 09:00 on the due day, "the day before" 18:00 (FR3-NOT-1, PROPOSED). */
export const MORNING_MINUTE = 9 * 60;
export const DAY_BEFORE_MINUTE = 18 * 60;
/** Today's tasks goes at 08:00 household time (FR3-NOT-4, PROPOSED). */
export const TASKS_TODAY_MINUTE = 8 * 60;

const DAY_MS = 24 * 60 * 60_000;

/**
 * Something due that may be reminded of: a one-off task, or one occurrence of a chore. The
 * chore engine (T-03) adds its open occurrences through the same shape, with `originalDate`
 * naming the occurrence, so reminders and today's count cover chores without changes here.
 */
export type TaskDue = {
  task: Pick<TaskRow, 'id' | 'title' | 'template_item_id'>;
  /** A chore occurrence's original date; null for a one-off task. */
  originalDate: PlanDate | null;
  /** The due day in the household's timezone. */
  date: PlanDate;
  /** The due instant, for a timed task. */
  dueAt: string | null;
  reminder: TaskReminder | null;
  assigneeUserId: string | null;
};

/**
 * The open one-off tasks with a due. Chores are left to the chore engine's occurrences
 * (T-03), since a chore's own due is only its first.
 */
export function oneOffDues(tasks: readonly TaskRow[], timeZone: string): TaskDue[] {
  const result: TaskDue[] = [];
  for (const task of tasks) {
    if (task.deleted_at || task.done || isChore(task)) continue;
    const date = dueDate(task, timeZone);
    if (!date) continue;
    result.push({
      task,
      originalDate: null,
      date,
      dueAt: task.due_at,
      reminder: task.reminder,
      assigneeUserId: task.assignee_user_id,
    });
  }
  return result;
}

/** Whether a due is this member's: theirs, or unassigned and they're a parent (FR3-NOT-1). */
export function isMine(due: TaskDue, userId: string, isParent: boolean): boolean {
  return due.assigneeUserId === userId || (due.assigneeUserId === null && isParent);
}

export type TaskReminderEntry = {
  /** The local notification's identifier: one per task or occurrence. */
  id: string;
  due: TaskDue;
  fireAt: Date;
};

export type TaskScheduleInput = {
  dues: readonly TaskDue[];
  userId: string;
  isParent: boolean;
  /** The household's IANA timezone. */
  timeZone: string;
  now: Date;
  quietStartMinute: number;
  quietEndMinute: number;
};

const at = (date: PlanDate, minute: number, timeZone: string) =>
  zonedInstant(
    { date, hour: Math.floor(minute / 60), minute: minute % 60, second: 0, ms: 0 },
    timeZone,
  );

const dueKey = (due: TaskDue) =>
  due.originalDate ? `${due.task.id}.${due.originalDate}` : due.task.id;

/**
 * The reminders this device should have, nearest first (FR3-NOT-1): one per open task of this
 * member's with a reminder, in the next two weeks and still in the future. "At the time" goes
 * at the due time; the others move out of quiet hours to their end (household time), and are
 * dropped if that's after the due time, or after the due day for a task with no time.
 */
export function taskReminderSchedule(input: TaskScheduleInput): TaskReminderEntry[] {
  const { timeZone, now, userId, isParent, quietStartMinute, quietEndMinute } = input;
  const nowMs = now.getTime();
  const until = nowMs + TASK_REMINDER_DAYS_AHEAD * DAY_MS;
  const result: TaskReminderEntry[] = [];
  for (const due of input.dues) {
    if (!due.reminder || !isMine(due, userId, isParent)) continue;
    const deadline = due.dueAt ? Date.parse(due.dueAt) : at(addDays(due.date, 1), 0, timeZone);
    let fireAt: number;
    if (due.reminder === 'reminder.at_time') {
      if (!due.dueAt) continue;
      fireAt = deadline;
    } else {
      const planned =
        due.reminder === 'reminder.morning'
          ? at(due.date, MORNING_MINUTE, timeZone)
          : at(addDays(due.date, -1), DAY_BEFORE_MINUTE, timeZone);
      fireAt = afterQuietHours(planned, timeZone, quietStartMinute, quietEndMinute);
      if (fireAt >= deadline) continue;
    }
    if (fireAt <= nowMs || fireAt > until) continue;
    result.push({
      id: `${TASK_REMINDER_ID_PREFIX}${dueKey(due)}`,
      due,
      fireAt: new Date(fireAt),
    });
  }
  return result.sort((a, b) => a.fireAt.getTime() - b.fireAt.getTime() || a.id.localeCompare(b.id));
}

export type TasksTodayEntry = { id: string; date: PlanDate; count: number; fireAt: Date };

/**
 * "Today's tasks" for this member (FR3-NOT-4): for today and the next mornings, one at 08:00
 * household time (or the end of quiet hours, if they cover it, while still that day) with the
 * count of their open tasks due that day. Nothing on a day with none.
 */
export function tasksTodaySchedule(input: TaskScheduleInput): TasksTodayEntry[] {
  const { timeZone, now, userId, isParent, quietStartMinute, quietEndMinute } = input;
  const nowMs = now.getTime();
  const counts = new Map<PlanDate, number>();
  for (const due of input.dues) {
    if (isMine(due, userId, isParent)) counts.set(due.date, (counts.get(due.date) ?? 0) + 1);
  }
  const today = todayIn(timeZone, now);
  const result: TasksTodayEntry[] = [];
  for (let i = 0; i < TASKS_TODAY_DAYS_AHEAD; i++) {
    const date = addDays(today, i);
    const count = counts.get(date) ?? 0;
    if (count === 0) continue;
    const fireAt = afterQuietHours(
      at(date, TASKS_TODAY_MINUTE, timeZone),
      timeZone,
      quietStartMinute,
      quietEndMinute,
    );
    if (fireAt <= nowMs || wallTime(fireAt, timeZone).date !== date) continue;
    result.push({ id: `${TASKS_TODAY_ID_PREFIX}${date}`, date, count, fireAt: new Date(fireAt) });
  }
  return result;
}
