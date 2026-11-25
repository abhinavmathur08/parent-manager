import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { AppState, StyleSheet, useWindowDimensions, View } from 'react-native';

import { Banner } from '@/components/banner';
import { Button } from '@/components/button';
import { Card } from '@/components/card';
import { EmptyState } from '@/components/empty-state';
import { Screen } from '@/components/screen';
import { SegmentedControl, STACK_AT_FONT_SCALE } from '@/components/segmented-control';
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
import { DayView, WeekView } from './day-week-views';
import {
  EventRow,
  kindKey,
  MealsRow,
  useCalendarMeals,
  useTakingName,
  useTimeOf,
} from './event-row';
import type { CalendarView } from './views';

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
 * S-36 Calendar (FR2-CAL-1): opens on today in the agenda, a list of days from today, with a
 * switch to the day and week views. Everything reads the local copy, so it works offline
 * (FR2-CAL-6). Times are on the household's clock, in its locale. Each day shows its planned
 * meals (FR2-CAL-5). At the largest text sizes the week view falls back to the agenda
 * (NFR2-A11Y-1).
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
  const { fontScale } = useWindowDimensions();
  const largestText = fontScale * theme.fontScale >= STACK_AT_FONT_SCALE;
  const [chosen, setChosen] = useState<CalendarView>('agenda');
  // The day shown, or a day of the week shown; it follows today until the member moves.
  const [picked, setPicked] = useState<PlanDate | null>(null);
  const date = picked ?? today;
  const view: CalendarView = chosen === 'week' && largestText ? 'agenda' : chosen;
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
      track('calendar_viewed', { view });
    }, [view]),
  );

  const options = [
    { value: 'agenda' as const, label: t('calendar.views.agenda') },
    { value: 'day' as const, label: t('calendar.views.day') },
    // The week needs room; at the largest text sizes the agenda stands in for it.
    ...(largestText ? [] : [{ value: 'week' as const, label: t('calendar.views.week') }]),
  ];
  const viewProps = {
    locale,
    timeZone,
    weekStart: household.weekStart,
    today,
    date,
    onDateChange: (next: PlanDate) => setPicked(next === today ? null : next),
    timeOf,
    takingOf,
    stacked: largestText,
    onOpen,
    onOpenMeals,
  };

  // Planned meals are on the calendar too (FR2-CAL-5), so they keep the agenda's days.
  const isEmpty = !loading && events.length === 0 && meals.size === 0 && view === 'agenda';

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
        <SegmentedControl
          options={options}
          value={view}
          onChange={setChosen}
          accessibilityLabel={t('calendar.views.label')}
          testID="calendar-view"
        />
        {view === 'day' ? (
          <DayView {...viewProps} />
        ) : view === 'week' ? (
          <WeekView
            {...viewProps}
            onOpenDay={(day) => {
              viewProps.onDateChange(day);
              setChosen('day');
            }}
          />
        ) : isEmpty ? (
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
