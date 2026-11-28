import { useCallback } from 'react';

import { track } from '@/lib/analytics';
import { useSyncWriter } from '@/lib/sync';

import type { AssigneeRole } from './editor';
import { isChore, TASKS, type TaskRow } from './tables';

/** `task_*` events' `source`: `manual`, or the source kind's fixed half (`source.event` is `event`). */
export function sourceCode(task: Pick<TaskRow, 'source_kind'>) {
  return (task.source_kind?.slice('source.'.length) ?? 'manual') as
    'manual' | 'plan_entry' | 'grocery_item' | 'event' | 'document' | 'checklist';
}

/**
 * Completing, reopening, assigning and deleting a task through the sync layer, so each works
 * offline and reaches the partner within 2 seconds online (FR3-TASK-6). `done` is the check
 * column, so the server records who completed it and when, and a stale reopen can't undo it
 * (R3-TASK-1, NFR3-OFF-2). Analytics carry fixed values and booleans only.
 */
export function useTaskWrites(userId: string | null) {
  const writer = useSyncWriter();

  const complete = useCallback(
    async (task: TaskRow, wasOverdue: boolean) => {
      await writer.update(TASKS.name, task.id, { done: true });
      track('task_completed', {
        source: sourceCode(task),
        was_overdue: wasOverdue,
        by_assignee: task.assignee_user_id !== null && task.assignee_user_id === userId,
        recurring: isChore(task),
      });
    },
    [writer, userId],
  );

  const reopen = useCallback(
    async (task: TaskRow) => {
      await writer.update(TASKS.name, task.id, { done: false });
      track('task_reopened', { recurring: isChore(task) });
    },
    [writer],
  );

  const assign = useCallback(
    async (
      task: TaskRow,
      assigneeUserId: string | null,
      role: AssigneeRole,
      via: 'chip' | 'detail' | 'take',
    ) => {
      await writer.update(TASKS.name, task.id, { assignee_user_id: assigneeUserId });
      track('task_assigned', { assignee_role: role, via });
    },
    [writer],
  );

  /** The final tombstone, written once the undo bar goes (NFR-REL-5). */
  const remove = useCallback(
    async (task: TaskRow) => {
      await writer.remove(TASKS.name, task.id);
      track('task_deleted', { recurring: isChore(task), scope: 'all' });
    },
    [writer],
  );

  return { complete, reopen, assign, remove };
}
