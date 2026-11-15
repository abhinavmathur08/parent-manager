import * as Notifications from 'expo-notifications';
import { router } from 'expo-router';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';

import { track } from '@/lib/analytics';

import { markRead, routeFor } from './inbox';
import { fetchPrefs, NOTIFICATION_TYPES, savePrefs, type NotificationType } from './prefs';

/** The "turn off this type" action on a notification (FR-NOT-7). */
export const TURN_OFF_ACTION = 'turn_off';

/** Types whose notifications offer "turn off this type"; the push's `categoryId` names one. */
const CATEGORY_TYPES: readonly NotificationType[] = ['plan_week', 'list_ready', 'defrost'];

// A response is handled once, even if the component mounts again.
const handled = new Set<string>();

const isType = (value: unknown): value is NotificationType =>
  (NOTIFICATION_TYPES as readonly unknown[]).includes(value);

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
  routeOf: ResponseRoute = (data) => routeFor(String(data.type)),
): Promise<void> {
  const key = `${response.notification.request.identifier}:${response.actionIdentifier}`;
  if (handled.has(key)) return;
  handled.add(key);
  const data = (response.notification.request.content.data ?? {}) as Record<string, unknown>;
  const type = data.type;

  if (response.actionIdentifier === TURN_OFF_ACTION) {
    if (!isType(type)) return;
    const prefs = await fetchPrefs(userId);
    await savePrefs(userId, { ...prefs, [type]: false });
    track('notification_type_toggled', { type, enabled: false, surface: 'notification' });
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
    for (const type of CATEGORY_TYPES) {
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
