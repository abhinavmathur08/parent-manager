import {
  assigneeRole,
  canSaveTask,
  newTaskDraft,
  remindersFor,
  taskValues,
  withDue,
} from '@/features/tasks/editor';

const now = new Date('2026-11-18T17:00:00Z');
const zone = 'America/New_York';

describe('task editor rules (FR3-TASK-2, FR3-TASK-3)', () => {
  it('defaults to no due, assigned to anyone for a parent and to themself for a helper', () => {
    expect(newTaskDraft(now, zone, 'me', true)).toMatchObject({
      due: 'none',
      assigneeUserId: null,
      shared: false,
    });
    // A helper's task is always shared (D-25).
    expect(newTaskDraft(now, zone, 'me', false)).toMatchObject({
      assigneeUserId: 'me',
      shared: true,
    });
  });

  it('needs only a title', () => {
    const draft = newTaskDraft(now, zone, 'me', true);
    expect(canSaveTask(draft)).toBe(false);
    expect(canSaveTask({ ...draft, title: '   ' })).toBe(false);
    expect(canSaveTask({ ...draft, title: 'Book the car service' })).toBe(true);
  });

  it('stores a date alone as a date and a time as an instant in the household timezone', () => {
    const draft = { ...newTaskDraft(now, zone, 'me', true), title: ' Bins ', date: '2026-11-20' };
    expect(taskValues({ ...draft, due: 'date' }, zone, 'me')).toMatchObject({
      title: 'Bins',
      due_date: '2026-11-20',
      due_at: null,
      created_by: 'me',
    });
    expect(taskValues({ ...draft, due: 'time', minutes: 18 * 60 }, zone, 'me')).toMatchObject({
      due_date: null,
      due_at: '2026-11-20T23:00:00.000Z',
    });
    // Across the spring-forward change, 18:00 stays 18:00 local (edge cases, spec 3.1).
    expect(
      taskValues({ ...draft, due: 'time', date: '2027-03-15', minutes: 18 * 60 }, zone, 'me')
        .due_at,
    ).toBe('2027-03-15T22:00:00.000Z');
  });

  it('offers reminders only with a due, and "at the time" only with a time (FR3-NOT-1)', () => {
    expect(remindersFor('none')).toEqual([]);
    expect(remindersFor('date')).not.toContain('reminder.at_time');
    const timed = {
      ...newTaskDraft(now, zone, 'me', true),
      due: 'time' as const,
      reminder: 'reminder.at_time' as const,
    };
    expect(withDue(timed, 'date').reminder).toBeNull();
    expect(withDue({ ...timed, reminder: 'reminder.morning' }, 'date').reminder).toBe(
      'reminder.morning',
    );
    expect(taskValues({ ...timed, title: 'x', due: 'none' }, zone, null).reminder).toBeNull();
  });

  it('names the assignee by role only (task_created)', () => {
    const roleOf = (id: string): 'parent' | 'caregiver' =>
      id === 'partner' ? 'parent' : 'caregiver';
    expect(assigneeRole(null, 'me', roleOf)).toBe('none');
    expect(assigneeRole('me', 'me', roleOf)).toBe('self');
    expect(assigneeRole('partner', 'me', roleOf)).toBe('parent');
    expect(assigneeRole('nanny', 'me', roleOf)).toBe('helper');
  });
});
