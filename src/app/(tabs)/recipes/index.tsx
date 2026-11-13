import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { Button } from '@/components/button';
import { EmptyState } from '@/components/empty-state';
import { ListRow } from '@/components/list-row';
import { Screen } from '@/components/screen';
import { useHousehold } from '@/features/household/membership';
import { useRecipeRows } from '@/features/recipes/data';

// S-16, first cut: the household's recipes and "add". Search, filters and the starter
// library arrive with R-03.1 and R-04.1.
export default function RecipesScreen() {
  const { t } = useTranslation();
  const { state } = useHousehold();
  const { recipes } = useRecipeRows();
  const canWrite = state.status === 'member' && state.membership.role !== 'caregiver';
  const add = () => router.push('/recipes/edit');
  const sorted = [...recipes].sort((a, b) => (a.title < b.title ? -1 : 1));
  return (
    <Screen title={t('recipes.title')} testID="recipes-screen">
      {sorted.length === 0 ? (
        <EmptyState
          icon="recipes"
          message={t('recipes.empty')}
          actionLabel={canWrite ? t('recipes.add') : undefined}
          onAction={canWrite ? add : undefined}
          testID="recipes-empty"
        />
      ) : (
        <>
          {sorted.map((recipe, i) => (
            <ListRow
              key={recipe.id}
              title={recipe.title}
              variant={canWrite ? 'navigation' : 'plain'}
              onPress={
                canWrite
                  ? () => router.push({ pathname: '/recipes/edit', params: { id: recipe.id } })
                  : undefined
              }
              divider={i < sorted.length - 1}
              testID={`recipes-row-${i}`}
            />
          ))}
          {canWrite ? (
            <Button icon="add" label={t('recipes.add')} onPress={add} testID="recipes-add" />
          ) : null}
        </>
      )}
    </Screen>
  );
}
