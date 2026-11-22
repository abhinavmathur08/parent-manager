import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { BottomSheet } from '@/components/bottom-sheet';
import { ListRow } from '@/components/list-row';
import { RadioOption } from '@/components/radio-option';
import { Switch } from '@/components/switch';
import { useTheme } from '@/hooks/use-theme';
import { track } from '@/lib/analytics';
import { writableCalendars, type DeviceCalendar } from '@/lib/device-calendar/calendars';

import { readCopyState } from './copy-sync';
import type { DeviceCalendarSettings } from './settings';

type Props = {
  settings: DeviceCalendarSettings;
  change: (patch: Partial<DeviceCalendarSettings>) => void;
};

/**
 * Where copies go and whether dinners are copied (FR2-DEV-2, FR2-DEV-3), shown while "Copy
 * to my calendar" is on and access is given. Our own "Parent Manager" calendar is the default.
 */
export function CopyOptions({ settings, change }: Props) {
  const { t } = useTranslation();
  const theme = useTheme();
  const [calendars, setCalendars] = useState<DeviceCalendar[] | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let active = true;
    // Our own calendar is offered as the default, not as one of theirs.
    const own = readCopyState();
    writableCalendars()
      .then((list) => list.filter((c) => !(own?.own && c.id === own.calendarId)))
      .catch(() => [])
      .then((list) => {
        if (active) setCalendars(list);
      });
    return () => {
      active = false;
    };
  }, [open]);

  const choose = (target: string | null) => {
    setOpen(false);
    if (target === settings.copyTarget) return;
    change({ copyTarget: target });
    track('device_calendar_copy_changed', {
      enabled: true,
      target: target ? 'existing' : 'new',
    });
  };

  const chosen = calendars?.find((c) => c.id === settings.copyTarget);
  const targetName = settings.copyTarget
    ? (chosen?.title ?? t('calendarSettings.copy.chosenCalendar'))
    : t('calendarSettings.copy.calendarName');

  return (
    <View>
      <ListRow
        title={t('calendarSettings.copy.target')}
        variant="value"
        value={targetName}
        onPress={() => setOpen(true)}
        testID="calendar-copy-target"
      />
      <Switch
        label={t('calendarSettings.copy.meals')}
        description={t('calendarSettings.copy.mealsDescription')}
        value={settings.includeMeals}
        onValueChange={(on) => change({ includeMeals: on })}
        testID="calendar-copy-meals"
      />
      <BottomSheet
        visible={open}
        onClose={() => setOpen(false)}
        title={t('calendarSettings.copy.target')}
        testID="calendar-target-sheet"
      >
        <View style={{ gap: theme.space[2] }}>
          <RadioOption
            label={t('calendarSettings.copy.calendarName')}
            description={t('calendarSettings.copy.newCalendar')}
            selected={settings.copyTarget === null}
            onPress={() => choose(null)}
            testID="calendar-target-own"
          />
          {(calendars ?? []).map((calendar, index) => (
            <RadioOption
              key={calendar.id}
              label={calendar.title}
              description={calendar.account || undefined}
              selected={settings.copyTarget === calendar.id}
              onPress={() => choose(calendar.id)}
              testID={`calendar-target-${index}`}
            />
          ))}
        </View>
      </BottomSheet>
    </View>
  );
}
