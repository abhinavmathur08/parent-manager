import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { EmptyState } from '@/components/empty-state';
import { ListRow } from '@/components/list-row';
import { Screen } from '@/components/screen';
import { Text } from '@/components/text';
import { useTheme } from '@/hooks/use-theme';
import { formatDate } from '@/i18n';
import { track } from '@/lib/analytics';

import { fetchInbox, markRead, messageKey, routeFor, type InboxItem } from './inbox';

const DOT = 10;

/**
 * S-24 Notifications inbox (FR-NOT-8): the last 50 notifications, newest first, with read
 * state. Tapping one marks it read on every device and opens the related screen.
 */
export function InboxScreen() {
  const { t, i18n } = useTranslation();
  const theme = useTheme();
  const [items, setItems] = useState<InboxItem[] | null>(null);
  const [failed, setFailed] = useState(false);

  useFocusEffect(
    useCallback(() => {
      let active = true;
      fetchInbox()
        .then((next) => {
          if (!active) return;
          setItems(next);
          setFailed(false);
        })
        .catch(() => {
          if (active) setFailed(true);
        });
      return () => {
        active = false;
      };
    }, []),
  );

  const readLocally = (ids: readonly string[] | null) =>
    setItems(
      (current) =>
        current?.map((item) =>
          (ids === null || ids.includes(item.id)) && !item.readAt
            ? { ...item, readAt: new Date().toISOString() }
            : item,
        ) ?? null,
    );

  const open = (item: InboxItem) => {
    if (!item.readAt) {
      readLocally([item.id]);
      void markRead([item.id]).catch(() => undefined);
    }
    track('notification_opened', { type: item.type });
    const route = routeFor(item.type, item.payload, 'inbox');
    if (route) router.navigate(route);
  };

  const unread = items?.some((item) => !item.readAt) ?? false;

  return (
    <Screen
      title={t('notifications.inbox.title')}
      onBack={() => (router.canGoBack() ? router.back() : router.replace('/plan'))}
      actions={
        unread
          ? [
              {
                label: t('notifications.inbox.markAllRead'),
                onPress: () => {
                  readLocally(null);
                  void markRead().catch(() => undefined);
                },
                testID: 'inbox-mark-all-read',
              },
            ]
          : undefined
      }
      testID="inbox-screen"
    >
      {failed && !items ? (
        <Text variant="body" color="textSecondary" testID="inbox-failed">
          {t('notifications.inbox.failed')}
        </Text>
      ) : null}
      {items && items.length === 0 ? (
        <EmptyState
          icon="bell"
          message={t('notifications.inbox.empty.body')}
          testID="inbox-empty"
        />
      ) : null}
      {items && items.length > 0 ? (
        <View testID="inbox-list">
          {items.map((item, index) => {
            const key = messageKey(item);
            const when = formatDate(new Date(item.createdAt), i18n.language, {
              month: 'short',
              day: 'numeric',
              hour: 'numeric',
              minute: '2-digit',
            });
            return (
              <ListRow
                key={item.id}
                title={t(`notifications.messages.${key}.title`)}
                subtitle={`${t(`notifications.messages.${key}.body`)}\n${when}`}
                variant="navigation"
                leading={
                  <View
                    style={{
                      width: DOT,
                      height: DOT,
                      borderRadius: DOT / 2,
                      backgroundColor: item.readAt ? 'transparent' : theme.color.primary,
                    }}
                    testID={item.readAt ? `inbox-item-${index}-read` : `inbox-item-${index}-unread`}
                  />
                }
                accessibilityHint={item.readAt ? undefined : t('notifications.inbox.unread')}
                onPress={() => open(item)}
                divider={index < items.length - 1}
                testID={`inbox-item-${index}`}
              />
            );
          })}
        </View>
      ) : null}
    </Screen>
  );
}
