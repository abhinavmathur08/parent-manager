import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';

import { Button } from '@/components/button';
import { Chip } from '@/components/chip';
import { EmptyState } from '@/components/empty-state';
import { Screen } from '@/components/screen';
import { SectionHeader } from '@/components/section-header';
import { Text } from '@/components/text';
import { TextField } from '@/components/text-field';
import { useIngredients } from '@/features/ingredients/use-ingredients';
import { useTheme } from '@/hooks/use-theme';
import type { AppLocale } from '@/i18n';

import { useRecipeRows } from './data';
import { RecipeCard } from './recipe-card';
import { indexRecipe, searchRecipes, sortRecipes, type RecipeEntry } from './search';
import { RECIPE_TAGS, type RecipeIngredientRow, type RecipeTag } from './tables';

const totalMinutes = (prep: number | null, cook: number | null) =>
  prep === null && cook === null ? null : (prep ?? 0) + (cook ?? 0);

/**
 * S-16, the Recipes tab (FR-REC-1, FR-REC-7, FR-REC-10): the household's recipes, newest
 * first, with search across titles, ingredient names and tags, and tag filters. Everything
 * reads the local copy, so it works offline.
 */
export function RecipesScreen({ locale, canWrite }: { locale: AppLocale; canWrite: boolean }) {
  const { t } = useTranslation();
  const theme = useTheme();
  const { recipes, lines, loading } = useRecipeRows();
  const ingredients = useIngredients(locale);
  const [query, setQuery] = useState('');
  const [tags, setTags] = useState<RecipeTag[]>([]);

  const searchable = useMemo(() => {
    const byRecipe = new Map<string, RecipeIngredientRow[]>();
    for (const line of lines) {
      const list = byRecipe.get(line.recipe_id) ?? [];
      list.push(line);
      byRecipe.set(line.recipe_id, list);
    }
    const tagName = (tag: RecipeTag) => t(`recipes.tags.${tag.slice(4)}`);
    const entries: RecipeEntry[] = recipes.map((recipe) => ({
      id: recipe.id,
      title: recipe.title,
      tags: recipe.tags,
      totalMinutes: totalMinutes(recipe.prep_minutes, recipe.cook_minutes),
      updatedAt: recipe.updated_at,
      ingredientNames: (byRecipe.get(recipe.id) ?? []).flatMap(
        (line) => ingredients.name(line.ingredient_id) ?? [],
      ),
    }));
    return sortRecipes(entries, locale).map((entry) => indexRecipe(entry, tagName));
  }, [recipes, lines, ingredients, locale, t]);

  const results = useMemo(() => searchRecipes(searchable, query, tags), [searchable, query, tags]);
  const filtering = query.trim() !== '' || tags.length > 0;

  const add = () => router.push('/recipes/edit');
  // Recipe detail (S-17) arrives with R-03.2; until then a card opens the editor for writers.
  const open = (id: string) =>
    canWrite ? router.push({ pathname: '/recipes/edit', params: { id } }) : undefined;

  return (
    <Screen
      title={t('recipes.title')}
      actions={
        canWrite
          ? [{ label: t('recipes.addShort'), onPress: add, testID: 'recipes-add' }]
          : undefined
      }
      testID="recipes-screen"
    >
      <View style={{ gap: theme.space[3] }}>
        <TextField
          variant="search"
          accessibilityLabel={t('recipes.search')}
          placeholder={t('recipes.search')}
          value={query}
          onChangeText={setQuery}
          autoCorrect={false}
          testID="recipes-search"
        />
        <View
          accessibilityLabel={t('recipes.filters')}
          style={[styles.wrap, { gap: theme.space[2] }]}
        >
          {RECIPE_TAGS.map((tag) => (
            <Chip
              key={tag}
              label={t(`recipes.tags.${tag.slice(4)}`)}
              selected={tags.includes(tag)}
              onPress={() =>
                setTags((current) =>
                  current.includes(tag) ? current.filter((x) => x !== tag) : [...current, tag],
                )
              }
              testID={`recipes-filter-${tag.slice(4)}`}
            />
          ))}
        </View>
      </View>

      {!loading && searchable.length === 0 ? (
        <View style={{ gap: theme.space[3] }}>
          <EmptyState
            icon="recipes"
            message={t('recipes.empty')}
            actionLabel={canWrite ? t('recipes.add') : undefined}
            onAction={canWrite ? add : undefined}
            testID="recipes-empty"
          />
          {canWrite ? (
            <Button
              variant="secondary"
              icon="share"
              label={t('recipes.import')}
              onPress={() => router.push('/recipes/import')}
              testID="recipes-import"
            />
          ) : null}
        </View>
      ) : (
        <View style={{ gap: theme.space[3] }}>
          <SectionHeader
            title={t('recipes.household')}
            trailing={filtering ? t('recipes.count', { count: results.length }) : undefined}
            testID="recipes-household-header"
          />
          {results.map((recipe, i) => (
            <RecipeCard
              key={recipe.id}
              recipe={recipe}
              locale={locale}
              onPress={() => open(recipe.id)}
              testID={`recipe-card-${i}`}
            />
          ))}
          {filtering && results.length === 0 ? (
            <Text color="textSecondary" testID="recipes-no-results">
              {t('recipes.noResults')}
            </Text>
          ) : null}
        </View>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
});
