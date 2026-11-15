import { router, useLocalSearchParams } from 'expo-router';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { EmptyState } from '@/components/empty-state';
import { Screen } from '@/components/screen';
import { useHousehold } from '@/features/household/membership';
import { usePlanRows } from '@/features/planner/data';
import { startOfWeek, todayIn } from '@/features/planner/week';
import { useApplyOps, useRecipe, viewFromSaved } from '@/features/recipes/data';
import { planRecipeDeletion } from '@/features/recipes/delete';
import { DeleteRecipeSheet } from '@/features/recipes/delete-sheet';
import { RecipeDetail } from '@/features/recipes/recipe-detail';
import { track } from '@/lib/analytics';

/** S-17 for a household recipe. Parents and family members can edit or delete it. */
export default function RecipeDetailRoute() {
  const { t } = useTranslation();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { state } = useHousehold();
  const { saved, loading } = useRecipe(id);
  const plan = usePlanRows();
  const apply = useApplyOps();
  const [deleting, setDeleting] = useState(false);
  const membership = state.status === 'member' ? state.membership : null;

  const deletion = useMemo(() => {
    if (!saved || !membership) return null;
    const weekStart = membership.weekStart === 1 ? 1 : 7;
    const from = startOfWeek(todayIn(membership.timezone ?? null), weekStart);
    return planRecipeDeletion(saved.recipe, plan.entries, from);
  }, [saved, membership, plan.entries]);

  if (!membership || loading) return null;
  if (!saved || saved.recipe.deleted_at) {
    return (
      <Screen title={t('recipes.title')} onBack={() => router.back()} testID="recipe-missing">
        <EmptyState
          icon="recipes"
          message={t('recipes.detail.missing')}
          testID="recipe-missing-empty"
        />
      </Screen>
    );
  }
  const { householdId, locale, unitSystem, role } = membership;
  const canWrite = role !== 'caregiver';

  async function remove() {
    if (!deletion) return;
    await apply(deletion.ops);
    track('recipe_deleted', { plan_entries_affected: deletion.affected });
    setDeleting(false);
    router.back();
  }

  return (
    <>
      <RecipeDetail
        recipe={viewFromSaved(saved)}
        household={{ id: householdId, locale, unitSystem }}
        actions={
          canWrite
            ? [
                {
                  label: t('recipes.detail.edit'),
                  onPress: () =>
                    router.push({ pathname: '/recipes/edit', params: { id: saved.recipe.id } }),
                  testID: 'recipe-detail-edit',
                },
              ]
            : undefined
        }
        onDelete={canWrite && !plan.loading ? () => setDeleting(true) : undefined}
      />
      <DeleteRecipeSheet
        visible={deleting}
        title={saved.recipe.title}
        upcoming={deletion?.upcoming ?? 0}
        locale={locale}
        onDelete={remove}
        onClose={() => setDeleting(false)}
      />
    </>
  );
}
