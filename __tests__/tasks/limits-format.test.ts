import { DEFAULT_TASK_LIMITS, parseTaskLimits } from '@/features/tasks/limits';
import { formatRelativeDay } from '@/i18n/format';

jest.mock('@/lib/supabase', () => ({ getSupabase: jest.fn() }));

describe('parseTaskLimits (R3-PAY-1)', () => {
  it('reads the server setting, and falls back to the defaults for missing or odd values', () => {
    expect(parseTaskLimits({ free_chores: 0, upcoming_days: 7, done_history_weeks: 4 })).toEqual({
      freeChores: 0,
      upcomingDays: 7,
      doneHistoryWeeks: 4,
    });
    expect(parseTaskLimits({ free_chores: -1, upcoming_days: '7' })).toEqual(DEFAULT_TASK_LIMITS);
    expect(parseTaskLimits(null)).toEqual(DEFAULT_TASK_LIMITS);
  });
});

describe('formatRelativeDay (NFR3-L10N-1)', () => {
  it('names yesterday, today and tomorrow from Intl, and nothing further away', () => {
    expect(formatRelativeDay(0, 'en-US')).toBe('Today');
    expect(formatRelativeDay(1, 'en-GB')).toBe('Tomorrow');
    expect(formatRelativeDay(-1, 'en-AU')).toBe('Yesterday');
    expect(formatRelativeDay(2, 'en-US')).toBeNull();
  });
});
