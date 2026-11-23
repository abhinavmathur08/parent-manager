import {
  cachedPrefs,
  dayBefore,
  DEFAULT_PREFS,
  fetchPrefs,
  savePrefs,
} from '@/features/notifications/prefs';
import { formatMinute, formatWeekday } from '@/features/notifications/times';

let mockRow: Record<string, unknown> | null = null;
let mockError: Error | null = null;
const mockUpsert = jest.fn(async (..._args: unknown[]) => ({ error: mockError }));
jest.mock('@/lib/supabase', () => ({
  getSupabase: () => ({
    from: () => ({
      select: () => ({
        eq: () => ({ maybeSingle: async () => ({ data: mockRow, error: mockError }) }),
      }),
      upsert: (...args: unknown[]) => mockUpsert(...args),
    }),
  }),
}));
const mockStore = new Map<string, string>();
jest.mock('expo-sqlite/kv-store', () => ({
  __esModule: true,
  default: {
    getItemSync: (key: string) => mockStore.get(key) ?? null,
    setItemSync: (key: string, value: string) => mockStore.set(key, value),
  },
}));

beforeEach(() => {
  jest.clearAllMocks();
  mockStore.clear();
  mockRow = null;
  mockError = null;
});

describe('notification settings (FR-NOT-3, FR-NOT-6, FR-NOT-7)', () => {
  it('defaults to every type on, 18:00 the day before, quiet 21:00-07:00', async () => {
    expect(await fetchPrefs('u1')).toEqual(DEFAULT_PREFS);
    expect(DEFAULT_PREFS).toMatchObject({
      plan_week: true,
      list_ready: true,
      defrost: true,
      household_changes: true,
      calendar_reminders: true,
      event_changes: true,
      who_taking: true,
      document_expiry: true,
      planWeekDay: null,
      planWeekMinute: 1080,
      quietStartMinute: 1260,
      quietEndMinute: 420,
    });
  });

  it('reads the saved row and keeps a copy for offline use', async () => {
    mockRow = {
      plan_week: false,
      list_ready: true,
      defrost: false,
      household_changes: true,
      calendar_reminders: false,
      event_changes: false,
      who_taking: true,
      document_expiry: false,
      plan_week_day: 5,
      plan_week_minute: 600,
      quiet_start_minute: 1320,
      quiet_end_minute: 360,
    };
    const prefs = await fetchPrefs('u1');
    expect(prefs).toMatchObject({
      plan_week: false,
      defrost: false,
      calendar_reminders: false,
      planWeekDay: 5,
    });
    expect(cachedPrefs('u1')).toEqual(prefs);
    expect(cachedPrefs('someone-else')).toEqual(DEFAULT_PREFS);
  });

  it('saves the whole row for the user', async () => {
    await savePrefs('u1', { ...DEFAULT_PREFS, list_ready: false, quietStartMinute: 1200 });
    expect(mockUpsert).toHaveBeenCalledWith(
      {
        user_id: 'u1',
        plan_week: true,
        list_ready: false,
        defrost: true,
        household_changes: true,
        calendar_reminders: true,
        event_changes: true,
        who_taking: true,
        document_expiry: true,
        plan_week_day: null,
        plan_week_minute: 1080,
        quiet_start_minute: 1200,
        quiet_end_minute: 420,
      },
      { onConflict: 'user_id' },
    );
    expect(cachedPrefs('u1').list_ready).toBe(false);
  });

  it('keeps the cache when the server refuses', async () => {
    mockError = new Error('offline');
    await expect(savePrefs('u1', { ...DEFAULT_PREFS, defrost: false })).rejects.toThrow();
    expect(cachedPrefs('u1').defrost).toBe(true);
  });

  it('puts the reminder the day before the week starts', () => {
    expect(dayBefore(7)).toBe(6);
    expect(dayBefore(1)).toBe(7);
  });
});

describe('times and days in the locale', () => {
  it('uses the locale clock', () => {
    expect(formatMinute(1080, 'en-US')).toBe('6:00 PM');
    expect(formatMinute(1080, 'en-GB')).toBe('18:00');
    expect(formatMinute(420, 'en-AU')).toMatch(/^7:00\sam$/i);
  });

  it('names ISO weekdays', () => {
    expect(formatWeekday(1, 'en-US')).toBe('Monday');
    expect(formatWeekday(6, 'en-GB')).toBe('Saturday');
    expect(formatWeekday(7, 'en-US')).toBe('Sunday');
  });
});
