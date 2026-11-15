import * as Notifications from 'expo-notifications';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AppState } from 'react-native';

import type { TopBarAction } from '@/components/top-bar';

import { fetchUnreadCount } from './inbox';

/**
 * The header bell that opens the inbox (S-24), with the unread count in its label and a
 * badged icon, so the state isn't shown by color alone. The count is read again when the
 * screen gains focus, when the app returns to the foreground and when a push arrives.
 */
export function useInboxBell(): TopBarAction {
  const { t } = useTranslation();
  const [unread, setUnread] = useState(0);

  const refresh = useCallback(() => {
    fetchUnreadCount()
      .then(setUnread)
      .catch(() => undefined);
  }, []);

  useFocusEffect(refresh);

  useEffect(() => {
    const appState = AppState.addEventListener('change', (state) => {
      if (state === 'active') refresh();
    });
    const received = Notifications.addNotificationReceivedListener(refresh);
    return () => {
      appState.remove();
      received.remove();
    };
  }, [refresh]);

  return {
    icon: unread > 0 ? 'bellUnread' : 'bell',
    label:
      unread > 0
        ? t('notifications.inbox.openUnread', { count: unread })
        : t('notifications.inbox.open'),
    onPress: () => router.push('/plan/inbox'),
    testID: 'inbox-bell',
  };
}
