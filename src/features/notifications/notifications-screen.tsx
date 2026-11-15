import { router } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { Screen } from '@/components/screen';
import { SectionHeader } from '@/components/section-header';
import { openSystemNotificationSettings, requestPushPermission } from '@/lib/notifications/push';

import { PushStatus } from './push-status';
import { usePushPermission } from './use-push-permission';

/** S-29 Notification settings: push status for now; per-type settings come with N-01.2. */
export function NotificationsScreen() {
  const { t } = useTranslation();
  const [permission, refresh] = usePushPermission();
  const [asking, setAsking] = useState(false);

  const turnOn = async () => {
    setAsking(true);
    try {
      await requestPushPermission('settings', t('notifications.channelName'));
    } catch {
      // Left off; the status below shows what the system says.
    } finally {
      setAsking(false);
      void refresh();
    }
  };

  return (
    <Screen
      title={t('notifications.title')}
      onBack={() => (router.canGoBack() ? router.back() : router.replace('/household'))}
      testID="notifications-screen"
    >
      <View>
        <SectionHeader title={t('notifications.push.section')} variant="group" />
        <PushStatus
          permission={permission}
          asking={asking}
          onTurnOn={() => void turnOn()}
          onOpenSystemSettings={() => void openSystemNotificationSettings()}
        />
      </View>
    </Screen>
  );
}
