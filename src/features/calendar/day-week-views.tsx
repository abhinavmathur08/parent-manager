import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, View } from 'react-native';

import { Button } from '@/components/button';
import { Card } from '@/components/card';
import { PRESSED_OPACITY } from '@/components/focus-ring';
import { IconButton } from '@/components/icon-button';
import { Tag } from '@/components/tag';
import { Text } from '@/components/text';
import {
  addDays,
  startOfWeek,
  toDate,
  type PlanDate,
  type WeekStart,
} from '@/features/planner/week';
import { useTheme } from '@/hooks/use-theme';
import { formatDate, type AppLocale } from '@/i18n';

import type { AgendaDay, AgendaItem } from './agenda';
import { BusyDayMarker, BusyMarkButton } from './busy-marker';
import { useCalendarRows } from './data';
import { EventRow, kindKey, MealsRow, useCalendarMeals } from './event-row';
import { calendarDays, dayLayout } from './views';

export type DayWeekProps = {
  locale: AppLocale;
  timeZone: string;
  weekStart: WeekStart;
  today: PlanDate;
  /** The day shown, or a day in the week shown. */
  date: PlanDate;
  onDateChange: (date: PlanDate) => void;
  timeOf: (item: AgendaItem) => string;
  takingOf: (item: AgendaItem) => string | null;
  /** True at the largest text sizes: overlaps stack instead of sitting side by side. */
  stacked: boolean;
  onOpen?: (item: AgendaItem) => void;
  onOpenMeals?: (date: PlanDate) => void;
};

const DAY_FORMAT = { weekday: 'long', month: 'long', day: 'numeric', timeZone: 'UTC' } as const;
const SHORT_DAY = { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' } as const;
const RANGE_FORMAT = { month: 'short', day: 'numeric', timeZone: 'UTC' } as const;

/** The household's events for a range, every day included, from the local copy. */
function useDays(timeZone: string, weekStart: WeekStart, from: PlanDate, days: number) {
  const { events, exceptions } = useCalendarRows();
  return useMemo(
    () => calendarDays(events, exceptions, { timeZone, weekStart, from, days }),
    [events, exceptions, timeZone, weekStart, from, days],
  );
}

/** Previous, the range or day as a header, and next; "Today" when away from it. */
function Stepper({
  label,
  previousLabel,
  nextLabel,
  onStep,
  onToday,
  testID,
}: {
  label: string;
  previousLabel: string;
  nextLabel: string;
  onStep: (direction: -1 | 1) => void;
  onToday: (() => void) | null;
  testID: string;
}) {
  const { t } = useTranslation();
  const theme = useTheme();
  return (
    <View style={{ gap: theme.space[1] }}>
      <View style={[styles.row, { gap: theme.space[2] }]}>
        <IconButton
          icon="back"
          accessibilityLabel={previousLabel}
          onPress={() => onStep(-1)}
          testID={`${testID}-previous`}
        />
        <Text
          variant="sectionLabel"
          accessibilityRole="header"
          style={styles.grow}
          testID={`${testID}-label`}
        >
          {label}
        </Text>
        <IconButton
          icon="forward"
          accessibilityLabel={nextLabel}
          onPress={() => onStep(1)}
          testID={`${testID}-next`}
        />
      </View>
      {onToday ? (
        <Button
          variant="ghost"
          label={t('calendar.today')}
          onPress={onToday}
          testID={`${testID}-today`}
        />
      ) : null}
    </View>
  );
}

/**
 * S-36 day view (FR2-CAL-1): one day's busy marker, planned meals (FR2-CAL-5), all-day items,
 * then timed ones, with overlaps side by side (spec 3.1 edge cases).
 */
export function DayView(props: DayWeekProps) {
  const { t } = useTranslation();
  const theme = useTheme();
  const { locale, timeZone, weekStart, today, date, onDateChange, stacked } = props;
  const [day] = useDays(timeZone, weekStart, date, 1);
  const meals = useCalendarMeals();
  const layout = useMemo(() => dayLayout(day!.items), [day]);
  const row = (item: AgendaItem) => <ItemRow key={item.key} item={item} {...props} />;

  return (
    <View style={{ gap: theme.space[3] }} testID="calendar-day-view">
      <Stepper
        label={formatDate(toDate(date), locale, DAY_FORMAT)}
        previousLabel={t('calendar.views.previousDay')}
        nextLabel={t('calendar.views.nextDay')}
        onStep={(direction) => onDateChange(addDays(date, direction))}
        onToday={date === today ? null : () => onDateChange(today)}
        testID="calendar-day"
      />
      <View style={[styles.wrap, { gap: theme.space[2] }]}>
        {date === today ? <Tag label={t('calendar.today')} testID="calendar-today-tag" /> : null}
        <BusyMarkButton date={date} locale={locale} />
      </View>
      <BusyDayMarker date={date} locale={locale} />
      <MealsRow date={date} meals={meals.get(date)} locale={locale} onOpen={props.onOpenMeals} />
      {day!.items.length === 0 ? (
        <Text color="textSecondary" testID="calendar-nothing-today">
          {t('calendar.nothingToday')}
        </Text>
      ) : null}
      {layout.allDay.map(row)}
      {layout.groups.map((group) => (
        <View
          key={group.columns[0]![0]!.key}
          style={[stacked ? null : styles.columns, { gap: theme.space[2] }]}
          testID={`calendar-overlap-${group.columns.length}`}
        >
          {group.columns.map((column) => (
            <View
              key={column[0]!.key}
              style={[stacked ? null : styles.grow, { gap: theme.space[2] }]}
            >
              {column.map(row)}
            </View>
          ))}
        </View>
      ))}
    </View>
  );
}

function ItemRow({
  item,
  timeOf,
  takingOf,
  onOpen,
  compact,
}: DayWeekProps & { item: AgendaItem; compact?: boolean }) {
  const { t } = useTranslation();
  return (
    <EventRow
      time={timeOf(item)}
      kind={t(kindKey(item.event.kind))}
      title={item.event.title}
      taking={takingOf(item)}
      compact={compact}
      onPress={onOpen ? () => onOpen(item) : undefined}
      testID={`calendar-event-${item.key}`}
    />
  );
}

/**
 * S-36 week view (FR2-CAL-1): the seven days from the household's week start, each with its
 * busy marker, meals (FR2-CAL-5) and items. A day's name opens it in the day view. At the
 * largest text sizes the screen shows the agenda instead (NFR2-A11Y-1).
 */
export function WeekView(props: DayWeekProps & { onOpenDay: (date: PlanDate) => void }) {
  const { t } = useTranslation();
  const theme = useTheme();
  const { locale, timeZone, weekStart, today, date, onDateChange, onOpenDay } = props;
  const start = startOfWeek(date, weekStart);
  const days = useDays(timeZone, weekStart, start, 7);
  const meals = useCalendarMeals();
  const thisWeek = startOfWeek(today, weekStart);

  return (
    <View style={{ gap: theme.space[3] }} testID="calendar-week-view">
      <Stepper
        label={t('calendar.views.range', {
          start: formatDate(toDate(start), locale, RANGE_FORMAT),
          end: formatDate(toDate(addDays(start, 6)), locale, RANGE_FORMAT),
        })}
        previousLabel={t('calendar.views.previousWeek')}
        nextLabel={t('calendar.views.nextWeek')}
        onStep={(direction) => onDateChange(addDays(start, direction * 7))}
        onToday={start === thisWeek ? null : () => onDateChange(today)}
        testID="calendar-week"
      />
      {days.map((day: AgendaDay) => (
        <Card
          key={day.date}
          variant={day.date === today ? 'highlight' : 'default'}
          style={{ gap: theme.space[2] }}
          testID={`calendar-week-day-${day.date}`}
        >
          <View style={[styles.wrap, { gap: theme.space[2] }]}>
            <Pressable
              onPress={() => onOpenDay(day.date)}
              accessibilityRole="button"
              accessibilityLabel={t('calendar.views.openDay', {
                day: formatDate(toDate(day.date), locale, DAY_FORMAT),
              })}
              testID={`calendar-week-open-${day.date}`}
              style={({ pressed }) => [
                styles.shrink,
                { minHeight: theme.layout.minTarget, justifyContent: 'center' },
                pressed && { opacity: PRESSED_OPACITY },
              ]}
            >
              <Text variant="cardTitle" accessibilityRole="header">
                {formatDate(toDate(day.date), locale, SHORT_DAY)}
              </Text>
            </Pressable>
            {day.date === today ? <Tag label={t('calendar.today')} /> : null}
            <BusyMarkButton date={day.date} locale={locale} />
          </View>
          <BusyDayMarker date={day.date} locale={locale} />
          <MealsRow
            date={day.date}
            meals={meals.get(day.date)}
            locale={locale}
            onOpen={props.onOpenMeals}
          />
          {day.items.map((item) => (
            <ItemRow key={item.key} item={item} compact {...props} />
          ))}
        </Card>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center' },
  wrap: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap' },
  columns: { flexDirection: 'row', alignItems: 'flex-start' },
  grow: { flex: 1 },
  shrink: { flexShrink: 1 },
});
