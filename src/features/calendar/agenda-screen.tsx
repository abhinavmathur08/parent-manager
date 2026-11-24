import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { AppState, StyleSheet, View } from 'react-native';

import { Banner } from '@/components/banner';
import { Button } from '@/components/button';
import { Card } from '@/components/card';
import { EmptyState } from '@/components/empty-state';
import { Screen } from '@/components/screen';
import { Tag } from '@/components/tag';
import { Text } from '@/components/text';
import type { TopBarAction } from '@/components/top-bar';
import { todayIn, toDate, type PlanDate, type WeekStart } from '@/features/planner/week';
import { useOnline } from '@/hooks/use-online';
import { useTheme } from '@/hooks/use-theme';
import { formatDate, type AppLocale } from '@/i18n';
import { track } from '@/lib/analytics';

import { BusyDayMarker, BusyMarkButton } from './busy-marker';
import { AGENDA_DAYS, agendaDays, householdTimeZone, type AgendaItem } from './agenda';
import { useCalendarRows } from './data';
import {
  EventRow,
  kindKey,
  MealsRow,
  useCalendarMeals,
  useTakingName,
  useTimeOf,
} from './event-row';

export { kindKey } from './event-row';

export type CalendarHousehold = {
  id: string;
  locale: AppLocale;
  weekStart: WeekStart;
  timezone: string | null;
};

export type AgendaScreenProps = {
  household: CalendarHousehold;
  /** The signed-in member, so the rows say "You" for what they're taking. */
  userId?: string | null;
  /** Opens an occurrence's detail (S-38). */
  onOpen?: (item: AgendaItem) => void;
  /** Opens the Plan tab on a day, from its meals row (FR2-CAL-5). */
  onOpenMeals?: (date: PlanDate) => void;
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

/**
 * S-36 Calendar, agenda view (FR2-CAL-1): a list of days from today, read from the local copy
 * so it works offline (FR2-CAL-6). Times are on the household's clock, in its locale. Each day
 * shows its planned meals (FR2-CAL-5).
 */
export function AgendaScreen({
  household,
  userId = null,
  onOpen,
  onOpenMeals,
  footer,
  headerActions,
}: AgendaScreenProps) {
  const { t } = useTranslation();
  const theme = useTheme();
  const online = useOnline();
  const { locale } = household;
  const timeZone = householdTimeZone(household.timezone);
  const today = useToday(timeZone);
  const [days, setDays] = useState(AGENDA_DAYS);
  const { events, exceptions, loading } = useCalendarRows();
  const meals = useCalendarMeals();
  const timeOf = useTimeOf(locale, timeZone);
  const takingOf = useTakingName(household.id, userId);
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

  // Planned meals are on the calendar too (FR2-CAL-5), so they keep the agenda's days.
  const isEmpty = !loading && events.length === 0 && meals.size === 0;

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
                <MealsRow
                  date={day.date}
                  meals={meals.get(day.date)}
                  locale={locale}
                  onOpen={onOpenMeals}
                />
                {day.items.length === 0 ? (
                  <Text color="textSecondary" testID="calendar-nothing-today">
                    {t('calendar.nothingToday')}
                  </Text>
                ) : (
                  day.items.map((item) => (
                    <EventRow
                      key={item.key}
                      time={timeOf(item)}
                      kind={t(kindKey(item.event.kind))}
                      title={item.event.title}
                      taking={takingOf(item)}
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

const styles = StyleSheet.create({
  grow: { flex: 1 },
  row: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap' },
  shrink: { flexShrink: 1 },
});
