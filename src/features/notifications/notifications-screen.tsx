import Constants from 'expo-constants';
import { router } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, View } from 'react-native';

import { Button } from '@/components/button';
import { ListRow } from '@/components/list-row';
import { Screen } from '@/components/screen';
import { SectionHeader } from '@/components/section-header';
import { Switch } from '@/components/switch';
import { Text } from '@/components/text';
import { useTheme } from '@/hooks/use-theme';
import { track } from '@/lib/analytics';
import { openSystemNotificationSettings, requestPushPermission } from '@/lib/notifications/push';

import { ChoiceSheet } from './choice-sheet';
import { useShowEventDetails } from './event-details';
import { sendTestNotification } from './inbox';
import {
  dayBefore,
  DEVICE_TYPES,
  NOTIFICATION_TYPES,
  type NotificationPrefs,
  type NotificationType,
} from './prefs';
import { PushStatus } from './push-status';
import { formatMinute, formatWeekday, HOURS, WEEKDAYS } from './times';
import { useNotificationPrefs } from './use-notification-prefs';
import { usePushPermission } from './use-push-permission';

type Picking = 'planWeekDay' | 'planWeekMinute' | 'quietStartMinute' | 'quietEndMinute';

/** Development and preview builds can send themselves a test push (N-01.3). */
const canSendTest =
  (Constants.expoConfig?.extra as { appVariant?: string } | undefined)?.appVariant !== 'production';

export type NotificationsScreenProps = {
  userId: string;
  household: {
    /** ISO weekday the week starts on: 1 is Monday, 7 is Sunday. */
    weekStart: number;
    /** The household's IANA timezone, which every time here is in. */
    timezone: string;
  };
};

/**
 * S-29 Notification settings (FR-NOT-2, FR-NOT-3, FR-NOT-6, FR-NOT-7, FR2-REM-3): push
 * status, a switch per type, "show event details" for this device, the "plan your week" day
 * and time, and quiet hours, saved on the server for the
 * sender to check. Turning on a type that reaches the device asks for permission if the
 * system hasn't been asked yet; when it's been refused those types are "off in system
 * settings", with a link there.
 */
export function NotificationsScreen({ userId, household }: NotificationsScreenProps) {
  const { t, i18n } = useTranslation();
  const theme = useTheme();
  const locale = i18n.language;
  const [permission, refresh] = usePushPermission();
  const { prefs, save } = useNotificationPrefs(userId);
  const [eventDetails, setEventDetails] = useShowEventDetails(userId);
  const [asking, setAsking] = useState(false);
  const [picking, setPicking] = useState<Picking | null>(null);
  const denied = permission === 'denied';

  const turnOnPush = async () => {
    setAsking(true);
    try {
      await requestPushPermission('settings', t('notifications.channelName'));
    } catch {
      // Left off; the status shows what the system says.
    } finally {
      setAsking(false);
      void refresh();
    }
  };

  const change = async (next: NotificationPrefs) => {
    try {
      await save(next);
      return true;
    } catch {
      Alert.alert(t('notifications.saveFailed'));
      return false;
    }
  };

  const toggle = async (type: NotificationType, enabled: boolean) => {
    // Turning a type on is one of the two moments FR-NOT-2 allows asking.
    if (enabled && DEVICE_TYPES.includes(type) && permission === 'undetermined') {
      await turnOnPush();
    }
    if (await change({ ...prefs, [type]: enabled })) {
      track('notification_type_toggled', { type, enabled, surface: 'settings' });
    }
  };

  const choose = async (field: Picking, value: number) => {
    setPicking(null);
    const next = { ...prefs, [field]: value };
    if (!(await change(next))) return;
    if (field === 'quietStartMinute' || field === 'quietEndMinute') {
      track('quiet_hours_changed', {
        start_hour: Math.floor(next.quietStartMinute / 60),
        end_hour: Math.floor(next.quietEndMinute / 60),
      });
    }
  };

  const planWeekDay = prefs.planWeekDay ?? dayBefore(household.weekStart);
  const hours = HOURS.map((minute) => ({ value: minute, label: formatMinute(minute, locale) }));
  const sheets: Record<Picking, { title: string; choices: { value: number; label: string }[] }> = {
    planWeekDay: {
      title: t('notifications.planWeek.day'),
      choices: WEEKDAYS.map((day) => ({ value: day, label: formatWeekday(day, locale) })),
    },
    planWeekMinute: { title: t('notifications.planWeek.time'), choices: hours },
    quietStartMinute: { title: t('notifications.quiet.start'), choices: hours },
    quietEndMinute: { title: t('notifications.quiet.end'), choices: hours },
  };
  const selected: Record<Picking, number> = {
    planWeekDay,
    planWeekMinute: prefs.planWeekMinute,
    quietStartMinute: prefs.quietStartMinute,
    quietEndMinute: prefs.quietEndMinute,
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
          onTurnOn={() => void turnOnPush()}
          onOpenSystemSettings={() => void openSystemNotificationSettings()}
        />
        {canSendTest && permission === 'granted' ? (
          <Button
            label={t('notifications.test.send')}
            variant="secondary"
            onPress={() =>
              void sendTestNotification().then(
                () => Alert.alert(t('notifications.test.sent')),
                () => Alert.alert(t('notifications.test.failed')),
              )
            }
            testID="send-test-notification"
          />
        ) : null}
      </View>

      <View>
        <SectionHeader title={t('notifications.types.section')} variant="group" />
        {NOTIFICATION_TYPES.map((type) => {
          const blocked = denied && DEVICE_TYPES.includes(type);
          return (
            <Switch
              key={type}
              label={t(`notifications.types.${type}.title`)}
              description={
                blocked
                  ? t('notifications.types.offInSystem')
                  : t(`notifications.types.${type}.description`)
              }
              value={blocked ? false : prefs[type]}
              disabled={blocked}
              onValueChange={(enabled) => void toggle(type, enabled)}
              testID={`notification-type-${type}`}
            />
          );
        })}
        {prefs.calendar_reminders && !denied ? (
          // FR2-REM-3: this device only, off by default.
          <Switch
            label={t('notifications.eventDetails.title')}
            description={t('notifications.eventDetails.description')}
            value={eventDetails}
            onValueChange={setEventDetails}
            testID="event-details-switch"
          />
        ) : null}
      </View>

      {prefs.plan_week && !denied ? (
        <View>
          <SectionHeader title={t('notifications.planWeek.section')} variant="group" />
          <ListRow
            title={t('notifications.planWeek.day')}
            variant="value"
            value={formatWeekday(planWeekDay, locale)}
            onPress={() => setPicking('planWeekDay')}
            divider
            testID="plan-week-day"
          />
          <ListRow
            title={t('notifications.planWeek.time')}
            variant="value"
            value={formatMinute(prefs.planWeekMinute, locale)}
            onPress={() => setPicking('planWeekMinute')}
            testID="plan-week-time"
          />
        </View>
      ) : null}

      <View style={{ gap: theme.space[2] }}>
        <View>
          <SectionHeader title={t('notifications.quiet.section')} variant="group" />
          <ListRow
            title={t('notifications.quiet.start')}
            variant="value"
            value={formatMinute(prefs.quietStartMinute, locale)}
            onPress={() => setPicking('quietStartMinute')}
            divider
            testID="quiet-start"
          />
          <ListRow
            title={t('notifications.quiet.end')}
            variant="value"
            value={formatMinute(prefs.quietEndMinute, locale)}
            onPress={() => setPicking('quietEndMinute')}
            testID="quiet-end"
          />
        </View>
        <Text variant="label" color="textSecondary" testID="quiet-note">
          {t('notifications.quiet.note', { timezone: household.timezone })}
        </Text>
      </View>

      {picking ? (
        <ChoiceSheet
          visible
          title={sheets[picking].title}
          choices={sheets[picking].choices}
          selected={selected[picking]}
          onChoose={(value) => void choose(picking, value)}
          onClose={() => setPicking(null)}
          testID={`choose-${picking}`}
        />
      ) : null}
    </Screen>
  );
}
