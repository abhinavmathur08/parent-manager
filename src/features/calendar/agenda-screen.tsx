import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { AppState, Pressable, StyleSheet, View } from 'react-native';

import { Banner } from '@/components/banner';
import { Button } from '@/components/button';
import { Card } from '@/components/card';
import { EmptyState } from '@/components/empty-state';
import { PRESSED_OPACITY } from '@/components/focus-ring';
import { Screen } from '@/components/screen';
import { Tag } from '@/components/tag';
import { Text } from '@/components/text';
import type { TopBarAction } from '@/components/top-bar';
import { todayIn, toDate, type PlanDate, type WeekStart } from '@/features/planner/week';
import { useOnline } from '@/hooks/use-online';
import { useTheme } from '@/hooks/use-theme';
import { formatDate, formatTime, type AppLocale } from '@/i18n';
import { track } from '@/lib/analytics';

import { BusyDayMarker, BusyMarkButton } from './busy-marker';
import { AGENDA_DAYS, agendaDays, householdTimeZone, type AgendaItem } from './agenda';
import { useCalendarRows } from './data';
import type { EventRow } from './tables';

export type CalendarHousehold = {
  id: string;
  locale: AppLocale;
  weekStart: WeekStart;
  timezone: string | null;
};

export type AgendaScreenProps = {
  household: CalendarHousehold;
  /** Opens an occurrence's detail (S-38). */
  onOpen?: (item: AgendaItem) => void;
  /** The screen's main action, at the bottom, such as "Add an event" (S-37). */
  footer?: ReactNode;
  headerActions?: readonly [TopBarAction] | readonly [TopBarAction, TopBarAction];
};

/** Today in the household's timezone, checked again when the app comes back. */
function useToday(timeZone: string): PlanDate {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (next) => {
      if (next === 'active') setNow(Date.now());
    });
    return () => subscription.remove();
  }, []);
  return useMemo(() => todayIn(timeZone, new Date(now)), [timeZone, now]);
}

const DAY_FORMAT = { weekday: 'long', month: 'long', day: 'numeric', timeZone: 'UTC' } as const;

/** The kind's name, from its identifier (NFR2-L10N-1). */
export function kindKey(kind: EventRow['kind']): string {
  return `calendar.kinds.${kind.slice('kind.'.length)}`;
}

/**
 * S-36 Calendar, agenda view (FR2-CAL-1): a list of days from today, read from the local copy
 * so it works offline (FR2-CAL-6). Times are on the household's clock, in its locale.
 */
export function AgendaScreen({ household, onOpen, footer, headerActions }: AgendaScreenProps) {
  const { t } = useTranslation();
  const theme = useTheme();
  const online = useOnline();
  const { locale } = household;
  const timeZone = householdTimeZone(household.timezone);
  const today = useToday(timeZone);
  const [days, setDays] = useState(AGENDA_DAYS);
  const { events, exceptions, loading } = useCalendarRows();
  const agenda = useMemo(
    () =>
      agendaDays(events, exceptions, {
        timeZone,
        weekStart: household.weekStart,
        from: today,
        days,
      }),
    [events, exceptions, timeZone, household.weekStart, today, days],
  );

  useFocusEffect(
    useCallback(() => {
      track('calendar_viewed', { view: 'agenda' });
    }, []),
  );

  const timeOf = (item: AgendaItem): string => {
    const { occurrence } = item;
    if (occurrence.allDay) return t('calendar.allDay');
    return t('calendar.timeRange', {
      start: formatTime(new Date(occurrence.startsAt!), locale, timeZone),
      end: formatTime(new Date(occurrence.endsAt!), locale, timeZone),
    });
  };

  const isEmpty = !loading && events.length === 0;

  return (
    <View style={styles.grow}>
      <Screen
        title={t('calendar.title')}
        actions={headerActions}
        banner={
          !online ? (
            <Banner variant="offline" message={t('calendar.offline')} testID="calendar-offline" />
          ) : null
        }
        testID="calendar-screen"
      >
        {isEmpty ? (
          <Card testID="calendar-empty">
            <EmptyState
              icon="calendar"
              message={t('calendar.empty')}
              testID="calendar-empty-state"
            />
          </Card>
        ) : (
          <View style={{ gap: theme.layout.sectionGap }} testID="calendar-agenda">
            {agenda.map((day) => (
              <View
                key={day.date}
                style={{ gap: theme.space[2] }}
                testID={`calendar-day-${day.date}`}
              >
                <View style={[styles.row, { gap: theme.space[2] }]}>
                  <Text variant="sectionLabel" accessibilityRole="header" style={styles.shrink}>
                    {formatDate(toDate(day.date), locale, DAY_FORMAT)}
                  </Text>
                  {day.date === today ? (
                    <Tag label={t('calendar.today')} testID="calendar-today-tag" />
                  ) : null}
                  <BusyMarkButton date={day.date} locale={locale} />
                </View>
                <BusyDayMarker date={day.date} locale={locale} />
                {day.items.length === 0 ? (
                  <Text color="textSecondary" testID="calendar-nothing-today">
                    {t('calendar.nothingToday')}
                  </Text>
                ) : (
                  day.items.map((item) => (
                    <AgendaRow
                      key={item.key}
                      time={timeOf(item)}
                      kind={t(kindKey(item.event.kind))}
                      title={item.event.title}
                      onPress={onOpen ? () => onOpen(item) : undefined}
                      testID={`calendar-event-${item.key}`}
                    />
                  ))
                )}
              </View>
            ))}
            <Button
              variant="ghost"
              label={t('calendar.showLater')}
              onPress={() => setDays((n) => n + AGENDA_DAYS)}
              testID="calendar-show-later"
            />
          </View>
        )}
        {/* Room for the docked main action, so the last day isn't under it. */}
        {footer ? <View style={{ height: theme.layout.minTarget + theme.space[4] }} /> : null}
      </Screen>
      {footer}
    </View>
  );
}

function AgendaRow({
  time,
  kind,
  title,
  onPress,
  testID,
}: {
  time: string;
  kind: string;
  title: string;
  onPress?: () => void;
  testID: string;
}) {
  const { t } = useTranslation();
  const theme = useTheme();
  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      accessibilityRole={onPress ? 'button' : undefined}
      // Announces the kind, time and title (NFR2-A11Y-1).
      accessibilityLabel={t('calendar.eventLabel', { kind, time, title })}
      testID={testID}
      style={({ pressed }) => [
        {
          minHeight: theme.layout.minRowHeight,
          padding: theme.space[4],
          gap: theme.space[1],
          borderRadius: theme.radius.card,
          backgroundColor: theme.color.surface,
        },
        pressed && { opacity: PRESSED_OPACITY },
      ]}
    >
      {/* Stacked, not in columns, so long text and the largest sizes wrap instead of clipping. */}
      <Text variant="label" color="textSecondary" tabular>
        {time}
      </Text>
      <Text variant="bodyStrong">{title}</Text>
      <Text variant="caption" color="textSecondary">
        {kind}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  grow: { flex: 1 },
  row: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap' },
  shrink: { flexShrink: 1 },
});
