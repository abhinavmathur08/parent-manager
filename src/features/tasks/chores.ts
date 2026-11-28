/**
 * The chore engine (T-03.1, FR3-CHORE-1, FR3-CHORE-2, FR3-CHORE-4, R3-CHORE-1 to R3-CHORE-3).
 *
 * A chore is a task with a repeat. Its occurrences are worked out here, on the device, from the
 * task and its stored occurrence rows, and never stored except those done, skipped or reassigned
 * (R3-CHORE-1). An occurrence is named by its original date in the household's timezone, so
 * every device names it the same (R3-CHORE-2, `occurrenceId`).
 *
 * Two modes (FR3-CHORE-1):
 * - **On a schedule:** the calendar's repeat rule (`parseRepeat`), expanded by the calendar's
 *   `expandOccurrences` from the chore's first due date, so count, until and "every 2 weeks"
 *   behave as for events.
 * - **After it's done:** every N days from the last completion. Only the next occurrence is
 *   known; later ones are projected as if each were done on its day.
 *
 * A timed chore keeps its wall time in the household's timezone across daylight-saving changes.
 *
 * Only the next open occurrence shows in the Tasks tab (FR3-CHORE-2): it's the latest occurrence
 * on or before today after the last done or skipped one, so missed ones collapse into one, or
 * else the first one after today.
 *
 * Rotation (D-26): each occurrence goes to the member after whoever did the last done one;
 * skipping keeps the turn, and reassigning one occurrence changes only that one (R3-CHORE-3).
 * Pure, so every device computes the same answer from the same synced rows.
 */
import { expandOccurrences, parseRepeat, wallTime, zonedInstant } from '@/features/calendar/repeat';
import {
  addDays,
  daysBetween,
  toDate,
  todayIn,
  type PlanDate,
  type WeekStart,
} from '@/features/planner/week';

import { isChore, occurrenceId, type TaskOccurrenceRow, type TaskRow } from './tables';

export type ChoreTask = Pick<
  TaskRow,
  | 'id'
  | 'due_date'
  | 'due_at'
  | 'repeat'
  | 'after_done_days'
  | 'assignee_user_id'
  | 'rotation_user_ids'
>;

export type ChoreMode = 'schedule' | 'after_done';

export type ChoreOccurrence = {
  /** The stored row's ID, or the one it gets when first touched (R3-CHORE-2). */
  id: string;
  taskId: string;
  /** Names the occurrence: its original date in the household's timezone. */
  originalDate: PlanDate;
  /** The instant it's due, for a timed chore; null for a dated one. */
  dueAt: string | null;
  /** Who it's for: the stored row's, else the rotation's turn, else the chore's assignee. */
  assigneeUserId: string | null;
  status: 'open' | 'done' | 'skipped';
  /** The stored row, when the occurrence was done, skipped or reassigned. */
  row: TaskOccurrenceRow | null;
};

export type ChoreContext = {
  /** The household's IANA timezone. */
  timeZone: string;
  /** The household's week start, which sets the weeks of an "every 2 weeks" rule. */
  weekStart: WeekStart;
  /** Today in the household's timezone. */
  today: PlanDate;
};

/**
 * How far back a missed occurrence is still shown as overdue. Missed ones collapse into the
 * latest, and every rule repeats at least every 62 days (monthly on the 31st), so this only
 * drops a series that ended long ago without its last occurrence being done.
 */
const LOOKBACK_DAYS = 70;

export function choreMode(task: Pick<TaskRow, 'repeat' | 'after_done_days'>): ChoreMode | null {
  if (task.after_done_days != null) return 'after_done';
  if (parseRepeat(task.repeat)) return 'schedule';
  return null;
}

/** The chore's first due date in the household's timezone, which its rule repeats from. */
function firstDate(task: ChoreTask, timeZone: string): PlanDate | null {
  if (task.due_date) return task.due_date;
  if (task.due_at) return todayIn(timeZone, new Date(task.due_at));
  return null;
}

/** The chore's live rows, by original date. */
function rowsByDate(task: ChoreTask, rows: readonly TaskOccurrenceRow[]) {
  const byDate = new Map<PlanDate, TaskOccurrenceRow>();
  for (const row of rows) {
    if (row.task_id === task.id && !row.deleted_at) byDate.set(row.original_date, row);
  }
  return byDate;
}

const isClosed = (row: TaskOccurrenceRow | undefined | null) => !!row && (row.done || row.skipped);

/** The last done or skipped occurrence's date, or null if none. */
function lastClosedDate(byDate: Map<PlanDate, TaskOccurrenceRow>): PlanDate | null {
  let last: PlanDate | null = null;
  for (const [date, row] of byDate)
    if (isClosed(row) && (last === null || date > last)) last = date;
  return last;
}

/** A schedule chore's dates in [from, to], inclusive, through the calendar's expansion. */
function scheduleDates(
  task: ChoreTask,
  first: PlanDate,
  from: PlanDate,
  to: PlanDate,
  weekStart: WeekStart,
): PlanDate[] {
  if (to < from) return [];
  // Dates only: an all-day series, read in UTC so each date is its own day.
  return expandOccurrences(
    {
      id: task.id,
      all_day: true,
      starts_at: null,
      ends_at: null,
      start_date: first,
      end_date: first,
      repeat: task.repeat,
      taking_user_id: null,
    },
    {
      timeZone: 'UTC',
      from: toDate(from),
      to: toDate(addDays(to, 1)),
      weekStart,
    },
  ).map((occurrence) => occurrence.originalDate);
}

type DueAtOn = (date: PlanDate) => string | null;

/**
 * A timed chore's instant on each date: the first due's wall time there, so it stays at 18:00
 * across daylight-saving changes. The last offset is tried first and checked with one Intl call,
 * since working the offset out afresh takes several (NFR3-PERF-2).
 */
function dueAtOn(task: ChoreTask, timeZone: string): DueAtOn {
  if (!task.due_at) return () => null;
  const wall = wallTime(Date.parse(task.due_at), timeZone);
  const dayMs = ((wall.hour * 60 + wall.minute) * 60 + wall.second) * 1000 + wall.ms;
  let offset: number | null = null;
  return (date) => {
    const local = Date.parse(`${date}T00:00:00Z`) + dayMs;
    if (offset !== null) {
      const guess = local - offset;
      const seen = wallTime(guess, timeZone);
      if (seen.date === date && seen.hour === wall.hour && seen.minute === wall.minute) {
        return new Date(guess).toISOString();
      }
    }
    const instant = zonedInstant({ ...wall, date }, timeZone);
    offset = local - instant;
    return new Date(instant).toISOString();
  };
}

/** The date an after-done chore's next occurrence falls on (FR3-CHORE-1). */
function afterDoneNext(
  task: ChoreTask,
  first: PlanDate,
  byDate: Map<PlanDate, TaskOccurrenceRow>,
  { timeZone, today }: ChoreContext,
): PlanDate {
  const last = lastClosedDate(byDate);
  if (last === null) return first;
  const row = byDate.get(last)!;
  // When it was done, or skipped; a write not yet back from the server counts as today.
  const at = row.done ? row.done_at : row.updated_at;
  const closedOn = at ? todayIn(timeZone, new Date(at)) : today;
  const next = addDays(closedOn, task.after_done_days ?? 1);
  // Never on or before the occurrence just closed, even if it was done early.
  const after = addDays(last, 1);
  return next > after ? next : after;
}

/** The date of the chore's next open occurrence, or null once its rule has ended. */
function nextOpenDate(
  task: ChoreTask,
  byDate: Map<PlanDate, TaskOccurrenceRow>,
  ctx: ChoreContext,
): PlanDate | null {
  const mode = choreMode(task);
  const first = firstDate(task, ctx.timeZone);
  if (!mode || !first) return null;
  if (mode === 'after_done') return afterDoneNext(task, first, byDate, ctx);

  const last = lastClosedDate(byDate);
  let from = addDays(ctx.today, -LOOKBACK_DAYS);
  if (from < first) from = first;
  if (last !== null && last >= from) from = addDays(last, 1);
  const horizon = addDays(from > ctx.today ? from : ctx.today, LOOKBACK_DAYS);
  const dates = scheduleDates(task, first, from, horizon, ctx.weekStart);
  // Missed ones collapse into the latest on or before today (FR3-CHORE-2).
  let open: PlanDate | null = null;
  for (const date of dates) {
    if (date <= ctx.today) open = date;
    else return open ?? date;
  }
  return open;
}

const rotationOf = (task: ChoreTask) =>
  task.rotation_user_ids && task.rotation_user_ids.length >= 2 ? task.rotation_user_ids : null;

/**
 * Whose turn the chore's next occurrence is (FR3-CHORE-4, R3-CHORE-3): the member after whoever
 * did the last done occurrence. Skips keep the turn. With no completion yet it's the chore's
 * assignee if they're in the rotation, else the first member. Without a rotation it's the
 * chore's assignee.
 */
export function nextAssignee(task: ChoreTask, rows: readonly TaskOccurrenceRow[]): string | null {
  const rotation = rotationOf(task);
  if (!rotation) return task.assignee_user_id;
  let last: TaskOccurrenceRow | null = null;
  for (const row of rowsByDate(task, rows).values()) {
    if (!row.done) continue;
    if (
      !last ||
      row.original_date > last.original_date ||
      (row.original_date === last.original_date && (row.done_at ?? '') > (last.done_at ?? ''))
    ) {
      last = row;
    }
  }
  if (!last) {
    const index = task.assignee_user_id ? rotation.indexOf(task.assignee_user_id) : -1;
    return rotation[Math.max(index, 0)];
  }
  // Whoever did it; if they're not in the rotation, whoever it was for.
  let index = last.done_by ? rotation.indexOf(last.done_by) : -1;
  if (index < 0 && last.assignee_user_id) index = rotation.indexOf(last.assignee_user_id);
  return index < 0 ? rotation[0] : rotation[(index + 1) % rotation.length];
}

function occurrence(
  task: ChoreTask,
  date: PlanDate,
  row: TaskOccurrenceRow | null,
  turn: string | null,
  dueAt: DueAtOn,
): ChoreOccurrence {
  const status = row?.done ? 'done' : row?.skipped ? 'skipped' : 'open';
  return {
    id: row?.id ?? occurrenceId(task.id, date),
    taskId: task.id,
    originalDate: date,
    dueAt: dueAt(date),
    assigneeUserId: row?.assignee_user_id ?? (status === 'done' ? (row?.done_by ?? turn) : turn),
    status,
    row,
  };
}

/** The chore's next open occurrence, the one the Tasks tab shows (FR3-CHORE-2). */
export function nextOpenOccurrence(
  task: ChoreTask,
  rows: readonly TaskOccurrenceRow[],
  ctx: ChoreContext,
): ChoreOccurrence | null {
  if (!isChore(task)) return null;
  const byDate = rowsByDate(task, rows);
  const date = nextOpenDate(task, byDate, ctx);
  if (date === null) return null;
  const dueAt = dueAtOn(task, ctx.timeZone);
  return occurrence(task, date, byDate.get(date) ?? null, nextAssignee(task, rows), dueAt);
}

/**
 * The chore's occurrences in [from, to], inclusive, in date order: its done and skipped ones,
 * the next open one, and those after it as they'll come, each to the next member in a rotation
 * (NFR3-PERF-2). Missed ones before the open one aren't listed.
 */
export function expandChore(
  task: ChoreTask,
  rows: readonly TaskOccurrenceRow[],
  ctx: ChoreContext & { from: PlanDate; to: PlanDate },
): ChoreOccurrence[] {
  const mode = choreMode(task);
  const first = firstDate(task, ctx.timeZone);
  if (!mode || !first || ctx.to < ctx.from) return [];
  const byDate = rowsByDate(task, rows);
  const dueAt = dueAtOn(task, ctx.timeZone);
  const result: ChoreOccurrence[] = [];
  for (const [date, row] of byDate) {
    if (isClosed(row) && date >= ctx.from && date <= ctx.to) {
      result.push(occurrence(task, date, row, null, dueAt));
    }
  }

  const open = nextOpenDate(task, byDate, ctx);
  if (open !== null && open <= ctx.to) {
    const rotation = rotationOf(task);
    const turn = nextAssignee(task, rows);
    const start = rotation && turn ? rotation.indexOf(turn) : -1;
    const turnAt = (k: number) =>
      rotation && start >= 0 ? rotation[(start + k) % rotation.length] : turn;
    const dates =
      mode === 'schedule'
        ? scheduleDates(task, first, open, ctx.to, ctx.weekStart)
        : Array.from(
            { length: Math.floor(daysBetween(open, ctx.to) / (task.after_done_days ?? 1)) + 1 },
            (_, k) => addDays(open, k * (task.after_done_days ?? 1)),
          );
    dates.forEach((date, k) => {
      if (date < ctx.from || isClosed(byDate.get(date))) return;
      result.push(occurrence(task, date, byDate.get(date) ?? null, turnAt(k), dueAt));
    });
  }
  return result.sort((a, b) => a.originalDate.localeCompare(b.originalDate));
}
