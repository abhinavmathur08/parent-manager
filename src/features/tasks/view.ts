import { startOfDay } from '@/features/calendar/agenda';
import { addDays, todayIn, type PlanDate } from '@/features/planner/week';

import type { TaskRow } from './tables';

/**
 * The Tasks tab's groups (S-44, FR3-TASK-1), worked out from the local copy. Pure, so it's
 * tested without a device and stays fast with 1,000 tasks (NFR3-PERF-1).
 */

/** Mine, everyone, or one member's tasks (FR3-TASK-1, PROPOSED). */
export type TaskFilter =
  { kind: 'mine' } | { kind: 'everyone' } | { kind: 'member'; userId: string };

export type TaskItem = {
  task: TaskRow;
  /** The due day in the household's timezone, or null for Anytime. */
  date: PlanDate | null;
  overdue: boolean;
};

export type TaskDay = { date: PlanDate; items: TaskItem[] };

export type TaskView = {
  overdue: TaskItem[];
  today: TaskItem[];
  /** The next `upcomingDays` days, by day. */
  upcoming: TaskDay[];
  /** Due after the Upcoming range, by day. */
  later: TaskDay[];
  anytime: TaskItem[];
  /** Newest completion first. */
  done: TaskItem[];
  /** Open and done tasks shown, for the empty state. */
  total: number;
};

export type TaskViewOptions = {
  filter: TaskFilter;
  userId: string | null;
  timeZone: string;
  now: Date;
  /** `app_config` `tasks.limits.upcoming_days` (R3-PAY-1), 14 by default. */
  upcomingDays: number;
};

/** A task's due day in the household's timezone (FR3-TASK-3). */
export function dueDate(
  task: Pick<TaskRow, 'due_date' | 'due_at'>,
  timeZone: string,
): PlanDate | null {
  if (task.due_date) return task.due_date;
  if (task.due_at) return todayIn(timeZone, new Date(task.due_at));
  return null;
}

/** When a task is due, as an instant: its time, or the start of its day. */
function dueInstant(task: TaskRow, date: PlanDate | null, timeZone: string): number {
  if (task.due_at) return Date.parse(task.due_at);
  return date ? startOfDay(date, timeZone) : Number.POSITIVE_INFINITY;
}

export function matchesFilter(task: TaskRow, filter: TaskFilter, userId: string | null): boolean {
  switch (filter.kind) {
    case 'everyone':
      return true;
    case 'mine':
      return userId !== null && task.assignee_user_id === userId;
    case 'member':
      return task.assignee_user_id === filter.userId;
  }
}

export function buildTaskView(tasks: readonly TaskRow[], options: TaskViewOptions): TaskView {
  const { timeZone, now } = options;
  const today = todayIn(timeZone, now);
  const lastUpcoming = addDays(today, Math.max(options.upcomingDays, 0));
  const nowMs = now.getTime();
  const view: TaskView = {
    overdue: [],
    today: [],
    upcoming: [],
    later: [],
    anytime: [],
    done: [],
    total: 0,
  };
  const upcoming = new Map<PlanDate, TaskItem[]>();
  const later = new Map<PlanDate, TaskItem[]>();
  const order = new Map<string, number>();

  for (const task of tasks) {
    if (task.deleted_at || !matchesFilter(task, options.filter, options.userId)) continue;
    const date = dueDate(task, timeZone);
    order.set(task.id, dueInstant(task, date, timeZone));
    view.total += 1;
    if (task.done) {
      view.done.push({ task, date, overdue: false });
      continue;
    }
    // A timed task is overdue once its time passes; a dated one once its day has.
    const overdue = date !== null && (task.due_at ? Date.parse(task.due_at) < nowMs : date < today);
    const item = { task, date, overdue };
    if (date === null) view.anytime.push(item);
    else if (overdue) view.overdue.push(item);
    else if (date === today) view.today.push(item);
    else {
      const target = date <= lastUpcoming ? upcoming : later;
      target.set(date, [...(target.get(date) ?? []), item]);
    }
  }

  // Stable on every device and never by display text: due, then creation, then ID.
  const byDue = (a: TaskItem, b: TaskItem) =>
    order.get(a.task.id)! - order.get(b.task.id)! ||
    (a.task.created_at ?? '').localeCompare(b.task.created_at ?? '') ||
    a.task.id.localeCompare(b.task.id);
  const days = (map: Map<PlanDate, TaskItem[]>) =>
    [...map.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, items]) => ({ date, items: items.sort(byDue) }));

  view.overdue.sort(byDue);
  view.today.sort(byDue);
  view.anytime.sort(
    (a, b) =>
      (a.task.created_at ?? '').localeCompare(b.task.created_at ?? '') ||
      a.task.id.localeCompare(b.task.id),
  );
  view.done.sort(
    (a, b) =>
      (b.task.done_at ?? '').localeCompare(a.task.done_at ?? '') ||
      a.task.id.localeCompare(b.task.id),
  );
  view.upcoming = days(upcoming);
  view.later = days(later);
  return view;
}
