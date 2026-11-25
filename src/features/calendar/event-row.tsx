import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet } from 'react-native';

import { PRESSED_OPACITY } from '@/components/focus-ring';
import { Icon } from '@/components/icon';
import { Text } from '@/components/text';
import { useRecipeRows } from '@/features/recipes/data';
import { usePlanRows } from '@/features/planner/data';
import type { PlanEntryRow } from '@/features/planner/tables';
import { toDate, type PlanDate } from '@/features/planner/week';
import { useTheme } from '@/hooks/use-theme';
import { formatDate, formatList, formatTime, type AppLocale } from '@/i18n';

import type { AgendaItem } from './agenda';
import { useCalendarMembers } from './use-members';
import { mealsByDate, type SlotMeals } from './views';

/** The kind's name, from its identifier (NFR2-L10N-1). */
export function kindKey(kind: AgendaItem['event']['kind']): string {
  return `calendar.kinds.${kind.slice('kind.'.length)}`;
}

/** How an occurrence's time reads: "All day" or its range on the household's clock. */
export function useTimeOf(locale: AppLocale, timeZone: string) {
  const { t } = useTranslation();
  return (item: AgendaItem): string => {
    const { occurrence } = item;
    if (occurrence.allDay) return t('calendar.allDay');
    return t('calendar.timeRange', {
      start: formatTime(new Date(occurrence.startsAt!), locale, timeZone),
      end: formatTime(new Date(occurrence.endsAt!), locale, timeZone),
    });
  };
}

/**
 * Who's taking an occurrence, for its row: "You", a member's name, or null for nobody yet.
 * Names come from the members list, so offline with nothing cached it reads "A member".
 */
export function useTakingName(householdId: string, userId: string | null) {
  const { t } = useTranslation();
  const members = useCalendarMembers(householdId);
  return (item: AgendaItem): string | null => {
    const id = item.occurrence.takingUserId;
    if (!id) return null;
    if (id === userId) return t('calendar.detail.you');
    return members.find((m) => m.userId === id)?.displayName ?? t('calendar.detail.member');
  };
}

export type EventRowProps = {
  time: string;
  kind: string;
  title: string;
  /** Who's taking it, or null for nobody yet. */
  taking: string | null;
  /** The week view's denser row: time and title together, kind and taking left to the label. */
  compact?: boolean;
  onPress?: () => void;
  testID: string;
};

/** One occurrence in the agenda, day or week view. */
export function EventRow({ time, kind, title, taking, compact, onPress, testID }: EventRowProps) {
  const { t } = useTranslation();
  const theme = useTheme();
  const takingText = taking ? t('calendar.taking', { name: taking }) : t('calendar.nobodyTaking');
  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      accessibilityRole={onPress ? 'button' : undefined}
      // Announces the kind, time, title and taking member (NFR2-A11Y-1).
      accessibilityLabel={t('calendar.eventLabel', { kind, time, title, taking: takingText })}
      testID={testID}
      style={({ pressed }) => [
        {
          minHeight: theme.layout.minRowHeight,
          padding: compact ? theme.space[3] : theme.space[4],
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
      {compact ? null : (
        <Text variant="caption" color="textSecondary">
          {taking ? t('calendar.kindTaking', { kind, taking: takingText }) : kind}
        </Text>
      )}
    </Pressable>
  );
}

/** Each date's planned meals from the local copy of the plan (FR2-CAL-5). */
export function useCalendarMeals(): Map<PlanDate, SlotMeals[]> {
  const { t } = useTranslation();
  const { entries } = usePlanRows();
  const { recipes } = useRecipeRows();
  return useMemo(() => {
    const titles = new Map(recipes.filter((r) => !r.deleted_at).map((r) => [r.id, r.title]));
    const titleOf = (entry: PlanEntryRow) =>
      (entry.recipe_id ? titles.get(entry.recipe_id) : undefined) ??
      entry.free_text ??
      t('plan.deletedRecipe');
    return mealsByDate(entries, titleOf);
  }, [entries, recipes, t]);
}

const DAY_FORMAT = { weekday: 'long', month: 'long', day: 'numeric', timeZone: 'UTC' } as const;

/**
 * A day's planned meals as one compact row, read only (FR2-CAL-5). Tapping it opens the Plan
 * tab on that day. Nothing renders on a day with nothing planned.
 */
export function MealsRow({
  date,
  meals,
  locale,
  onOpen,
}: {
  date: PlanDate;
  meals: readonly SlotMeals[] | undefined;
  locale: AppLocale;
  onOpen?: (date: PlanDate) => void;
}) {
  const { t } = useTranslation();
  const theme = useTheme();
  if (!meals?.length) return null;
  const text = meals
    .map(({ slot, titles }) =>
      t('calendar.meals.slot', {
        slot: t(`plan.slots.${slot}`),
        meals: formatList(titles, locale),
      }),
    )
    .join(t('calendar.meals.separator'));
  return (
    <Pressable
      onPress={onOpen ? () => onOpen(date) : undefined}
      disabled={!onOpen}
      accessibilityRole={onOpen ? 'button' : undefined}
      accessibilityLabel={t('calendar.meals.label', {
        day: formatDate(toDate(date), locale, DAY_FORMAT),
        meals: text,
      })}
      accessibilityHint={onOpen ? t('calendar.meals.hint') : undefined}
      testID={`calendar-meals-${date}`}
      style={({ pressed }) => [
        styles.row,
        {
          minHeight: theme.layout.minTarget,
          gap: theme.space[2],
          paddingHorizontal: theme.space[3],
          paddingVertical: theme.space[2],
          borderRadius: theme.radius.card,
          backgroundColor: theme.color.surfaceAlt,
        },
        pressed && { opacity: PRESSED_OPACITY },
      ]}
    >
      <Icon name="plan" size="sm" color="textSecondary" />
      <Text variant="caption" style={styles.grow}>
        {text}
      </Text>
      {onOpen ? <Icon name="forward" size="sm" color="textSecondary" /> : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center' },
  grow: { flex: 1 },
});
