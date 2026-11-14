import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, View } from 'react-native';

import { BottomSheet } from '@/components/bottom-sheet';
import { ListRow } from '@/components/list-row';
import { SectionHeader } from '@/components/section-header';
import { Stepper } from '@/components/stepper';
import { Text } from '@/components/text';
import { TextField } from '@/components/text-field';
import { useIngredients } from '@/features/ingredients/use-ingredients';
import { useRecipeRows } from '@/features/recipes/data';
import { indexRecipe, searchRecipes } from '@/features/recipes/search';
import { STARTER_RECIPES } from '@/features/recipes/starter/library';
import { starterEntry } from '@/features/recipes/starter/view';
import type { RecipeTag } from '@/features/recipes/tables';
import { useTheme } from '@/hooks/use-theme';
import { formatDate, formatNumber, type AppLocale } from '@/i18n';

import { recentRecipeIds } from './plan';
import { PLAN_LIMITS, type PlanEntryRow, type Slot } from './tables';
import { toDate, type PlanDate } from './week';
import type { PlanChoice } from './writes';

const RECENT_LIMIT = 6;
const MAX_SERVINGS = 24;

export type AddTarget = { date: PlanDate; slot: Slot };

/**
 * S-11, the add sheet (FR-PLAN-3, FR-PLAN-4, FR-PLAN-5): recent recipes, search across the
 * household's and the starter recipes, and free text such as "takeout", with servings set
 * first. One tap on a result adds it. Reads the local copy, so it works offline.
 */
export function AddSheet({
  target,
  locale,
  entries,
  defaultServings,
  onAdd,
  onClose,
}: {
  target: AddTarget | null;
  locale: AppLocale;
  entries: readonly PlanEntryRow[];
  defaultServings: number;
  onAdd: (choice: PlanChoice, servings: number, via: 'recent' | 'search') => Promise<void>;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const slot = target ? t(`plan.slots.${target.slot}`) : '';
  const day = target
    ? formatDate(toDate(target.date), locale, { weekday: 'long', timeZone: 'UTC' })
    : '';
  return (
    <BottomSheet
      visible={target !== null}
      onClose={onClose}
      title={t('plan.add.title', { slot, day })}
      variant="form"
      testID="add-sheet"
    >
      {target ? (
        <AddSheetBody
          // A fresh body per slot, so the query and servings start over.
          key={`${target.date}-${target.slot}`}
          locale={locale}
          entries={entries}
          defaultServings={defaultServings}
          onAdd={onAdd}
        />
      ) : null}
    </BottomSheet>
  );
}

function AddSheetBody({
  locale,
  entries,
  defaultServings,
  onAdd,
}: {
  locale: AppLocale;
  entries: readonly PlanEntryRow[];
  defaultServings: number;
  onAdd: (choice: PlanChoice, servings: number, via: 'recent' | 'search') => Promise<void>;
}) {
  const { t } = useTranslation();
  const theme = useTheme();
  const { recipes, lines } = useRecipeRows();
  const ingredients = useIngredients(locale);
  const [query, setQuery] = useState('');
  const [servings, setServings] = useState(defaultServings);
  const [busy, setBusy] = useState(false);

  const household = useMemo(() => {
    const tagName = (tag: RecipeTag) => t(`recipes.tags.${tag.slice(4)}`);
    const names = new Map<string, string[]>();
    for (const line of lines) {
      if (line.deleted_at) continue;
      const name = ingredients.name(line.ingredient_id);
      if (name) names.set(line.recipe_id, [...(names.get(line.recipe_id) ?? []), name]);
    }
    return recipes
      .filter((r) => !r.deleted_at)
      .map((r) =>
        indexRecipe(
          {
            id: r.id,
            title: r.title,
            tags: r.tags,
            totalMinutes: null,
            updatedAt: r.updated_at,
            ingredientNames: names.get(r.id) ?? [],
          },
          tagName,
        ),
      );
  }, [recipes, lines, ingredients, t]);
  const starters = useMemo(() => {
    const tagName = (tag: RecipeTag) => t(`recipes.tags.${tag.slice(4)}`);
    return STARTER_RECIPES.map((s) =>
      indexRecipe(
        starterEntry(s, locale, (id) => ingredients.name(id)),
        tagName,
      ),
    );
  }, [locale, ingredients, t]);

  const text = query.trim();
  const searching = text !== '';
  const recent = useMemo(() => {
    const byId = new Map(household.map((r) => [r.id, r]));
    return recentRecipeIds(entries, recipes, RECENT_LIMIT).flatMap((id) => byId.get(id) ?? []);
  }, [entries, recipes, household]);
  const householdResults = useMemo(
    () => (searching ? searchRecipes(household, text, []) : recent),
    [searching, household, text, recent],
  );
  const starterResults = useMemo(
    () => (searching ? searchRecipes(starters, text, []) : recent.length ? [] : starters),
    [searching, starters, text, recent.length],
  );

  const add = async (choice: PlanChoice, via: 'recent' | 'search') => {
    if (busy) return;
    setBusy(true);
    try {
      await onAdd(choice, servings, via);
    } catch {
      Alert.alert(t('plan.add.failed'));
      setBusy(false);
    }
  };
  const via = searching ? 'search' : 'recent';

  return (
    <View style={{ gap: theme.space[4] }}>
      <View style={{ gap: theme.space[2] }}>
        <Text variant="label" color="textSecondary">
          {t('plan.add.servings')}
        </Text>
        <Stepper
          value={servings}
          onChange={setServings}
          min={PLAN_LIMITS.servingsStep * 2}
          max={MAX_SERVINGS}
          step={0.5}
          accessibilityLabel={t('plan.add.servings')}
          formatValue={(value) => formatNumber(value, locale)}
          testID="add-servings"
        />
      </View>
      <TextField
        variant="search"
        accessibilityLabel={t('plan.add.search')}
        placeholder={t('plan.add.search')}
        value={query}
        onChangeText={setQuery}
        autoCorrect={false}
        maxLength={PLAN_LIMITS.freeTextLength}
        testID="add-search"
      />

      {householdResults.length ? (
        <View>
          <SectionHeader
            title={t(searching ? 'plan.add.household' : 'plan.add.recent')}
            testID="add-household-header"
          />
          {householdResults.map((recipe, i) => (
            <ListRow
              key={recipe.id}
              title={recipe.title}
              onPress={() => void add({ kind: 'recipe', recipeId: recipe.id }, via)}
              disabled={busy}
              divider
              testID={`add-recipe-${i}`}
            />
          ))}
        </View>
      ) : null}

      {starterResults.length ? (
        <View>
          <SectionHeader title={t('plan.add.starter')} testID="add-starter-header" />
          {starterResults.map((recipe, i) => (
            <ListRow
              key={recipe.id}
              title={recipe.title}
              onPress={() => void add({ kind: 'starter', key: recipe.id }, via)}
              disabled={busy}
              divider
              testID={`add-starter-${i}`}
            />
          ))}
        </View>
      ) : null}

      {searching ? (
        <ListRow
          title={t('plan.add.freeText', { text })}
          subtitle={t('plan.add.freeTextHint')}
          onPress={() => void add({ kind: 'text', text }, 'search')}
          disabled={busy}
          testID="add-free-text"
        />
      ) : null}
      {searching && !householdResults.length && !starterResults.length ? (
        <Text color="textSecondary" testID="add-no-results">
          {t('plan.add.noResults')}
        </Text>
      ) : null}
    </View>
  );
}
