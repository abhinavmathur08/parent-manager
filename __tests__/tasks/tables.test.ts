import { isChore, occurrenceId, TASK_OCCURRENCES, TASKS } from '@/features/tasks/tables';

describe('tasks tables (T-01.1)', () => {
  it('names an occurrence by its chore and date, the same on every device (R3-CHORE-2)', () => {
    const task = '6d1f0b6c-2f5e-4a39-9d55-3c1f1f8f2a10';
    expect(occurrenceId(task, '2026-12-01')).toBe(occurrenceId(task, '2026-12-01'));
    expect(occurrenceId(task, '2026-12-01')).not.toBe(occurrenceId(task, '2026-12-08'));
    expect(occurrenceId(task, '2026-12-01')).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-8[0-9a-f]{3}-/);
  });

  it('treats a repeat rule or an "after done" interval as a chore (R3-CHORE-1)', () => {
    expect(isChore({ repeat: null, after_done_days: null })).toBe(false);
    expect(isChore({ repeat: { freq: 'daily' }, after_done_days: null })).toBe(true);
    expect(isChore({ repeat: null, after_done_days: 30 })).toBe(true);
  });

  it('syncs `done` with who and when on both tables (R3-TASK-1)', () => {
    for (const table of [TASKS, TASK_OCCURRENCES]) {
      expect(table.columns).toMatchObject({ done: 'boolean', done_at: 'text', done_by: 'text' });
    }
  });
});
