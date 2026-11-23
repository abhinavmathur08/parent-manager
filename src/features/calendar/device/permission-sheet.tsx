import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';

import { BottomSheet } from '@/components/bottom-sheet';
import { Button } from '@/components/button';
import { Text } from '@/components/text';
import { useTheme } from '@/hooks/use-theme';
import type { CalendarAccess } from '@/lib/device-calendar/permission';

export type DeviceFeature = 'copy' | 'busy';

type Props = {
  /** The feature being turned on, or null when the sheet is closed. */
  feature: DeviceFeature | null;
  access: CalendarAccess | null;
  asking: boolean;
  onContinue: () => void;
  onClose: () => void;
};

/**
 * Explains why the app needs the phone's calendars before the system asks (FR2-DEV-1,
 * NFR2-SEC-5). When the permission was refused for good, it offers the system's Settings
 * instead, since only that can change it.
 */
export function CalendarPermissionSheet({ feature, access, asking, onContinue, onClose }: Props) {
  const { t } = useTranslation();
  const theme = useTheme();
  const blocked = access === 'blocked';
  return (
    <BottomSheet
      visible={feature !== null}
      onClose={onClose}
      title={t('calendarSettings.permission.title')}
      testID="calendar-permission-sheet"
      footer={
        <View style={[styles.actions, { gap: theme.space[2] }]}>
          <Button
            label={
              blocked
                ? t('calendarSettings.openSettings')
                : t('calendarSettings.permission.continue')
            }
            onPress={onContinue}
            loading={asking}
            fullWidth
            testID="calendar-permission-continue"
          />
          <Button
            label={t('calendarSettings.permission.notNow')}
            variant="ghost"
            onPress={onClose}
            disabled={asking}
            fullWidth
            testID="calendar-permission-not-now"
          />
        </View>
      }
    >
      <View style={{ gap: theme.space[3] }}>
        <Text testID="calendar-permission-body">
          {feature === 'busy'
            ? t('calendarSettings.permission.busyBody')
            : t('calendarSettings.permission.copyBody')}
        </Text>
        <Text color="textSecondary">
          {blocked
            ? t('calendarSettings.permission.blocked')
            : t('calendarSettings.permission.private')}
        </Text>
      </View>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  actions: {
    alignSelf: 'stretch',
  },
});
