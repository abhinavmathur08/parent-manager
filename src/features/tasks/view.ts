import { startOfDay } from '@/features/calendar/agenda';
import { addDays, todayIn, type PlanDate, type WeekStart } from '@/features/planner/week';

import { nextOpenOccurrence, type ChoreOccurrence } from './chores';
import { isChore, type TaskOccurrenceRow, type TaskRow } from './tables';

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
  /** A chore's next open occurrence, which the row stands for (FR3-CHORE-2). */
  occurrence: ChoreOccurrence | null;
  /** Done, or a chore whose rule has ended with nothing left open. */
  done: boolean;
  /** Who it's for: the occurrence's assignee for a chore, else the task's. */
  assigneeUserId: string | null;
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
  /** The chores' stored occurrences (R3-CHORE-1). */
  occurrences?: readonly TaskOccurrenceRow[];
  /** The household's week start, for "every 2 weeks" chores. */
  weekStart?: WeekStart;
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
function dueInstant(dueAt: string | null, date: PlanDate | null, timeZone: string): number {
  if (dueAt) return Date.parse(dueAt);
  return date ? startOfDay(date, timeZone) : Number.POSITIVE_INFINITY;
}

export function matchesFilter(
  assigneeUserId: string | null,
  filter: TaskFilter,
  userId: string | null,
): boolean {
  switch (filter.kind) {
    case 'everyone':
      return true;
    case 'mine':
      return userId !== null && assigneeUserId === userId;
    case 'member':
      return assigneeUserId === filter.userId;
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

  const chores = { timeZone, weekStart: options.weekStart ?? 1, today };
  for (const task of tasks) {
    if (task.deleted_at) continue;
    // A chore stands for its next open occurrence; one whose rule has ended counts as done.
    const chore = isChore(task);
    const occurrence = chore ? nextOpenOccurrence(task, options.occurrences ?? [], chores) : null;
    const assigneeUserId = occurrence ? occurrence.assigneeUserId : task.assignee_user_id;
    if (!matchesFilter(assigneeUserId, options.filter, options.userId)) continue;
    const done = chore ? occurrence === null : task.done;
    const date = occurrence ? occurrence.originalDate : dueDate(task, timeZone);
    const dueAt = occurrence ? occurrence.dueAt : task.due_at;
    order.set(task.id, dueInstant(dueAt, date, timeZone));
    view.total += 1;
    if (done) {
      view.done.push({ task, date, overdue: false, occurrence, done, assigneeUserId });
      continue;
    }
    // A timed task is overdue once its time passes; a dated one once its day has.
    const overdue = date !== null && (dueAt ? Date.parse(dueAt) < nowMs : date < today);
    const item = { task, date, overdue, occurrence, done, assigneeUserId };
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
