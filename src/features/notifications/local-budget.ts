import * as Notifications from 'expo-notifications';

import { DEFAULT_CHANNEL_ID } from '@/lib/notifications/push';

/**
 * iOS keeps at most 64 pending local notifications per app, so every local scheduler ("defrost
 * tonight" and event reminders) shares a budget of 60, nearest first (architecture
 * "Notifications"). What doesn't fit now is scheduled on a later refill (start, foreground,
 * sync), once nearer ones have fired.
 */
export const LOCAL_BUDGET = 60;

/** One local notification a scheduler wants on the device. */
export type LocalNotification = {
  /** The identifier, starting with the scheduler's prefix. */
  id: string;
  fireAt: Date;
  title: string;
  body: string;
  /** IDs and fixed values for the tap handler; `type` names the notification type. */
  data: Record<string, string | number>;
  /** The category offering "turn off this type" (FR-NOT-7). */
  categoryIdentifier: string;
};

// What each scheduler (by ID prefix) last asked for.
const wanted = new Map<string, readonly LocalNotification[]>();

/** Changes when anything shown or sent changes, so an unchanged notification is left alone. */
export const signatureOf = (n: LocalNotification) =>
  JSON.stringify([n.fireAt.getTime(), n.title, n.body, n.categoryIdentifier, n.data]);

/** The notifications that fit the budget: the nearest first, ties by ID so every run agrees. */
export function withinBudget(
  lists: Iterable<readonly LocalNotification[]>,
  budget = LOCAL_BUDGET,
): LocalNotification[] {
  return [...lists]
    .flat()
    .sort((a, b) => a.fireAt.getTime() - b.fireAt.getTime() || a.id.localeCompare(b.id))
    .slice(0, budget);
}

async function reconcile(): Promise<void> {
  const prefixes = [...wanted.keys()];
  const desired = new Map(withinBudget(wanted.values()).map((n) => [n.id, n]));
  const scheduled = (await Notifications.getAllScheduledNotificationsAsync()).filter((n) =>
    prefixes.some((prefix) => n.identifier.startsWith(prefix)),
  );
  for (const existing of scheduled) {
    const want = desired.get(existing.identifier);
    if (want && existing.content.data?.signature === signatureOf(want)) {
      desired.delete(existing.identifier);
    } else {
      await Notifications.cancelScheduledNotificationAsync(existing.identifier);
    }
  }
  for (const n of desired.values()) {
    await Notifications.scheduleNotificationAsync({
      identifier: n.id,
      content: {
        title: n.title,
        body: n.body,
        data: { ...n.data, signature: signatureOf(n) },
        categoryIdentifier: n.categoryIdentifier,
        // Nothing plays a sound (FR-NOT-6).
        sound: false,
      },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.DATE,
        date: n.fireAt,
        channelId: DEFAULT_CHANNEL_ID,
      },
    });
  }
}

// One reconcile at a time, so two schedulers changing together never double-schedule.
let queue: Promise<void> = Promise.resolve();

/**
 * Replaces what the scheduler with `prefix` wants on the device, then makes the device's
 * scheduled notifications for every known scheduler match the shared budget. Other scheduled
 * notifications are left alone. An empty list cancels the scheduler's own.
 */
export function setLocalNotifications(
  prefix: string,
  list: readonly LocalNotification[],
): Promise<void> {
  wanted.set(prefix, list);
  queue = queue.then(reconcile, reconcile);
  return queue;
}

/** For tests: forget every scheduler's list. */
export function resetLocalNotifications(): void {
  wanted.clear();
}
