import * as Notifications from 'expo-notifications';

import {
  defrostSchedule,
  outsideQuietHours,
  type DefrostReminder,
} from '@/features/notifications/defrost';
import { defrostNotification, reconcileDefrost } from '@/features/notifications/defrost-scheduler';
import { signatureOf } from '@/features/notifications/local-budget';
import type { PlanEntryRow } from '@/features/planner/tables';
import { NEEDS_DEFROSTING_TAG, type RecipeRow } from '@/features/recipes/tables';

jest.mock('@/features/planner/data', () => ({ usePlanRows: jest.fn() }));
jest.mock('@/features/recipes/data', () => ({ useRecipeRows: jest.fn() }));
jest.mock('@/lib/notifications/push', () => ({
  DEFAULT_CHANNEL_ID: 'default',
  readPushPermission: jest.fn(),
}));

const entry = (id: string, date: string, over: Partial<PlanEntryRow> = {}) =>
  ({
    id,
    household_id: 'hh',
    date,
    slot: 'dinner',
    position: 0,
    recipe_id: 'chicken',
    free_text: null,
    servings: 2,
    leftover_of_entry_id: null,
    version: 1,
    created_at: null,
    updated_at: null,
    deleted_at: null,
    ...over,
  }) as PlanEntryRow;
const recipe = (id: string, title: string, tags: string[], over: Partial<RecipeRow> = {}) =>
  ({ id, title, tags, deleted_at: null, ...over }) as unknown as RecipeRow;

const recipes = [
  recipe('chicken', 'Roast chicken', [NEEDS_DEFROSTING_TAG, 'tag.batch_prep']),
  recipe('pasta', 'Pasta', ['tag.quick']),
  recipe('gone', 'Old stew', [NEEDS_DEFROSTING_TAG], { deleted_at: 'x' }),
];
const base = {
  recipes,
  today: '2026-11-18',
  now: new Date(2026, 10, 18, 7, 0),
  quietStartMinute: 21 * 60,
  quietEndMinute: 7 * 60,
};

describe('defrost tonight (FR-NOT-5)', () => {
  it('reminds at 08:00 on the day of a dinner tagged needs-defrosting, naming the meal', () => {
    const [reminder, ...rest] = defrostSchedule({ ...base, entries: [entry('e1', '2026-11-18')] });
    expect(rest).toHaveLength(0);
    expect(reminder).toMatchObject({ id: 'defrost.e1', entryId: 'e1', meal: 'Roast chicken' });
    expect(reminder.fireAt).toEqual(new Date(2026, 10, 18, 8, 0));
  });

  it('skips untagged recipes, other slots, free text, removed entries and removed recipes', () => {
    const entries = [
      entry('pasta', '2026-11-19', { recipe_id: 'pasta' }),
      entry('lunch', '2026-11-19', { slot: 'lunch' }),
      entry('text', '2026-11-19', { recipe_id: null, free_text: 'Chicken' }),
      entry('removed', '2026-11-19', { deleted_at: 'x' }),
      entry('gone', '2026-11-19', { recipe_id: 'gone' }),
    ];
    expect(defrostSchedule({ ...base, entries })).toEqual([]);
  });

  it('looks two weeks ahead, never back, and never at a time already past', () => {
    const entries = [
      entry('yesterday', '2026-11-17'),
      entry('late', '2026-11-18'),
      entry('last', '2026-12-01'),
      entry('beyond', '2026-12-02'),
    ];
    const at9 = new Date(2026, 10, 18, 9, 0);
    expect(defrostSchedule({ ...base, entries, now: at9 }).map((r) => r.entryId)).toEqual(['last']);
  });

  it('moves after quiet hours that cover 08:00 (FR-NOT-6)', () => {
    const [reminder] = defrostSchedule({
      ...base,
      entries: [entry('e1', '2026-11-20')],
      quietStartMinute: 22 * 60,
      quietEndMinute: 9 * 60,
    });
    expect(reminder.fireAt).toEqual(new Date(2026, 10, 20, 9, 0));
    expect(outsideQuietHours(480, 420, 540)).toBe(540);
    expect(outsideQuietHours(480, 600, 600)).toBe(480);
    expect(outsideQuietHours(480, 1260, 420)).toBe(480);
  });
});

describe('scheduling on the device', () => {
  const notifications = jest.mocked(Notifications);
  const text = (r: DefrostReminder) => ({ title: 'Defrost', body: r.meal });
  const [thursday] = defrostSchedule({ ...base, entries: [entry('e1', '2026-11-19')] });
  const [friday] = defrostSchedule({ ...base, entries: [entry('e1', '2026-11-20')] });
  const scheduledAs = (reminder: DefrostReminder) =>
    ({
      identifier: reminder.id,
      content: {
        data: { signature: signatureOf(defrostNotification(reminder, text)) },
      },
    }) as unknown as Notifications.NotificationRequest;

  beforeEach(() => jest.clearAllMocks());

  it('schedules a silent, dated reminder that opens the plan', async () => {
    notifications.getAllScheduledNotificationsAsync.mockResolvedValueOnce([]);
    await reconcileDefrost([thursday], text);
    expect(notifications.scheduleNotificationAsync).toHaveBeenCalledWith({
      identifier: 'defrost.e1',
      content: {
        title: 'Defrost',
        body: 'Roast chicken',
        data: expect.objectContaining({ type: 'defrost', entryId: 'e1', date: '2026-11-19' }),
        categoryIdentifier: 'defrost',
        sound: false,
      },
      trigger: { type: 'date', date: thursday.fireAt, channelId: 'default' },
    });
  });

  it('leaves an unchanged reminder alone', async () => {
    notifications.getAllScheduledNotificationsAsync.mockResolvedValueOnce([scheduledAs(thursday)]);
    await reconcileDefrost([thursday], text);
    expect(notifications.cancelScheduledNotificationAsync).not.toHaveBeenCalled();
    expect(notifications.scheduleNotificationAsync).not.toHaveBeenCalled();
  });

  it('moves the reminder when the entry moves, and cancels it when it goes', async () => {
    notifications.getAllScheduledNotificationsAsync.mockResolvedValueOnce([scheduledAs(thursday)]);
    await reconcileDefrost([friday], text);
    expect(notifications.cancelScheduledNotificationAsync).toHaveBeenCalledWith('defrost.e1');
    expect(notifications.scheduleNotificationAsync).toHaveBeenCalledWith(
      expect.objectContaining({ trigger: expect.objectContaining({ date: friday.fireAt }) }),
    );

    jest.clearAllMocks();
    notifications.getAllScheduledNotificationsAsync.mockResolvedValueOnce([
      scheduledAs(friday),
      {
        identifier: 'something-else',
        content: { data: {} },
      } as unknown as Notifications.NotificationRequest,
    ]);
    await reconcileDefrost([], text);
    expect(notifications.cancelScheduledNotificationAsync).toHaveBeenCalledTimes(1);
    expect(notifications.cancelScheduledNotificationAsync).toHaveBeenCalledWith('defrost.e1');
  });
});
