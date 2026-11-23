import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { BottomSheet } from '@/components/bottom-sheet';
import { ListRow } from '@/components/list-row';
import { Switch } from '@/components/switch';
import { Text } from '@/components/text';
import { useTheme } from '@/hooks/use-theme';
import { track } from '@/lib/analytics';
import { eventCalendars, type DeviceCalendar } from '@/lib/device-calendar/calendars';

import { readCopyState } from './copy-sync';
import type { DeviceCalendarSettings } from './settings';

type Props = {
  settings: DeviceCalendarSettings;
  change: (patch: Partial<DeviceCalendarSettings>) => void;
  open: boolean;
  setOpen: (open: boolean) => void;
};

/**
 * Which device calendars busy times come from (FR2-DEV-4), shown while "Share my busy times"
 * is on. Our own "Parent Manager" calendar isn't offered: its events are already in the app.
 */
export function BusyOptions({ settings, change, open, setOpen }: Props) {
  const { t } = useTranslation();
  const theme = useTheme();
  const [calendars, setCalendars] = useState<DeviceCalendar[] | null>(null);

  useEffect(() => {
    let active = true;
    const own = readCopyState();
    eventCalendars()
      .then((list) => list.filter((c) => !(own?.own && c.id === own.calendarId)))
      .catch(() => [])
      .then((list) => {
        if (active) setCalendars(list);
      });
    return () => {
      active = false;
    };
  }, [open]);

  const chosen = new Set(settings.busyCalendars);
  const toggle = (id: string, on: boolean) => {
    const next = on ? [...chosen, id] : [...chosen].filter((c) => c !== id);
    change({ busyCalendars: next });
    track('busy_times_changed', { enabled: true, calendars_count: next.length });
  };

  // Calendars deleted from the phone since they were chosen don't count.
  const count = (calendars ?? []).filter((c) => chosen.has(c.id)).length;

  return (
    <View>
      <ListRow
        title={t('calendarSettings.busy.calendars')}
        variant="value"
        value={
          count === 0
            ? t('calendarSettings.busy.noneChosen')
            : t('calendarSettings.busy.chosen', { count })
        }
        onPress={() => setOpen(true)}
        testID="calendar-busy-calendars"
      />
      <BottomSheet
        visible={open}
        onClose={() => setOpen(false)}
        title={t('calendarSettings.busy.calendars')}
        testID="calendar-busy-sheet"
      >
        <View style={{ gap: theme.space[2] }}>
          <Text color="textSecondary">{t('calendarSettings.busy.pickHint')}</Text>
          {(calendars ?? []).map((calendar, index) => (
            <Switch
              key={calendar.id}
              label={calendar.title}
              description={calendar.account || undefined}
              value={chosen.has(calendar.id)}
              onValueChange={(on) => toggle(calendar.id, on)}
              testID={`calendar-busy-option-${index}`}
            />
          ))}
          {calendars?.length === 0 ? (
            <Text testID="calendar-busy-none">{t('calendarSettings.busy.noCalendars')}</Text>
          ) : null}
        </View>
      </BottomSheet>
    </View>
  );
}
