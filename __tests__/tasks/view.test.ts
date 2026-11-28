import type { TaskRow } from '@/features/tasks/tables';
import { buildTaskView, dueDate, type TaskViewOptions } from '@/features/tasks/view';

const task = (id: string, over: Partial<TaskRow> = {}): TaskRow => ({
  id,
  household_id: 'hh',
  version: 1,
  created_at: `2026-11-01T00:00:0${id.length % 10}Z`,
  updated_at: null,
  deleted_at: null,
  title: id,
  template_item_id: null,
  notes: null,
  due_date: null,
  due_at: null,
  assignee_user_id: null,
  shared: false,
  reminder: null,
  repeat: null,
  after_done_days: null,
  rotation_user_ids: null,
  source_kind: null,
  source_id: null,
  done: false,
  done_at: null,
  done_by: null,
  created_by: null,
  updated_by: null,
  ...over,
});

// Wednesday 2026-11-18, 12:00 in New York.
const options: TaskViewOptions = {
  filter: { kind: 'everyone' },
  userId: 'me',
  timeZone: 'America/New_York',
  now: new Date('2026-11-18T17:00:00Z'),
  upcomingDays: 14,
};
const ids = (items: { task: TaskRow }[]) => items.map((item) => item.task.id);

describe('buildTaskView (S-44, FR3-TASK-1)', () => {
  const tasks = [
    task('anytime'),
    task('yesterday', { due_date: '2026-11-17' }),
    task('today-date', { due_date: '2026-11-18' }),
    task('today-past-time', { due_at: '2026-11-18T14:00:00Z' }),
    task('today-later', { due_at: '2026-11-18T23:00:00Z' }),
    task('friday', { due_date: '2026-11-20' }),
    task('in-14-days', { due_date: '2026-12-02' }),
    task('in-15-days', { due_date: '2026-12-03' }),
    task('done', { due_date: '2026-11-10', done: true, done_at: '2026-11-11T00:00:00Z' }),
    task('deleted', { deleted_at: '2026-11-12T00:00:00Z' }),
  ];

  it('groups open tasks as Overdue, Today, Upcoming by day, Later and Anytime, with Done apart', () => {
    const view = buildTaskView(tasks, options);
    expect(ids(view.overdue)).toEqual(['yesterday', 'today-past-time']);
    expect(ids(view.today)).toEqual(['today-date', 'today-later']);
    expect(view.upcoming.map((day) => day.date)).toEqual(['2026-11-20', '2026-12-02']);
    expect(view.later.map((day) => day.date)).toEqual(['2026-12-03']);
    expect(ids(view.anytime)).toEqual(['anytime']);
    expect(ids(view.done)).toEqual(['done']);
    expect(view.total).toBe(9);
  });

  it('reads a due time as a day in the household timezone (FR3-TASK-3)', () => {
    // 03:00 UTC on the 19th is still the 18th in New York, and already the 19th in Sydney.
    const late = { due_date: null, due_at: '2026-11-19T03:00:00Z' };
    expect(dueDate(late, 'America/New_York')).toBe('2026-11-18');
    expect(dueDate(late, 'Australia/Sydney')).toBe('2026-11-19');
  });

  it('takes the Upcoming range from the server setting (R3-PAY-1)', () => {
    const view = buildTaskView(tasks, { ...options, upcomingDays: 3 });
    expect(view.upcoming.map((day) => day.date)).toEqual(['2026-11-20']);
    expect(view.later.map((day) => day.date)).toEqual(['2026-12-02', '2026-12-03']);
  });

  it('filters to mine, or to one member', () => {
    const assigned = [
      task('mine', { assignee_user_id: 'me' }),
      task('theirs', { assignee_user_id: 'sam' }),
      task('nobody'),
    ];
    expect(ids(buildTaskView(assigned, { ...options, filter: { kind: 'mine' } }).anytime)).toEqual([
      'mine',
    ]);
    expect(
      ids(
        buildTaskView(assigned, { ...options, filter: { kind: 'member', userId: 'sam' } }).anytime,
      ),
    ).toEqual(['theirs']);
  });

  it('orders by due, then creation and ID, never by title', () => {
    const view = buildTaskView(
      [
        task('b', { title: 'Alpha', due_date: '2026-11-20', created_at: '2026-11-02T00:00:00Z' }),
        task('a', { title: 'Zulu', due_date: '2026-11-20', created_at: '2026-11-01T00:00:00Z' }),
      ],
      options,
    );
    expect(ids(view.upcoming[0].items)).toEqual(['a', 'b']);
  });

  it('groups 1,000 tasks quickly (NFR3-PERF-1)', () => {
    const many = Array.from({ length: 1000 }, (_, i) =>
      task(`t${i}`, {
        due_date: i % 3 ? `2026-11-${String(10 + (i % 20)).padStart(2, '0')}` : null,
      }),
    );
    const start = performance.now();
    buildTaskView(many, options);
    expect(performance.now() - start).toBeLessThan(100);
  });
});
