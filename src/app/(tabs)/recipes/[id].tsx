import { router, useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { EmptyState } from '@/components/empty-state';
import { Screen } from '@/components/screen';
import { useHousehold } from '@/features/household/membership';
import { useRecipe, viewFromSaved } from '@/features/recipes/data';
import { RecipeDetail } from '@/features/recipes/recipe-detail';

/** S-17 for a household recipe. */
export default function RecipeDetailRoute() {
  const { t } = useTranslation();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { state } = useHousehold();
  const { saved, loading } = useRecipe(id);
  if (state.status !== 'member' || loading) return null;
  if (!saved) {
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
  const { householdId, locale, unitSystem, role } = state.membership;
  return (
    <RecipeDetail
      recipe={viewFromSaved(saved)}
      household={{ id: householdId, locale, unitSystem }}
      actions={
        role === 'caregiver'
          ? undefined
          : [
              {
                label: t('recipes.detail.edit'),
                onPress: () =>
                  router.push({ pathname: '/recipes/edit', params: { id: saved.recipe.id } }),
                testID: 'recipe-detail-edit',
              },
            ]
      }
    />
  );
}
