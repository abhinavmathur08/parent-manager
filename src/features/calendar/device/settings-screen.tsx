import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Linking, View } from 'react-native';

import { Button } from '@/components/button';
import { Screen } from '@/components/screen';
import { SectionHeader } from '@/components/section-header';
import { Switch } from '@/components/switch';
import { Text } from '@/components/text';
import { useTheme } from '@/hooks/use-theme';
import { track } from '@/lib/analytics';
import { reportError } from '@/lib/crash-reporting';

import { CopyOptions } from './copy-options';
import { removeCopies } from './copy-sync';
import { CalendarPermissionSheet, type DeviceFeature } from './permission-sheet';
import { useDeviceSettings } from './settings';
import { useCalendarAccess } from './use-calendar-access';

export type CalendarSettingsScreenProps = {
  householdId: string;
  onBack: () => void;
};

/**
 * S-39 Calendar settings (FR2-DEV-1, FR2-DEV-2, FR2-PRIV-3): "Copy to my calendar" and "Share my busy
 * times", both off until the member turns them on. Turning one on explains first, then asks
 * for the phone's calendars (NFR2-SEC-5). Declining leaves the feature off and the rest of the
 * app working; if the permission is refused for good, the screen says so and links to the
 * system's Settings.
 */
export function CalendarSettingsScreen({ householdId, onBack }: CalendarSettingsScreenProps) {
  const { t } = useTranslation();
  const theme = useTheme();
  const [settings, change] = useDeviceSettings(householdId);
  const { access, ask } = useCalendarAccess();
  const [pending, setPending] = useState<DeviceFeature | null>(null);
  const [asking, setAsking] = useState(false);

  const turn = (feature: DeviceFeature, on: boolean) => {
    change({ [feature]: on });
    if (feature === 'copy') {
      track('device_calendar_copy_changed', {
        enabled: on,
        target: settings.copyTarget ? 'existing' : 'new',
      });
      // Off removes the copies, so the phone's calendar never shows stale events.
      if (!on) removeCopies().catch(reportError);
    }
  };

  const toggle = (feature: DeviceFeature, on: boolean) => {
    if (!on) return turn(feature, false);
    if (access === 'granted') return turn(feature, true);
    setPending(feature);
  };

  const proceed = async () => {
    const feature = pending;
    if (!feature) return;
    if (access === 'blocked') {
      setPending(null);
      await Linking.openSettings().catch(() => undefined);
      return;
    }
    setAsking(true);
    try {
      if ((await ask()) === 'granted') turn(feature, true);
    } finally {
      setAsking(false);
      setPending(null);
    }
  };

  // A feature left on after the permission was taken away is paused, not lost.
  const paused = access !== null && access !== 'granted' && (settings.copy || settings.busy);
  const declined = access === 'blocked' && !paused;

  return (
    <Screen title={t('calendarSettings.title')} onBack={onBack} testID="calendar-settings-screen">
      {paused || declined ? (
        <View style={{ gap: theme.space[2] }} testID="calendar-access-off">
          <Text accessibilityLiveRegion="polite">
            {paused ? t('calendarSettings.paused') : t('calendarSettings.declined')}
          </Text>
          <Button
            variant="secondary"
            label={t('calendarSettings.openSettings')}
            onPress={() => void Linking.openSettings().catch(() => undefined)}
            testID="calendar-open-settings"
          />
        </View>
      ) : null}
      <View>
        <SectionHeader title={t('calendarSettings.copy.section')} variant="group" />
        <Switch
          label={t('calendarSettings.copy.label')}
          description={t('calendarSettings.copy.description')}
          value={settings.copy}
          onValueChange={(on) => toggle('copy', on)}
          testID="calendar-copy-switch"
        />
        {settings.copy && access === 'granted' ? (
          <CopyOptions settings={settings} change={change} />
        ) : null}
      </View>
      <View>
        <SectionHeader title={t('calendarSettings.busy.section')} variant="group" />
        <Switch
          label={t('calendarSettings.busy.label')}
          description={t('calendarSettings.busy.description')}
          value={settings.busy}
          onValueChange={(on) => toggle('busy', on)}
          testID="calendar-busy-switch"
        />
      </View>
      <CalendarPermissionSheet
        feature={pending}
        access={access}
        asking={asking}
        onContinue={() => void proceed()}
        onClose={() => setPending(null)}
      />
    </Screen>
  );
}
