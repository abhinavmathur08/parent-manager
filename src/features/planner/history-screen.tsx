import { router } from 'expo-router';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { Button } from '@/components/button';
import { Card } from '@/components/card';
import { Screen } from '@/components/screen';
import { Text } from '@/components/text';
import {
  GROCERY_ITEMS,
  GROCERY_LISTS,
  type GroceryItemRow,
  type GroceryListRow,
} from '@/features/grocery/tables';
import { useRecipeRows } from '@/features/recipes/data';
import { useEntitlement } from '@/features/subscription/entitlement';
import { usePremiumSheet } from '@/features/subscription/premium-sheet';
import { useTheme } from '@/hooks/use-theme';
import { formatDate, formatNumber } from '@/i18n';
import { useSyncedRows } from '@/lib/sync';

import { historyWeeks } from './history';
import { PLAN_ENTRIES, type PlanEntryRow } from './tables';
import { addDays, todayIn, toDate, type WeekStart } from './week';

const rangeFormat = { month: 'short', day: 'numeric', timeZone: 'UTC' } as const;
const dayFormat = { weekday: 'short', timeZone: 'UTC' } as const;

/**
 * S-34 History (G-08, FR-LIST-13, FR-PAY-6): past weeks' plans and lists, read only. A free
 * household sees the 4 weeks before this one; older weeks are kept on the server and show the
 * Premium prompt (the `history` trigger, FR-PAY-5).
 */
export function HistoryScreen({
  household,
}: {
  household: { locale: string; weekStart: WeekStart; timezone: string | null };
}) {
  const { t } = useTranslation();
  const theme = useTheme();
  const { isPremium } = useEntitlement();
  const { openPremiumSheet } = usePremiumSheet();
  const entries = useSyncedRows<PlanEntryRow>(PLAN_ENTRIES.name);
  const lists = useSyncedRows<GroceryListRow>(GROCERY_LISTS.name);
  const items = useSyncedRows<GroceryItemRow>(GROCERY_ITEMS.name);
  const recipes = useRecipeRows();
  const { locale } = household;

  const weeks = useMemo(() => {
    const titles = new Map(recipes.recipes.map((r) => [r.id, r.title]));
    return historyWeeks(
      entries.rows,
      lists.rows,
      items.rows,
      todayIn(household.timezone, new Date()),
      household.weekStart,
      (entry) =>
        (entry.recipe_id ? titles.get(entry.recipe_id) : undefined) ??
        entry.free_text ??
        t('plan.deletedRecipe'),
      !isPremium,
    );
  }, [entries.rows, lists.rows, items.rows, recipes.recipes, household, isPremium, t]);

  return (
    <Screen
      title={t('plan.history.title')}
      onBack={() => (router.canGoBack() ? router.back() : router.replace('/plan'))}
      testID="history-screen"
    >
      <Text color="textSecondary">{t('plan.history.intro')}</Text>
      {weeks.length === 0 ? (
        <Text color="textSecondary" testID="history-empty">
          {t('plan.history.empty')}
        </Text>
      ) : null}
      {weeks.map((week, index) => (
        <Card key={week.start} testID={`history-week-${index}`}>
          <View style={{ gap: theme.space[2] }}>
            <Text variant="cardTitle">
              {t('plan.range', {
                start: formatDate(toDate(week.start), locale, rangeFormat),
                end: formatDate(toDate(addDays(week.start, 6)), locale, rangeFormat),
              })}
            </Text>
            <Text variant="label" color="textSecondary">
              {t('plan.history.meals', { count: week.meals.length })}
            </Text>
            {week.meals.map((meal, n) => (
              <Text key={`${meal.date}-${n}`}>
                {formatDate(toDate(meal.date), locale, dayFormat)}: {meal.title}
              </Text>
            ))}
            <Text variant="label" color="textSecondary">
              {week.items
                ? t('plan.history.items', {
                    bought: formatNumber(week.items.bought, locale),
                    total: formatNumber(week.items.total, locale),
                  })
                : t('plan.history.noList')}
            </Text>
          </View>
        </Card>
      ))}
      {!isPremium ? (
        <Card variant="highlight" testID="history-older">
          <View style={{ gap: theme.space[3] }}>
            <Text variant="cardTitle">{t('plan.history.olderTitle')}</Text>
            <Text>{t('plan.history.olderBody')}</Text>
            <Button
              variant="secondary"
              label={t('premium.seePremium')}
              onPress={() => openPremiumSheet('history')}
              testID="history-see-premium"
            />
          </View>
        </Card>
      ) : null}
    </Screen>
  );
}
