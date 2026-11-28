import { stableId } from '@/lib/sync/stable-id';
import type { SyncRow, SyncTableDefinition } from '@/lib/sync/types';

/**
 * The tasks tables in the household sync layer (T-01.1, FR3-TASK-6, architecture section 3.6).
 * Plain definitions with no app imports, so the two-device harness can use them too.
 * `sync.ts` registers them with the sync layer.
 */
export const TASKS = {
  name: 'tasks',
  // Parents see every task; helpers only theirs, shared ones and rotations (R3-ACC-1, T-01.2).
  scoped: true,
  columns: {
    title: 'text',
    template_item_id: 'text',
    notes: 'text',
    due_date: 'text',
    due_at: 'text',
    assignee_user_id: 'text',
    shared: 'boolean',
    reminder: 'text',
    repeat: 'json',
    after_done_days: 'integer',
    rotation_user_ids: 'json',
    source_kind: 'text',
    source_id: 'text',
    done: 'boolean',
    done_at: 'text',
    done_by: 'text',
    created_by: 'text',
    updated_by: 'text',
  },
} as const satisfies SyncTableDefinition;

/** A chore's done, skipped or reassigned occurrence (R3-CHORE-1, R3-CHORE-2). */
export const TASK_OCCURRENCES = {
  name: 'task_occurrences',
  scoped: true,
  columns: {
    task_id: 'text',
    original_date: 'text',
    assignee_user_id: 'text',
    skipped: 'boolean',
    done: 'boolean',
    done_at: 'text',
    done_by: 'text',
  },
} as const satisfies SyncTableDefinition;

export const TASK_TABLES = [TASKS, TASK_OCCURRENCES] as const;

/** Reminder choices, stored as identifiers (FR3-NOT-1). */
export const TASK_REMINDERS = [
  'reminder.at_time',
  'reminder.morning',
  'reminder.day_before',
] as const;
export type TaskReminder = (typeof TASK_REMINDERS)[number];

/** What a task was made from (R3-LINK-1): a link, not a foreign key. */
export const TASK_SOURCE_KINDS = [
  'source.plan_entry',
  'source.grocery_item',
  'source.event',
  'source.document',
  'source.checklist',
] as const;
export type TaskSourceKind = (typeof TASK_SOURCE_KINDS)[number];

/** Limits the database checks too. Chore counts and windows are server settings (`tasks.limits`). */
export const TASK_LIMITS = {
  titleLength: 200,
  notesLength: 4000,
} as const;

/** The server's hints when a free household passes the chore cap or sets a rotation (FR3-PAY-1). */
export const CHORE_LIMIT_HINT = 'tasks.chore_limit';
export const ROTATION_PREMIUM_HINT = 'tasks.rotation_premium';

export type TaskRow = SyncRow & {
  /** Null for an unedited checklist item, whose text comes from `template_item_id` (R3-TASK-2). */
  title: string | null;
  template_item_id: string | null;
  notes: string | null;
  /** A date in the household's timezone, `YYYY-MM-DD` (FR3-TASK-3). */
  due_date: string | null;
  /** An instant, shown in the household's timezone. */
  due_at: string | null;
  assignee_user_id: string | null;
  /** Visible to family members and caregivers (D-25). Only parents change it. */
  shared: boolean;
  reminder: TaskReminder | null;
  repeat: Record<string, unknown> | null;
  after_done_days: number | null;
  rotation_user_ids: string[] | null;
  source_kind: TaskSourceKind | null;
  source_id: string | null;
  /** The check column: the server sets `done_at` and `done_by`. */
  done: boolean;
  done_at: string | null;
  done_by: string | null;
  created_by: string | null;
  updated_by: string | null;
};

export type TaskOccurrenceRow = SyncRow & {
  task_id: string;
  /** The occurrence's original date in the household's timezone, `YYYY-MM-DD`. */
  original_date: string;
  assignee_user_id: string | null;
  skipped: boolean;
  done: boolean;
  done_at: string | null;
  done_by: string | null;
};

/** Whether a task is a recurring chore (R3-CHORE-1). */
export function isChore(task: Pick<TaskRow, 'repeat' | 'after_done_days'>): boolean {
  return task.repeat != null || task.after_done_days != null;
}

/**
 * The ID of the row for one occurrence of a chore, the same on every device, so two devices
 * completing the same occurrence offline write one row (R3-CHORE-2).
 */
export function occurrenceId(taskId: string, originalDate: string): string {
  return stableId('task_occurrence', taskId, originalDate);
}
