import { randomUUID } from 'expo-crypto';
import { router, useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Alert } from 'react-native';

import { EmptyState } from '@/components/empty-state';
import { Screen } from '@/components/screen';
import { useHousehold } from '@/features/household/membership';
import { useIngredients } from '@/features/ingredients/use-ingredients';
import { useApplyOps } from '@/features/recipes/data';
import { planSave } from '@/features/recipes/draft';
import { RecipeDetail } from '@/features/recipes/recipe-detail';
import { findStarter } from '@/features/recipes/starter/library';
import { copyStarter, starterView } from '@/features/recipes/starter/view';

/** S-17 for a starter recipe: read-only, with "save a copy" for parents and family (FR-REC-3). */
export default function StarterRecipeRoute() {
  const { t } = useTranslation();
  const { key } = useLocalSearchParams<{ key: string }>();
  const { state } = useHousehold();
  const locale = state.status === 'member' ? state.membership.locale : 'en-US';
  const ingredients = useIngredients(locale);
  const apply = useApplyOps();
  const starter = key ? findStarter(key) : undefined;

  if (state.status !== 'member') return null;
  if (!starter) {
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
  const { householdId, unitSystem, role } = state.membership;

  async function saveCopy() {
    if (!starter) return;
    const recipeId = randomUUID();
    try {
      await apply(
        planSave(null, copyStarter(starter, locale, randomUUID), {
          recipeId,
          locale,
          dimension: (id) => ingredients.dimension(id),
          origin: { sourceType: 'library', libraryRecipeId: starter.key },
        }),
      );
      router.replace({ pathname: '/recipes/[id]', params: { id: recipeId } });
    } catch {
      Alert.alert(t('recipes.starter.copyFailed'));
    }
  }

  return (
    <RecipeDetail
      recipe={starterView(starter, locale)}
      household={{ id: householdId, locale, unitSystem }}
      actions={
        role === 'caregiver'
          ? undefined
          : [
              {
                label: t('recipes.starter.saveCopy'),
                onPress: () => void saveCopy(),
                testID: 'recipe-save-copy',
              },
            ]
      }
    />
  );
}
