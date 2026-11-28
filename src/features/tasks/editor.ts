import { wallInstant } from '@/features/calendar/editor';
import { todayIn, type PlanDate } from '@/features/planner/week';
import type { MemberRole } from '@/features/household/invitations';

import { TASK_LIMITS, type TaskReminder, type TaskSourceKind } from './tables';

/**
 * The task editor's form (S-45, FR3-TASK-2), kept on the device as a draft so it survives the
 * app being killed (NFR-A11Y-8). Repeats come with T-03.2.
 */
export type TaskDraft = {
  title: string;
  /** No due, a date, or a date and time (FR3-TASK-3). */
  due: 'none' | 'date' | 'time';
  date: PlanDate;
  /** Minutes after midnight in the household's timezone, for a timed task. */
  minutes: number;
  assigneeUserId: string | null;
  reminder: TaskReminder | null;
  notes: string;
  shared: boolean;
};

/** A new task's default time: 18:00 (PROPOSED), a common "by this evening". */
export const DEFAULT_DUE_MINUTES = 18 * 60;

/**
 * FR3-TASK-2 defaults: no due, and assigned to the member adding it if a helper, otherwise to
 * anyone. A helper's task is always shared (D-25).
 */
export function newTaskDraft(
  now: Date,
  timeZone: string,
  userId: string | null,
  isParent: boolean,
): TaskDraft {
  return {
    title: '',
    due: 'none',
    date: todayIn(timeZone, now),
    minutes: DEFAULT_DUE_MINUTES,
    assigneeUserId: isParent ? null : userId,
    reminder: null,
    notes: '',
    shared: !isParent,
  };
}

/** The reminders a due allows (FR3-NOT-1): "at the time" needs a time. */
export function remindersFor(due: TaskDraft['due']): TaskReminder[] {
  if (due === 'none') return [];
  if (due === 'date') return ['reminder.morning', 'reminder.day_before'];
  return ['reminder.at_time', 'reminder.morning', 'reminder.day_before'];
}

/** Changing the due drops a reminder it no longer allows. */
export function withDue(draft: TaskDraft, due: TaskDraft['due']): TaskDraft {
  const reminder =
    draft.reminder && remindersFor(due).includes(draft.reminder) ? draft.reminder : null;
  return { ...draft, due, reminder };
}

/** Only a title is required (FR3-TASK-2). */
export function canSaveTask(draft: TaskDraft): boolean {
  const title = draft.title.trim();
  return title.length > 0 && title.length <= TASK_LIMITS.titleLength;
}

/** A task's own columns, as written through the sync layer. */
export type TaskValues = {
  title: string | null;
  template_item_id: string | null;
  notes: string | null;
  due_date: string | null;
  due_at: string | null;
  assignee_user_id: string | null;
  shared: boolean;
  reminder: TaskReminder | null;
  repeat: Record<string, unknown> | null;
  after_done_days: number | null;
  rotation_user_ids: string[] | null;
  source_kind: TaskSourceKind | null;
  source_id: string | null;
  done: boolean;
  done_at: string | null;
  done_by: string | null;
  created_by: string | null;
  updated_by: string | null;
};

/** A draft as the row to write: a date alone, or an instant for a time (FR3-TASK-3, R3-TASK-1). */
export function taskValues(draft: TaskDraft, timeZone: string, userId: string | null): TaskValues {
  const notes = draft.notes.trim();
  return {
    title: draft.title.trim(),
    template_item_id: null,
    notes: notes ? notes.slice(0, TASK_LIMITS.notesLength) : null,
    due_date: draft.due === 'date' ? draft.date : null,
    due_at:
      draft.due === 'time' ? wallInstant(draft.date, draft.minutes, timeZone).toISOString() : null,
    assignee_user_id: draft.assigneeUserId,
    shared: draft.shared,
    reminder: withDue(draft, draft.due).reminder,
    repeat: null,
    after_done_days: null,
    rotation_user_ids: null,
    source_kind: null,
    source_id: null,
    done: false,
    done_at: null,
    done_by: null,
    // The server sets these; the device mirrors them so the row reads right before it syncs.
    created_by: userId,
    updated_by: userId,
  };
}

export type AssigneeRole = 'none' | 'self' | 'parent' | 'helper';

/** `task_created`'s and `task_assigned`'s `assignee_role`: a fixed value, never a name. */
export function assigneeRole(
  assigneeUserId: string | null,
  userId: string | null,
  roleOf: (userId: string) => MemberRole | undefined,
): AssigneeRole {
  if (!assigneeUserId) return 'none';
  if (assigneeUserId === userId) return 'self';
  return roleOf(assigneeUserId) === 'parent' ? 'parent' : 'helper';
}
