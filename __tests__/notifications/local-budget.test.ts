import * as Notifications from 'expo-notifications';

import {
  LOCAL_BUDGET,
  resetLocalNotifications,
  setLocalNotifications,
  withinBudget,
  type LocalNotification,
} from '@/features/notifications/local-budget';

jest.mock('@/lib/notifications/push', () => ({ DEFAULT_CHANNEL_ID: 'default' }));

describe('the shared budget of local notifications', () => {
  const notifications = jest.mocked(Notifications);
  const local = (id: string, minute: number): LocalNotification => ({
    id,
    fireAt: new Date(Date.UTC(2026, 10, 25, 0, minute)),
    title: 't',
    body: 'b',
    data: { type: 'x' },
    categoryIdentifier: 'x',
  });

  beforeEach(() => {
    jest.clearAllMocks();
    resetLocalNotifications();
  });

  it('keeps the nearest 60 across every scheduler', () => {
    const events = Array.from({ length: 50 }, (_, i) => local(`event.${i}`, i * 2));
    const defrost = Array.from({ length: 20 }, (_, i) => local(`defrost.${i}`, i * 2 + 1));
    const kept = withinBudget([events, defrost]);
    expect(kept).toHaveLength(LOCAL_BUDGET);
    expect(kept.at(-1)!.fireAt.getTime()).toBeLessThan(Date.UTC(2026, 10, 25, 2, 0));
    expect(kept.filter((n) => n.id.startsWith('defrost.'))).toHaveLength(20);
  });

  it('schedules only what fits, and cancels what no longer does', async () => {
    notifications.getAllScheduledNotificationsAsync.mockResolvedValue([]);
    await setLocalNotifications(
      'defrost.',
      Array.from({ length: 10 }, (_, i) => local(`defrost.${i}`, i)),
    );
    expect(notifications.scheduleNotificationAsync).toHaveBeenCalledTimes(10);

    jest.clearAllMocks();
    // The 10 defrost reminders are on the device; 60 nearer event reminders arrive.
    notifications.getAllScheduledNotificationsAsync.mockResolvedValue(
      Array.from(
        { length: 10 },
        (_, i) =>
          ({
            identifier: `defrost.${i}`,
            content: { data: { signature: 'old' } },
          }) as unknown as Notifications.NotificationRequest,
      ),
    );
    await setLocalNotifications(
      'event.',
      Array.from({ length: 60 }, (_, i) => local(`event.${i}`, -1 - i)),
    );
    expect(notifications.cancelScheduledNotificationAsync).toHaveBeenCalledTimes(10);
    expect(notifications.scheduleNotificationAsync).toHaveBeenCalledTimes(60);
    const ids = notifications.scheduleNotificationAsync.mock.calls.map((c) => c[0].identifier);
    expect(ids.every((id) => id?.startsWith('event.'))).toBe(true);
  });
});
