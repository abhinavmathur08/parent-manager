import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';

import { Chip } from '@/components/chip';
import { Stepper } from '@/components/stepper';
import { Text } from '@/components/text';
import { addDays, daysBetween, toDate, type PlanDate } from '@/features/planner/week';
import { useTheme } from '@/hooks/use-theme';
import { formatDate, formatNumber, type AppLocale } from '@/i18n';

import { defaultRepeat, REPEAT_CHOICES, REPEAT_ENDS, type RepeatDraft } from './editor';
import { REPEAT_LIMITS } from './repeat';

const EPOCH = '1970-01-01';
/** 1970-01-05 was a Monday, so ISO weekday `d` is that date plus `d - 1` days. */
const MONDAY = '1970-01-05';
const WEEKDAYS = [1, 2, 3, 4, 5, 6, 7] as const;

/**
 * The repeat picker in S-37 (FR2-CAL-4): daily, weekly on chosen weekdays, every 2 weeks or
 * monthly on the same date, ending never, on a date or after a number of times. Weekday
 * names and dates come from `Intl` in the household's locale (NFR2-L10N-1).
 */
export function RepeatPicker({
  repeat: value,
  date,
  locale,
  onChange,
}: {
  repeat: RepeatDraft | undefined;
  date: PlanDate;
  locale: AppLocale;
  onChange: (repeat: RepeatDraft) => void;
}) {
  const { t } = useTranslation();
  const theme = useTheme();
  const repeat = value ?? defaultRepeat(date);
  const set = (patch: Partial<RepeatDraft>) => onChange({ ...repeat, ...patch });
  const weekly = repeat.choice === 'weekly' || repeat.choice === 'biweekly';
  const gap = { gap: theme.space[2] };

  return (
    <View style={gap} testID="event-repeat">
      <Text variant="label" accessibilityRole="header">
        {t('calendar.repeat.label')}
      </Text>
      <View style={[styles.wrap, gap]}>
        {REPEAT_CHOICES.map((choice) => (
          <Chip
            key={choice}
            label={t(`calendar.repeat.${choice}`)}
            selected={repeat.choice === choice}
            onPress={() => set({ choice })}
            testID={`event-repeat-${choice}`}
          />
        ))}
      </View>
      {weekly ? (
        <View style={[styles.wrap, gap]} accessibilityLabel={t('calendar.repeat.weekdays')}>
          {WEEKDAYS.map((day) => {
            const selected = repeat.weekdays.includes(day);
            return (
              <Chip
                key={day}
                label={formatDate(toDate(addDays(MONDAY, day - 1)), locale, {
                  weekday: 'short',
                  timeZone: 'UTC',
                })}
                selected={selected}
                onPress={() =>
                  set({
                    weekdays: selected
                      ? repeat.weekdays.filter((d) => d !== day)
                      : [...repeat.weekdays, day],
                  })
                }
                testID={`event-repeat-day-${day}`}
              />
            );
          })}
        </View>
      ) : null}
      {repeat.choice !== 'none' ? (
        <>
          <Text variant="label">{t('calendar.repeat.ends')}</Text>
          <View style={[styles.wrap, gap]}>
            {REPEAT_ENDS.map((end) => (
              <Chip
                key={end}
                label={t(`calendar.repeat.end.${end}`)}
                selected={repeat.end === end}
                onPress={() => set({ end })}
                testID={`event-repeat-end-${end}`}
              />
            ))}
          </View>
          {repeat.end === 'until' ? (
            <Stepper
              accessibilityLabel={t('calendar.repeat.until')}
              value={daysBetween(EPOCH, repeat.until)}
              min={daysBetween(EPOCH, date)}
              onChange={(n) => set({ until: addDays(EPOCH, n) })}
              formatValue={(n) =>
                formatDate(toDate(addDays(EPOCH, n)), locale, {
                  month: 'short',
                  day: 'numeric',
                  year: 'numeric',
                  timeZone: 'UTC',
                })
              }
              testID="event-repeat-until"
            />
          ) : null}
          {repeat.end === 'count' ? (
            <Stepper
              accessibilityLabel={t('calendar.repeat.count')}
              value={repeat.count}
              min={1}
              max={REPEAT_LIMITS.maxCount}
              onChange={(count) => set({ count })}
              formatValue={(n) =>
                t('calendar.repeat.times', { count: n, formatted: formatNumber(n, locale) })
              }
              testID="event-repeat-count"
            />
          ) : null}
        </>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flexDirection: 'row', flexWrap: 'wrap' },
});
