import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';

import { Icon } from '@/components/icon';
import { IconButton } from '@/components/icon-button';
import { Text } from '@/components/text';
import { useTheme } from '@/hooks/use-theme';
import { formatDate, formatNumber, type AppLocale } from '@/i18n';
import { toDate, type PlanDate } from '@/features/planner/week';
import { track } from '@/lib/analytics';

import { useBusyDaysContext } from './busy-days';
import type { ShownBusyDay } from './publish';

// Days whose marker was counted this session, so `busy_day_shown` fires once a day.
const shown = new Set<string>();

/** The reason's text (FR2-BUSY-1). Members' devices don't know the booked hours (R2-BUSY-2). */
export function busyReasonKey(day: ShownBusyDay): { key: string; hours?: number } {
  if (day.reason === 'booked' && day.bookedMinutes !== null) {
    return { key: 'busy.reason.bookedHours', hours: Math.round(day.bookedMinutes / 30) / 2 };
  }
  return { key: `busy.reason.${day.reason ?? 'booked'}` };
}

const dayFormat = { weekday: 'long', month: 'long', day: 'numeric', timeZone: 'UTC' } as const;

/**
 * A day's busy marker, an icon and the reason, never color alone (FR2-BUSY-1). Renders nothing
 * outside a `BusyDaysProvider` or on a day that isn't busy, so quiet days keep their height.
 */
export function BusyDayMarker({ date, locale }: { date: PlanDate; locale: AppLocale }) {
  const { t } = useTranslation();
  const theme = useTheme();
  const busy = useBusyDaysContext();
  const day = busy?.dayFor(date) ?? null;
  const reason = day?.busy ? day.reason : null;

  useEffect(() => {
    if (!reason || shown.has(date)) return;
    shown.add(date);
    track('busy_day_shown', { reason });
  }, [date, reason]);

  if (!day?.busy) return null;
  const { key, hours } = busyReasonKey(day);
  const reasonText = t(key, {
    hours: hours === undefined ? undefined : formatNumber(hours, locale),
  });
  return (
    <View
      style={[styles.row, { gap: theme.space[1] }]}
      accessible
      accessibilityLabel={t('busy.marker', { reason: reasonText })}
      testID={`busy-marker-${date}`}
    >
      <Icon name="busy" size="sm" color="warning" />
      <Text variant="caption" color="textSecondary" style={styles.grow}>
        {reasonText}
      </Text>
    </View>
  );
}

/**
 * The button that marks a day busy or not busy (FR2-BUSY-4), for the day's header row. Only
 * parents and family members get it.
 */
export function BusyMarkButton({ date, locale }: { date: PlanDate; locale: AppLocale }) {
  const { t } = useTranslation();
  const busy = useBusyDaysContext();
  if (!busy?.canMark) return null;
  return (
    <IconButton
      icon="busy"
      accessibilityLabel={t('busy.mark.open', {
        day: formatDate(toDate(date), locale, dayFormat),
      })}
      onPress={() => busy.openMark(date)}
      testID={`busy-mark-open-${date}`}
    />
  );
}

/** Test helper: forgets which days were counted. */
export function resetShownBusyDays() {
  shown.clear();
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  grow: {
    flexGrow: 1,
    flexShrink: 1,
  },
});
