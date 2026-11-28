import type { TFunction } from 'i18next';

import { routeFor } from '@/features/notifications/inbox';
import {
  taskReminderNotification,
  taskReminderText,
  tasksTodayNotification,
} from '@/features/notifications/task-reminder-scheduler';
import {
  oneOffDues,
  taskReminderSchedule,
  tasksTodaySchedule,
  type TaskScheduleInput,
} from '@/features/notifications/task-reminders';
import type { TaskRow } from '@/features/tasks/tables';

jest.mock('@/lib/notifications/push', () => ({
  DEFAULT_CHANNEL_ID: 'default',
  readPushPermission: jest.fn(),
}));
jest.mock('expo-sqlite/kv-store', () => ({
  __esModule: true,
  default: { getItemSync: () => null, setItemSync: () => undefined },
}));
jest.mock('@/features/tasks/data', () => ({ useTaskRows: jest.fn() }));

const NY = 'America/New_York';

const task = (id: string, over: Partial<TaskRow> = {}): TaskRow =>
  ({
    id,
    household_id: 'hh',
    title: 'Renew the car seat base',
    template_item_id: null,
    notes: 'call the shop',
    due_date: '2026-11-26',
    due_at: null,
    assignee_user_id: 'me',
    shared: false,
    reminder: 'reminder.morning',
    repeat: null,
    after_done_days: null,
    rotation_user_ids: null,
    source_kind: null,
    source_id: null,
    done: false,
    done_at: null,
    done_by: null,
    created_by: 'me',
    updated_by: 'me',
    version: 1,
    created_at: '2026-11-20T00:00:00Z',
    updated_at: '2026-11-20T00:00:00Z',
    deleted_at: null,
    ...over,
  }) as TaskRow;

// Wednesday 25 November 2026, 12:00 in New York.
const NOW = new Date('2026-11-25T17:00:00Z');

const input = (tasks: TaskRow[], over: Partial<TaskScheduleInput> = {}): TaskScheduleInput => ({
  dues: oneOffDues(tasks, NY),
  userId: 'me',
  isParent: true,
  timeZone: NY,
  now: NOW,
  quietStartMinute: 21 * 60,
  quietEndMinute: 7 * 60,
  ...over,
});

describe('which tasks are due (FR3-NOT-1)', () => {
  it('leaves out done, deleted, undated and chore tasks', () => {
    const dues = oneOffDues(
      [
        task('open'),
        task('done', { done: true }),
        task('gone', { deleted_at: '2026-11-21T00:00:00Z' }),
        task('anytime', { due_date: null, reminder: null }),
        task('chore', { repeat: { freq: 'weekly' } }),
      ],
      NY,
    );
    expect(dues.map((d) => d.task.id)).toEqual(['open']);
  });

  it('places a timed task on its day in the household timezone', () => {
    // 02:00 UTC on the 27th is 21:00 on the 26th in New York.
    const [due] = oneOffDues([task('t', { due_date: null, due_at: '2026-11-27T02:00:00Z' })], NY);
    expect(due.date).toBe('2026-11-26');
  });
});

describe('task reminder schedule (FR3-NOT-1)', () => {
  it('fires each offset at its local time, nearest first', () => {
    const schedule = taskReminderSchedule(
      input([
        task('morning'),
        task('evening', { reminder: 'reminder.day_before', due_date: '2026-11-27' }),
        task('timed', {
          reminder: 'reminder.at_time',
          due_date: null,
          due_at: '2026-11-25T20:30:00Z',
        }),
      ]),
    );
    expect(schedule.map((r) => [r.id, r.fireAt.toISOString()])).toEqual([
      ['task.timed', '2026-11-25T20:30:00.000Z'],
      // 09:00 and 18:00 in New York (UTC-5).
      ['task.morning', '2026-11-26T14:00:00.000Z'],
      ['task.evening', '2026-11-26T23:00:00.000Z'],
    ]);
  });

  it("goes to the assignee, or to parents when it's unassigned", () => {
    const tasks = [task('mine'), task('theirs', { assignee_user_id: 'u2' })];
    tasks.push(task('nobody', { assignee_user_id: null }));
    expect(taskReminderSchedule(input(tasks)).map((r) => r.id)).toEqual([
      'task.mine',
      'task.nobody',
    ]);
    expect(taskReminderSchedule(input(tasks, { isParent: false })).map((r) => r.id)).toEqual([
      'task.mine',
    ]);
  });

  it('moves out of quiet hours, and drops a reminder pushed past the due', () => {
    // Quiet until 10:00: the 09:00 reminder goes at 10:00.
    const late = input([task('m')], { quietEndMinute: 10 * 60 });
    expect(taskReminderSchedule(late)[0].fireAt.toISOString()).toBe('2026-11-26T15:00:00.000Z');
    // Quiet from 17:00 to 10:00: "the day before" at 18:00 moves to 10:00 on the day, after a
    // 09:30 due, so it's dropped.
    const dropped = input(
      [
        task('d', {
          reminder: 'reminder.day_before',
          due_date: null,
          due_at: '2026-11-26T14:30:00Z',
        }),
      ],
      { quietStartMinute: 17 * 60, quietEndMinute: 10 * 60 },
    );
    expect(taskReminderSchedule(dropped)).toEqual([]);
  });

  it('keeps "at the time" in quiet hours, and skips what already passed', () => {
    const night = task('n', {
      reminder: 'reminder.at_time',
      due_date: null,
      due_at: '2026-11-26T03:00:00Z',
    });
    expect(taskReminderSchedule(input([night]))).toHaveLength(1);
    expect(taskReminderSchedule(input([task('past', { due_date: '2026-11-25' })]))).toEqual([]);
  });

  it('only schedules two weeks ahead', () => {
    expect(taskReminderSchedule(input([task('far', { due_date: '2026-12-20' })]))).toEqual([]);
  });
});

describe("today's tasks (FR3-NOT-4)", () => {
  const tasks = [
    task('a', { due_date: '2026-11-26' }),
    task('b', { due_date: '2026-11-26', assignee_user_id: null }),
    task('c', { due_date: '2026-11-26', assignee_user_id: 'u2' }),
    task('d', { due_date: '2026-11-28', reminder: null }),
  ];

  it('counts the member’s open tasks due each day, at 08:00, and skips days with none', () => {
    const schedule = tasksTodaySchedule(input(tasks));
    expect(schedule.map((e) => [e.id, e.count, e.fireAt.toISOString()])).toEqual([
      ['tasks_today.2026-11-26', 2, '2026-11-26T13:00:00.000Z'],
      ['tasks_today.2026-11-28', 1, '2026-11-28T13:00:00.000Z'],
    ]);
  });

  it('leaves unassigned tasks out for helpers', () => {
    const schedule = tasksTodaySchedule(input(tasks, { isParent: false }));
    expect(schedule[0].count).toBe(1);
  });

  it('nothing for today once 08:00 has passed, and none with no tasks', () => {
    expect(tasksTodaySchedule(input([task('x', { due_date: '2026-11-25' })]))).toEqual([]);
    expect(tasksTodaySchedule(input([]))).toEqual([]);
  });

  it('carries the count only', () => {
    const t = ((key: string, values?: Record<string, unknown>) =>
      values ? `${key} ${JSON.stringify(values)}` : key) as unknown as TFunction;
    const [entry] = tasksTodaySchedule(input(tasks));
    const n = tasksTodayNotification(entry, t);
    expect(n.body).toBe('notifications.tasksToday.body {"count":2}');
    expect(n.data).toEqual({ type: 'tasks_today', date: '2026-11-26' });
    expect(JSON.stringify(n)).not.toContain('car seat');
    expect(routeFor('tasks_today', n.data)).toBe('/tasks');
  });
});

describe('reminder text (FR3-NOT-2)', () => {
  const t = ((key: string, values?: Record<string, unknown>) =>
    values ? `${key} ${JSON.stringify(values)}` : key) as unknown as TFunction;
  const options = { t, locale: 'en-US', timeZone: NY, details: false };
  const [timed] = taskReminderSchedule(
    input([
      task('t', {
        reminder: 'reminder.day_before',
        due_date: null,
        due_at: '2026-11-26T20:00:00Z',
      }),
    ]),
  );

  it('says a task is due and when, with no title or notes by default', () => {
    const text = taskReminderText(timed, options);
    expect(text.title).toBe('notifications.task.title');
    expect(text.body).toContain('notifications.task.dueTomorrowAt');
    expect(text.body).toContain('3:00');
    expect(JSON.stringify(text)).not.toMatch(/car seat|call the shop/);
  });

  it('adds the title, never notes, when details are on', () => {
    const text = taskReminderText(timed, { ...options, details: true });
    expect(text.title).toBe('Renew the car seat base');
    expect(JSON.stringify(text)).not.toContain('call the shop');
  });

  it('carries IDs only and opens the task', () => {
    const n = taskReminderNotification(timed, taskReminderText(timed, options));
    expect(n.data).toEqual({ type: 'task_reminder', task_id: 't' });
    expect(n.categoryIdentifier).toBe('task_reminder');
    expect(routeFor('task_reminder', n.data)).toEqual({
      pathname: '/tasks/[id]',
      params: { id: 't' },
    });
  });
});
