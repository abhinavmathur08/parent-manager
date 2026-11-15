import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';

import { Button } from '@/components/button';
import { Screen } from '@/components/screen';
import { SectionHeader } from '@/components/section-header';
import { Text } from '@/components/text';
import { Toast } from '@/components/toast';
import { useListIngredientFacts } from '@/features/grocery/data';
import { nameKey } from '@/features/ingredients/catalog-ids';
import { useIngredients } from '@/features/ingredients/use-ingredients';
import { startOfWeek, todayIn, type WeekStart } from '@/features/planner/week';
import { useTheme } from '@/hooks/use-theme';
import type { AppLocale } from '@/i18n';
import { useSyncedRows } from '@/lib/sync';

import { AddStapleSheet } from './add-staple-sheet';
import { pantryView, type PantryRowView } from './pantry';
import { PANTRY_ITEMS, type PantryItemRow } from './tables';
import { useAddStaple, useRemoveStaple, useUndoHave } from './writes';

export type PantryHousehold = {
  id: string;
  locale: AppLocale;
  weekStart: WeekStart;
  timezone: string | null;
  /** Parents and family members manage staples; caregivers only mark "have" (FR-PAN-6). */
  canEditStaples: boolean;
};

/**
 * S-22 Pantry (G-03.2; FR-PAN-2 to FR-PAN-6): "have this week" with undo, then the staples
 * by store section with add and remove. Reads and writes the local copy, so it works offline
 * and syncs to partners.
 */
export function PantryScreen({ household }: { household: PantryHousehold }) {
  const { t } = useTranslation();
  const theme = useTheme();
  const { locale } = household;
  const weekStart = useMemo(
    () => startOfWeek(todayIn(household.timezone), household.weekStart),
    [household.timezone, household.weekStart],
  );
  const { rows, loading } = useSyncedRows<PantryItemRow>(PANTRY_ITEMS.name);
  const ingredients = useIngredients(locale);
  const { facts } = useListIngredientFacts();
  const addStaple = useAddStaple(household.id);
  const removeStaple = useRemoveStaple();
  const undoHave = useUndoHave();
  const [adding, setAdding] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const nameOf = (id: string) => ingredients.name(id) ?? t('pantry.unknown');
  const view = pantryView({
    rows,
    weekStart,
    nameOf,
    sectionOf: (id) => facts.section(id),
    locale,
  });
  const byId = new Map(rows.map((r) => [r.id, r]));
  const staples = new Set(
    rows.filter((r) => !r.deleted_at && r.status === 'staple').map((r) => r.ingredient_id),
  );

  const run = (task: Promise<unknown>, done: string) => {
    task.then(
      () => setMessage(done),
      () => setMessage(t('pantry.failed')),
    );
  };

  const row = (
    item: PantryRowView,
    action: { label: string; hint: string; onPress: () => void } | null,
    testID: string,
  ) => (
    <View
      key={item.rowId}
      style={[
        styles.row,
        {
          minHeight: theme.layout.minRowHeight,
          paddingHorizontal: theme.space[4],
          gap: theme.space[3],
          borderBottomColor: theme.color.border,
        },
      ]}
      testID={testID}
    >
      <Text style={styles.name} testID={`${testID}-name`}>
        {item.name}
      </Text>
      {action ? (
        <Button
          variant="ghost"
          label={action.label}
          accessibilityHint={action.hint}
          onPress={action.onPress}
          testID={`${testID}-action`}
        />
      ) : null}
    </View>
  );

  return (
    <View style={styles.fill}>
      <Screen
        title={t('pantry.title')}
        onBack={() => (router.canGoBack() ? router.back() : router.replace('/household'))}
        testID="pantry-screen"
      >
        <Text color="textSecondary">{t('pantry.intro')}</Text>

        <View testID="pantry-have">
          <SectionHeader title={t('pantry.have.title')} variant="group" />
          {view.have.length ? (
            view.have.map((item, i) =>
              row(
                item,
                {
                  label: t('pantry.have.undo'),
                  hint: t('pantry.have.undoHint', { name: item.name }),
                  onPress: () => {
                    const pantryRow = byId.get(item.rowId);
                    if (pantryRow) {
                      run(undoHave(pantryRow), t('pantry.have.undone', { name: item.name }));
                    }
                  },
                },
                `pantry-have-${i}`,
              ),
            )
          ) : (
            <Text color="textSecondary" testID="pantry-have-empty">
              {t('pantry.have.empty')}
            </Text>
          )}
        </View>

        <View testID="pantry-staples">
          <SectionHeader title={t('pantry.staples.title')} variant="group" />
          {!loading && !view.staples.length ? (
            <Text color="textSecondary" testID="pantry-staples-empty">
              {t('pantry.staples.empty')}
            </Text>
          ) : null}
          {view.staples.map((section) => {
            const key = section.sectionId.slice('section.'.length);
            return (
              <View key={section.sectionId} testID={`pantry-section-${key}`}>
                <SectionHeader
                  title={t(nameKey(section.sectionId))}
                  trailing={t('pantry.count', { count: section.rows.length })}
                  style={{ marginHorizontal: -theme.space[4] }}
                />
                {section.rows.map((item, i) =>
                  row(
                    item,
                    household.canEditStaples
                      ? {
                          label: t('pantry.staples.remove'),
                          hint: t('pantry.staples.removeHint', { name: item.name }),
                          onPress: () => {
                            const pantryRow = byId.get(item.rowId);
                            if (pantryRow) {
                              run(
                                removeStaple(pantryRow),
                                t('pantry.staples.removed', { name: item.name }),
                              );
                            }
                          },
                        }
                      : null,
                    `pantry-staple-${key}-${i}`,
                  ),
                )}
              </View>
            );
          })}
          {household.canEditStaples ? (
            <Button
              variant="secondary"
              icon="add"
              label={t('pantry.staples.add')}
              onPress={() => setAdding(true)}
              testID="pantry-add"
            />
          ) : (
            <Text color="textSecondary" testID="pantry-read-only">
              {t('pantry.staples.readOnly')}
            </Text>
          )}
        </View>

        <AddStapleSheet
          visible={adding}
          ingredients={ingredients}
          staples={staples}
          onAdd={(ingredientId) => {
            setAdding(false);
            const name = nameOf(ingredientId);
            run(addStaple(ingredientId, rows), t('pantry.staples.added', { name }));
          }}
          onClose={() => setAdding(false)}
        />
      </Screen>
      <Toast
        visible={message !== null}
        message={message ?? ''}
        onDismiss={() => setMessage(null)}
        testID="pantry-toast"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  name: { flex: 1, minWidth: 120 },
});
