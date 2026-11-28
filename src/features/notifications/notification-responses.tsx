import * as Notifications from 'expo-notifications';
import { router } from 'expo-router';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';

import { track } from '@/lib/analytics';

import { markRead, routeFor } from './inbox';
import { fetchPrefs, savePrefs, type NotificationType } from './prefs';

/** The "turn off this type" action on a notification (FR-NOT-7). */
export const TURN_OFF_ACTION = 'turn_off';

/**
 * Notifications that offer "turn off this type", by category (the push's `categoryId`, which is
 * the notification's type), and the setting each turns off.
 */
const CATEGORIES = new Map<string, NotificationType>([
  ['plan_week', 'plan_week'],
  ['list_ready', 'list_ready'],
  ['defrost', 'defrost'],
  ['calendar_reminders', 'calendar_reminders'],
  ['event_changed', 'event_changes'],
  ['who_taking', 'who_taking'],
  ['document_expiring', 'document_expiry'],
  ['task_reminder', 'task_reminders'],
  ['task_assigned', 'task_assigned'],
  ['tasks_today', 'tasks_today'],
]);

// A response is handled once, even if the component mounts again.
const handled = new Set<string>();

const settingOf = (value: unknown): NotificationType | null =>
  (typeof value === 'string' && CATEGORIES.get(value)) || null;

/** Where a tapped notification goes. Local ones (N-02.2) can name their own screen. */
export type ResponseRoute = (data: Record<string, unknown>) => ReturnType<typeof routeFor>;

/**
 * Handles taps on notifications (FR-NOT-7, FR-NOT-8), including the one that launched the
 * app: "turn off this type" turns the type off on the server; a plain tap marks the inbox
 * entry read on every device and opens the related screen.
 */
export async function handleResponse(
  response: Notifications.NotificationResponse,
  userId: string,
  routeOf: ResponseRoute = (data) => routeFor(String(data.type), data, 'push'),
): Promise<void> {
  const key = `${response.notification.request.identifier}:${response.actionIdentifier}`;
  if (handled.has(key)) return;
  handled.add(key);
  const data = (response.notification.request.content.data ?? {}) as Record<string, unknown>;
  const type = data.type;

  if (response.actionIdentifier === TURN_OFF_ACTION) {
    const setting = settingOf(type);
    if (!setting) return;
    const prefs = await fetchPrefs(userId);
    await savePrefs(userId, { ...prefs, [setting]: false });
    track('notification_type_toggled', { type: setting, enabled: false, surface: 'notification' });
    return;
  }

  if (typeof data.notificationId === 'string') {
    void markRead([data.notificationId]).catch(() => undefined);
  }
  if (typeof type === 'string' && /^[a-z_]+$/.test(type)) {
    track('notification_opened', { type });
  }
  const route = routeOf(data);
  if (route) router.navigate(route);
}

/** Mounted for signed-in members: registers the categories and handles taps. */
export function NotificationResponses({ userId }: { userId: string }) {
  const { t } = useTranslation();
  const last = Notifications.useLastNotificationResponse();

  useEffect(() => {
    for (const type of CATEGORIES.keys()) {
      Notifications.setNotificationCategoryAsync(type, [
        {
          identifier: TURN_OFF_ACTION,
          buttonTitle: t('notifications.turnOffType'),
          options: { opensAppToForeground: true },
        },
      ]).catch(() => undefined);
    }
  }, [t]);

  useEffect(() => {
    if (last) void handleResponse(last, userId).catch(() => undefined);
  }, [last, userId]);

  return null;
}
