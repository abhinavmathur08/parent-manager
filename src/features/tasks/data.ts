import { useMemo } from 'react';

import { useSyncedRows } from '@/lib/sync';

import { TASK_OCCURRENCES, TASKS, type TaskOccurrenceRow, type TaskRow } from './tables';

const live = <T extends { deleted_at: string | null }>(rows: readonly T[]) =>
  rows.filter((row) => !row.deleted_at);

/**
 * The household's tasks from the local copy, so they read offline (FR3-TASK-6). Tasks a helper
 * can't see never reach their copy (T-01.2). Tombstones are left out.
 */
export function useTaskRows() {
  const tasks = useSyncedRows<TaskRow>(TASKS.name);
  const occurrences = useSyncedRows<TaskOccurrenceRow>(TASK_OCCURRENCES.name);
  return {
    tasks: useMemo(() => live(tasks.rows), [tasks.rows]),
    occurrences: useMemo(() => live(occurrences.rows), [occurrences.rows]),
    loading: tasks.loading,
  };
}
