import {
  choreMode,
  expandChore,
  nextAssignee,
  nextOpenOccurrence,
  type ChoreContext,
} from '@/features/tasks/chores';
import { occurrenceId, type TaskOccurrenceRow, type TaskRow } from '@/features/tasks/tables';
import { buildTaskView } from '@/features/tasks/view';

const task = (over: Partial<TaskRow> = {}): TaskRow => ({
  id: 'chore',
  household_id: 'hh',
  version: 1,
  created_at: '2026-11-01T00:00:00Z',
  updated_at: null,
  deleted_at: null,
  title: 'chore',
  template_item_id: null,
  notes: null,
  due_date: '2026-11-02',
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

const row = (date: string, over: Partial<TaskOccurrenceRow> = {}): TaskOccurrenceRow => ({
  id: occurrenceId('chore', date),
  household_id: 'hh',
  version: 1,
  created_at: null,
  updated_at: null,
  deleted_at: null,
  task_id: 'chore',
  original_date: date,
  assignee_user_id: null,
  skipped: false,
  done: false,
  done_at: null,
  done_by: null,
  ...over,
});

const done = (date: string, by: string | null = null, at = `${date}T15:00:00Z`) =>
  row(date, { done: true, done_by: by, done_at: at });

// Wednesday 2026-11-18 in New York.
const ctx: ChoreContext = { timeZone: 'America/New_York', weekStart: 1, today: '2026-11-18' };
// Mondays and Thursdays from Monday 2026-11-02.
const monThu = task({ repeat: { freq: 'weekly', weekdays: [1, 4] } });
const everyThree = task({ after_done_days: 3 });
const dates = (list: { originalDate: string }[]) => list.map((o) => o.originalDate);

describe('choreMode (FR3-CHORE-1)', () => {
  it('reads both modes, and nothing for a one-off task or an unreadable rule', () => {
    expect(choreMode(monThu)).toBe('schedule');
    expect(choreMode(everyThree)).toBe('after_done');
    expect(choreMode(task())).toBeNull();
    expect(choreMode(task({ repeat: { freq: 'hourly' } }))).toBeNull();
  });
});

describe('nextOpenOccurrence on a schedule (FR3-CHORE-2)', () => {
  it('collapses missed occurrences into the latest one on or before today', () => {
    // Nothing done since 2 November: only Monday the 16th shows, as overdue.
    const open = nextOpenOccurrence(monThu, [], ctx);
    expect(open).toMatchObject({
      originalDate: '2026-11-16',
      status: 'open',
      id: occurrenceId('chore', '2026-11-16'),
    });
  });

  it('brings up the next one once the open one is done or skipped', () => {
    expect(nextOpenOccurrence(monThu, [done('2026-11-16')], ctx)?.originalDate).toBe('2026-11-19');
    const skipped = row('2026-11-16', { skipped: true });
    expect(nextOpenOccurrence(monThu, [skipped], ctx)?.originalDate).toBe('2026-11-19');
  });

  it('shows today rather than a missed one before it', () => {
    const daily = task({ repeat: { freq: 'daily' } });
    expect(nextOpenOccurrence(daily, [done('2026-11-15')], ctx)?.originalDate).toBe('2026-11-18');
  });

  it('moves on past an occurrence done early', () => {
    expect(nextOpenOccurrence(monThu, [done('2026-11-19')], ctx)?.originalDate).toBe('2026-11-23');
  });

  it('keeps a reassigned occurrence open, for its new assignee only', () => {
    const reassigned = row('2026-11-16', { assignee_user_id: 'sam' });
    const open = nextOpenOccurrence(
      task({ ...monThu, assignee_user_id: 'alex' }),
      [reassigned],
      ctx,
    );
    expect(open).toMatchObject({
      originalDate: '2026-11-16',
      assigneeUserId: 'sam',
      row: reassigned,
    });
    const after = nextOpenOccurrence(
      task({ ...monThu, assignee_user_id: 'alex' }),
      [reassigned, done('2026-11-16', 'sam')],
      ctx,
    );
    expect(after?.assigneeUserId).toBe('alex');
  });

  it('ignores other chores’ rows and tombstones', () => {
    const other = { ...done('2026-11-16'), task_id: 'other' };
    const gone = { ...done('2026-11-16'), deleted_at: '2026-11-17T00:00:00Z' };
    expect(nextOpenOccurrence(monThu, [other, gone], ctx)?.originalDate).toBe('2026-11-16');
  });

  it('ends with the rule: after a count or an until date', () => {
    const counted = task({ repeat: { freq: 'weekly', weekdays: [1], count: 3 } });
    // 2, 9 and 16 November.
    expect(nextOpenOccurrence(counted, [done('2026-11-16')], ctx)).toBeNull();
    expect(nextOpenOccurrence(counted, [done('2026-11-09')], ctx)?.originalDate).toBe('2026-11-16');
    const until = task({ repeat: { freq: 'daily', until: '2026-11-20' } });
    expect(nextOpenOccurrence(until, [done('2026-11-20')], ctx)).toBeNull();
  });

  it('starts at the first due when that is in the future', () => {
    const later = task({ due_date: '2026-12-01', repeat: { freq: 'monthly' } });
    expect(nextOpenOccurrence(later, [], ctx)?.originalDate).toBe('2026-12-01');
  });

  it('keeps "every 2 weeks" on the household’s weeks', () => {
    const fortnightly = task({
      repeat: { freq: 'weekly', interval: 2, weekdays: [3] },
      due_date: '2026-11-04',
    });
    expect(nextOpenOccurrence(fortnightly, [done('2026-11-18')], ctx)?.originalDate).toBe(
      '2026-12-02',
    );
  });
});

describe('nextOpenOccurrence after it’s done (FR3-CHORE-1)', () => {
  it('starts at the first due', () => {
    expect(nextOpenOccurrence(everyThree, [], ctx)?.originalDate).toBe('2026-11-02');
  });

  it('comes N days after the last completion, in the household’s timezone', () => {
    // Done at 22:00 on the 10th in New York, which is the 11th in UTC.
    const late = done('2026-11-02', 'alex', '2026-11-11T03:00:00Z');
    expect(nextOpenOccurrence(everyThree, [late], ctx)?.originalDate).toBe('2026-11-13');
  });

  it('never lands on or before the occurrence just done, even when done early', () => {
    const early = task({ after_done_days: 1, due_date: '2026-11-20' });
    expect(
      nextOpenOccurrence(early, [done('2026-11-20', 'alex', '2026-11-15T15:00:00Z')], ctx)
        ?.originalDate,
    ).toBe('2026-11-21');
  });

  it('counts a skip from when it was skipped, and a write not yet synced from today', () => {
    const skipped = row('2026-11-02', { skipped: true, updated_at: '2026-11-05T15:00:00Z' });
    expect(nextOpenOccurrence(everyThree, [skipped], ctx)?.originalDate).toBe('2026-11-08');
    const pending = row('2026-11-02', { done: true });
    expect(nextOpenOccurrence(everyThree, [pending], ctx)?.originalDate).toBe('2026-11-21');
  });
});

describe('rotation (FR3-CHORE-4, R3-CHORE-3, D-26)', () => {
  const rotating = task({ ...monThu, rotation_user_ids: ['alex', 'sam', 'jo'] });

  it('starts with the chore’s assignee if they take turns, else the first member', () => {
    expect(nextAssignee(rotating, [])).toBe('alex');
    expect(nextAssignee({ ...rotating, assignee_user_id: 'sam' }, [])).toBe('sam');
    expect(nextAssignee({ ...rotating, assignee_user_id: 'former' }, [])).toBe('alex');
  });

  it('goes to the member after whoever did the last one, wrapping round', () => {
    expect(nextAssignee(rotating, [done('2026-11-12', 'alex')])).toBe('sam');
    expect(nextAssignee(rotating, [done('2026-11-12', 'alex'), done('2026-11-16', 'jo')])).toBe(
      'alex',
    );
  });

  it('keeps the turn when an occurrence is skipped', () => {
    const rows = [done('2026-11-12', 'alex'), row('2026-11-16', { skipped: true })];
    expect(nextAssignee(rotating, rows)).toBe('sam');
  });

  it('follows whoever did a reassigned occurrence', () => {
    // Sam's turn, reassigned to and done by Jo: Alex is next.
    const rows = [row('2026-11-16', { assignee_user_id: 'jo', done: true, done_by: 'jo' })];
    expect(nextAssignee(rotating, rows)).toBe('alex');
  });

  it('falls back to whom it was for when someone outside the rotation did it', () => {
    const rows = [row('2026-11-16', { assignee_user_id: 'sam', done: true, done_by: 'nanny' })];
    expect(nextAssignee(rotating, rows)).toBe('jo');
  });

  it('turns after a late completion', () => {
    // Alex's Thursday 12th was missed; it collapsed into Monday 16th, still Alex's turn.
    const before = nextOpenOccurrence(rotating, [], ctx);
    expect(before).toMatchObject({ originalDate: '2026-11-16', assigneeUserId: 'alex' });
    // Alex does it late, on Wednesday: Thursday's is Sam's.
    const late = done('2026-11-16', 'alex', '2026-11-18T20:00:00Z');
    expect(nextOpenOccurrence(rotating, [late], ctx)).toMatchObject({
      originalDate: '2026-11-19',
      assigneeUserId: 'sam',
    });
  });

  it('turns in order across the expanded weeks, keeping a reassigned one to itself', () => {
    const rows = [done('2026-11-16', 'alex'), row('2026-11-23', { assignee_user_id: 'alex' })];
    const list = expandChore(rotating, rows, { ...ctx, from: '2026-11-16', to: '2026-11-30' });
    expect(list.map((o) => [o.originalDate, o.status, o.assigneeUserId])).toEqual([
      ['2026-11-16', 'done', 'alex'],
      ['2026-11-19', 'open', 'sam'],
      ['2026-11-23', 'open', 'alex'],
      ['2026-11-26', 'open', 'alex'],
      ['2026-11-30', 'open', 'sam'],
    ]);
  });
});

describe('expandChore (R3-CHORE-1)', () => {
  it('lists done and skipped ones, then the open one onwards, leaving out missed ones', () => {
    const rows = [done('2026-11-05'), row('2026-11-09', { skipped: true })];
    const list = expandChore(monThu, rows, { ...ctx, from: '2026-11-01', to: '2026-11-26' });
    expect(list.map((o) => [o.originalDate, o.status])).toEqual([
      ['2026-11-05', 'done'],
      ['2026-11-09', 'skipped'],
      ['2026-11-16', 'open'],
      ['2026-11-19', 'open'],
      ['2026-11-23', 'open'],
      ['2026-11-26', 'open'],
    ]);
  });

  it('projects an after-done chore every N days from its next occurrence', () => {
    const list = expandChore(everyThree, [done('2026-11-02', null, '2026-11-17T15:00:00Z')], {
      ...ctx,
      from: '2026-11-18',
      to: '2026-11-30',
    });
    expect(dates(list)).toEqual(['2026-11-20', '2026-11-23', '2026-11-26', '2026-11-29']);
  });

  it('returns nothing for a task that doesn’t repeat or an empty range', () => {
    expect(expandChore(task(), [], { ...ctx, from: '2026-11-01', to: '2026-11-30' })).toEqual([]);
    expect(expandChore(monThu, [], { ...ctx, from: '2026-11-30', to: '2026-11-01' })).toEqual([]);
  });
});

describe('daylight-saving changes keep the wall time (US, GB and AU)', () => {
  const cases = [
    // Clocks go back on 1 November in New York: 18:00 is 22:00Z, then 23:00Z.
    ['America/New_York', '2026-10-30T22:00:00Z', '2026-10-31', '2026-11-02', ['22', '23', '23']],
    // Back on 25 October in London: 18:00 is 17:00Z, then 18:00Z.
    ['Europe/London', '2026-10-23T17:00:00Z', '2026-10-24', '2026-10-26', ['17', '18', '18']],
    // Forward on 4 October in Sydney: 18:00 is 08:00Z, then 07:00Z.
    ['Australia/Sydney', '2026-10-02T08:00:00Z', '2026-10-03', '2026-10-05', ['08', '07', '07']],
  ] as const;

  it.each(cases)('a daily 18:00 chore in %s', (timeZone, dueAt, from, to, hours) => {
    const daily = task({ due_date: null, due_at: dueAt, repeat: { freq: 'daily' } });
    const list = expandChore(daily, [], { timeZone, weekStart: 1, today: from, from, to });
    expect(list.map((o) => o.dueAt?.slice(11, 13))).toEqual(hours);
    expect(dates(list)).toEqual([from, expect.any(String), to]);
  });

  it('keeps a dated chore on its dates across the change', () => {
    const daily = task({ due_date: '2026-10-31', repeat: { freq: 'daily' } });
    const list = expandChore(daily, [], {
      ...ctx,
      today: '2026-10-31',
      from: '2026-10-31',
      to: '2026-11-02',
    });
    expect(list.map((o) => [o.originalDate, o.dueAt])).toEqual([
      ['2026-10-31', null],
      ['2026-11-01', null],
      ['2026-11-02', null],
    ]);
  });
});

describe('the Tasks tab shows a chore once, at its next open occurrence (FR3-CHORE-2)', () => {
  const options = {
    filter: { kind: 'everyone' } as const,
    userId: 'sam',
    timeZone: 'America/New_York',
    now: new Date('2026-11-18T17:00:00Z'),
    upcomingDays: 14,
    weekStart: 1 as const,
  };
  const rotating = task({ ...monThu, rotation_user_ids: ['alex', 'sam'] });

  it('places it on its open occurrence, with that occurrence’s assignee', () => {
    const missed = buildTaskView([rotating], options);
    expect(missed.overdue.map((item) => [item.date, item.assigneeUserId])).toEqual([
      ['2026-11-16', 'alex'],
    ]);
    const view = buildTaskView([rotating], {
      ...options,
      occurrences: [done('2026-11-16', 'alex')],
    });
    expect(view.overdue).toEqual([]);
    expect(view.upcoming.map((day) => [day.date, day.items[0].assigneeUserId])).toEqual([
      ['2026-11-19', 'sam'],
    ]);
  });

  it('filters by the occurrence’s assignee', () => {
    const rows = [done('2026-11-16', 'alex')];
    const mine = buildTaskView([rotating], {
      ...options,
      occurrences: rows,
      filter: { kind: 'mine' },
    });
    expect(mine.total).toBe(1);
    const alex = buildTaskView([rotating], {
      ...options,
      occurrences: rows,
      filter: { kind: 'member', userId: 'alex' },
    });
    expect(alex.total).toBe(0);
  });

  it('counts a chore whose rule has ended as done', () => {
    const ended = task({ repeat: { freq: 'weekly', weekdays: [1], count: 1 } });
    const view = buildTaskView([ended], { ...options, occurrences: [done('2026-11-02')] });
    expect(view.done.map((item) => item.done)).toEqual([true]);
  });
});

describe('performance (NFR3-PERF-2)', () => {
  it('expands 30 chores for 12 weeks within 50 ms', () => {
    const rotation = ['alex', 'sam', 'jo'];
    const chores = Array.from({ length: 30 }, (_, i) =>
      task({
        id: `chore-${i}`,
        due_date: i % 3 === 0 ? null : '2026-09-01',
        due_at: i % 3 === 0 ? '2026-09-01T22:00:00Z' : null,
        repeat:
          i % 5 === 4 ? null : i % 2 ? { freq: 'daily' } : { freq: 'weekly', weekdays: [1, 3, 5] },
        after_done_days: i % 5 === 4 ? 4 : null,
        rotation_user_ids: i % 4 === 0 ? rotation : null,
      }),
    );
    const rows = chores.flatMap((chore) =>
      ['2026-11-02', '2026-11-09', '2026-11-16'].map((date) => ({
        ...done(date, 'alex'),
        id: occurrenceId(chore.id, date),
        task_id: chore.id,
      })),
    );
    const range = { ...ctx, from: '2026-11-16', to: '2027-02-07' };
    const run = () => chores.flatMap((chore) => expandChore(chore, rows, range));
    // The best of a few runs, so a busy CI machine doesn't fail it.
    const times = Array.from({ length: 5 }, () => {
      const start = performance.now();
      run();
      return performance.now() - start;
    });
    expect(Math.min(...times)).toBeLessThan(50);
    expect(run().length).toBeGreaterThan(30 * 12);
  });
});
