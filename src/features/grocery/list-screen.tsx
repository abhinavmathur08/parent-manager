import { router } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';

import { AllergenNotice } from '@/components/allergen-notice';
import { Banner } from '@/components/banner';
import { CheckboxRow } from '@/components/checkbox-row';
import { EmptyState } from '@/components/empty-state';
import { ListRow } from '@/components/list-row';
import { Screen } from '@/components/screen';
import { SectionHeader } from '@/components/section-header';
import { Text } from '@/components/text';
import { Toast } from '@/components/toast';
import { nameKey } from '@/features/ingredients/catalog-ids';
import { useIngredients } from '@/features/ingredients/use-ingredients';
import { startOfWeek, todayIn, type WeekStart } from '@/features/planner/week';
import { useHouseholdAllergies } from '@/features/recipes/use-household-allergies';
import { useOnline } from '@/hooks/use-online';
import { useTheme } from '@/hooks/use-theme';
import { formatList, formatQuantity, type AppLocale, type UnitSystem } from '@/i18n';

import { useGroceryRows } from './data';
import { onListUpdated, requestRegenerate, useOpenListWeek, type ListUpdated } from './list-events';
import type { GroceryItemRow } from './tables';
import { buildListView, type ListRowView } from './view';
import { useToggleItem } from './writes';

export type ListHousehold = {
  id: string;
  locale: AppLocale;
  unitSystem: UnitSystem;
  weekStart: WeekStart;
  timezone: string | null;
  /** Caregivers shop and edit but don't regenerate (spec section 2.2, row 29). */
  canRegenerate: boolean;
};

/**
 * S-13, the List tab (FR-LIST-3 to FR-LIST-5, FR-LIST-11): this week's list by store section,
 * with large check-off rows, quantities in the household's units, source hints, allergen
 * markers (R-LIST-8) and the collapsed "in the cart" group. Everything reads and writes the
 * local copy, so it works offline. While it's open, a plan change shows what changed.
 */
export function ListScreen({ household }: { household: ListHousehold }) {
  const { t } = useTranslation();
  const theme = useTheme();
  const online = useOnline();
  const { locale, unitSystem } = household;
  const weekStart = useMemo(
    () => startOfWeek(todayIn(household.timezone), household.weekStart),
    [household.timezone, household.weekStart],
  );
  useOpenListWeek(weekStart);

  const { lists, items, sources, loading } = useGroceryRows();
  const ingredients = useIngredients(locale);
  const { people } = useHouseholdAllergies(household.id);
  const toggleItem = useToggleItem();
  const [cartOpen, setCartOpen] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const list = lists.find((l) => !l.deleted_at && l.is_default && l.week_start === weekStart);
  const listId = list?.id ?? null;
  const byId = useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);

  const view = useMemo(() => {
    const nameOf = (item: GroceryItemRow) => {
      if (item.custom_name) return item.custom_name;
      if (!item.ingredient_id) return t('list.unknownItem');
      const count = item.dimension === 'count' ? item.quantity_base : null;
      return ingredients.nameFor(item.ingredient_id, count) ?? t('list.unknownItem');
    };
    return buildListView({
      listId: listId ?? '',
      items,
      sources,
      system: unitSystem,
      locale,
      nameOf,
      allergensOf: (id) => ingredients.allergens(id),
      people,
    });
  }, [listId, items, sources, unitSystem, locale, ingredients, people, t]);

  // FR-LIST-3: a short summary when a recalculation changes the open list.
  useEffect(
    () =>
      onListUpdated((update: ListUpdated) => {
        if (update.listId !== null && update.listId !== listId) return;
        const { added, changed, removed } = update.summary;
        const parts = [
          added ? t('list.added', { count: added }) : null,
          changed ? t('list.changed', { count: changed }) : null,
          removed ? t('list.removed', { count: removed }) : null,
        ].filter((p): p is string => p !== null);
        if (parts.length) setMessage(t('list.updated', { changes: formatList(parts, locale) }));
        else if (update.regenerated) setMessage(t('list.upToDate'));
      }),
    [listId, locale, t],
  );

  const detailOf = (row: ListRowView) =>
    [
      row.quantity ? formatQuantity(row.quantity, locale) : null,
      row.meals
        ? t('list.forMeals', { count: row.meals })
        : row.origin === 'manual'
          ? t('list.manual')
          : null,
      row.planChanged ? t('list.planChanged') : null,
    ]
      .filter((p): p is string => p !== null)
      .join(t('list.detailSeparator'));

  const renderRow = (row: ListRowView, testID: string) => {
    const item = byId.get(row.id);
    return (
      <View key={row.id}>
        <CheckboxRow
          label={row.name}
          detail={detailOf(row) || undefined}
          checked={row.checked}
          onToggle={(checked) => {
            if (item) void toggleItem(item, checked);
          }}
          testID={testID}
        />
        {row.allergens.map((match) => (
          <AllergenNotice
            key={match.allergen}
            variant="inline"
            allergen={t(nameKey(match.allergen))}
            person={formatList(match.people, locale)}
            style={{ marginHorizontal: theme.space[4], marginBottom: theme.space[2] }}
            testID={`${testID}-allergen-${match.allergen.slice('allergen.'.length)}`}
          />
        ))}
      </View>
    );
  };

  const empty = !loading && view.total === 0;
  const allDone = !loading && view.total > 0 && view.sections.length === 0;

  return (
    <View style={styles.fill}>
      <Screen
        title={t('list.title')}
        actions={
          household.canRegenerate && view.total > 0
            ? [
                {
                  label: t('list.regenerate'),
                  onPress: requestRegenerate,
                  testID: 'list-regenerate',
                },
              ]
            : undefined
        }
        banner={
          online ? null : (
            <Banner variant="offline" message={t('list.offline')} testID="list-offline" />
          )
        }
        testID="list-screen"
      >
        {empty ? (
          <EmptyState
            icon="list"
            message={t('list.empty')}
            actionLabel={t('list.planMeals')}
            onAction={() => router.navigate('/plan')}
            testID="list-empty"
          />
        ) : null}
        {allDone ? (
          <Text color="textSecondary" testID="list-all-done">
            {t('list.allDone')}
          </Text>
        ) : null}
        {view.sections.map((section) => (
          <View
            key={section.sectionId}
            testID={`list-section-${section.sectionId.slice('section.'.length)}`}
          >
            <SectionHeader
              title={t(nameKey(section.sectionId))}
              trailing={t('list.count', { count: section.rows.length })}
              style={{ marginHorizontal: -theme.space[4] }}
            />
            <View
              style={[
                styles.group,
                { borderRadius: theme.radius.card, borderColor: theme.color.border },
              ]}
            >
              {section.rows.map((row, i) =>
                renderRow(row, `list-item-${section.sectionId.slice('section.'.length)}-${i}`),
              )}
            </View>
          </View>
        ))}
        {view.cart.length ? (
          <View testID="list-cart">
            <ListRow
              title={t('list.inCart')}
              variant="value"
              value={t('list.count', { count: view.cart.length })}
              accessibilityHint={cartOpen ? t('list.hideCart') : t('list.showCart')}
              onPress={() => setCartOpen((open) => !open)}
              testID="list-cart-toggle"
            />
            {cartOpen ? (
              <View
                style={[
                  styles.group,
                  { borderRadius: theme.radius.card, borderColor: theme.color.border },
                ]}
              >
                {view.cart.map((row, i) => renderRow(row, `list-cart-item-${i}`))}
              </View>
            ) : null}
          </View>
        ) : null}
      </Screen>
      <Toast
        visible={message !== null}
        message={message ?? ''}
        onDismiss={() => setMessage(null)}
        testID="list-updated"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  group: { borderWidth: StyleSheet.hairlineWidth, overflow: 'hidden' },
});
