import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Linking, StyleSheet, View } from 'react-native';

import { AllergenNotice } from '@/components/allergen-notice';
import { Button } from '@/components/button';
import { ListRow } from '@/components/list-row';
import { Screen } from '@/components/screen';
import { Stepper } from '@/components/stepper';
import { Tag } from '@/components/tag';
import { Text } from '@/components/text';
import { nameKey } from '@/features/ingredients/catalog-ids';
import { useIngredients } from '@/features/ingredients/use-ingredients';
import { useTheme } from '@/hooks/use-theme';
import { formatList, formatNumber, type AppLocale, type UnitSystem } from '@/i18n';

import type { LineLike } from './format-line';
import { allergenMatches, scaledLineText } from './scale';
import { RECIPE_LIMITS, type RecipeSourceType, type RecipeTag } from './tables';
import { useHouseholdAllergies } from './use-household-allergies';

/** A recipe as S-17 shows it: a household recipe, or a starter recipe (R-04.1). */
export type RecipeView = {
  id: string;
  title: string;
  servings: number;
  prepMinutes: number | null;
  cookMinutes: number | null;
  tags: readonly RecipeTag[];
  notes: string | null;
  sourceType: RecipeSourceType;
  sourceUrl: string | null;
  lines: readonly (LineLike & { id: string; optional: boolean })[];
  steps: readonly { id: string; text: string }[];
};

/**
 * S-17, recipe detail (FR-REC-8, FR-REC-9, FR-AI-15): ingredients at the chosen servings
 * (the stepper rescales on screen only), steps, notes, where the recipe came from, and the
 * allergen notice with its disclaimer when a household person is allergic. The notice is a
 * safety feature and always free.
 */
export function RecipeDetail({
  recipe,
  household,
  actions,
}: {
  recipe: RecipeView;
  household: { id: string; locale: AppLocale; unitSystem: UnitSystem };
  /** At most two actions under the title, such as edit or "save a copy". */
  actions?: readonly { label: string; onPress: () => void; testID: string }[];
}) {
  const { t } = useTranslation();
  const theme = useTheme();
  const { locale, unitSystem } = household;
  const ingredients = useIngredients(locale);
  const allergies = useHouseholdAllergies(household.id);
  const [servings, setServings] = useState(recipe.servings);
  const ratio = servings / recipe.servings;

  const matches = useMemo(
    () =>
      allergenMatches(
        recipe.lines.map((l) => l.ingredientId),
        (id) => ingredients.allergens(id),
        allergies.people,
      ),
    [recipe.lines, ingredients, allergies.people],
  );

  const times = [
    recipe.prepMinutes !== null
      ? t('recipes.detail.prep', { minutes: formatNumber(recipe.prepMinutes, locale) })
      : null,
    recipe.cookMinutes !== null
      ? t('recipes.detail.cook', { minutes: formatNumber(recipe.cookMinutes, locale) })
      : null,
  ].filter((x): x is string => x !== null);

  const source = sourceText(recipe.sourceType, t);
  const sourceUrl = recipe.sourceUrl;

  return (
    <Screen title={recipe.title} onBack={() => router.back()} testID="recipe-detail">
      <View style={{ gap: theme.space[3] }}>
        {times.length ? (
          <Text color="textSecondary" testID="recipe-detail-times">
            {times.join(t('recipes.detail.separator'))}
          </Text>
        ) : null}
        {recipe.tags.length ? (
          <View style={[styles.wrap, { gap: theme.space[1] }]}>
            {recipe.tags.map((tag) => (
              <Tag key={tag} label={t(`recipes.tags.${tag.slice(4)}`)} />
            ))}
          </View>
        ) : null}
        {actions?.map((action, i) => (
          <Button
            key={action.testID}
            variant={i === 0 ? 'primary' : 'secondary'}
            label={action.label}
            onPress={action.onPress}
            fullWidth
            testID={action.testID}
          />
        ))}
      </View>

      {matches.map((match) => (
        <AllergenNotice
          key={match.allergen}
          allergen={t(nameKey(match.allergen))}
          person={formatList(match.people, locale)}
          testID={`recipe-allergen-${match.allergen.slice(9)}`}
        />
      ))}
      {allergies.status === 'unavailable' ? (
        <Text variant="caption" color="textSecondary" testID="recipe-allergen-unavailable">
          {t('recipes.detail.allergiesUnavailable')}
        </Text>
      ) : null}

      <View style={{ gap: theme.space[2] }}>
        <View style={[styles.row, { gap: theme.space[3] }]}>
          <Text variant="sectionLabel" accessibilityRole="header" style={styles.grow}>
            {t('recipes.editor.ingredients')}
          </Text>
          <Stepper
            value={servings}
            onChange={setServings}
            min={RECIPE_LIMITS.minServings}
            max={RECIPE_LIMITS.maxServings}
            accessibilityLabel={t('recipes.editor.servings')}
            formatValue={(n) =>
              t('recipes.detail.servings', { count: n, value: formatNumber(n, locale) })
            }
            testID="recipe-detail-servings"
          />
        </View>
        {recipe.lines.map((line, i) => (
          <View key={line.id} style={{ gap: theme.space[1] }}>
            <Text testID={`recipe-detail-line-${i}`}>
              {scaledLineText(line, {
                ratio,
                dimension: ingredients.dimension(line.ingredientId),
                system: unitSystem,
                name: (count) =>
                  ingredients.nameFor(line.ingredientId, count) ?? t('recipes.line.unknown'),
                locale,
                t,
              })}
            </Text>
            {line.optional ? (
              <Text variant="caption" color="textSecondary">
                {t('recipes.line.optional')}
              </Text>
            ) : null}
          </View>
        ))}
      </View>

      {recipe.steps.length ? (
        <View style={{ gap: theme.space[3] }}>
          <Text variant="sectionLabel" accessibilityRole="header">
            {t('recipes.editor.steps')}
          </Text>
          {recipe.steps.map((step, i) => (
            <View key={step.id} style={[styles.row, styles.top, { gap: theme.space[3] }]}>
              <Text variant="bodyStrong">{formatNumber(i + 1, locale)}</Text>
              <Text style={styles.grow} testID={`recipe-detail-step-${i}`}>
                {step.text}
              </Text>
            </View>
          ))}
        </View>
      ) : null}

      {recipe.notes ? (
        <View style={{ gap: theme.space[2] }}>
          <Text variant="sectionLabel" accessibilityRole="header">
            {t('recipes.editor.notes')}
          </Text>
          <Text>{recipe.notes}</Text>
        </View>
      ) : null}

      {source || sourceUrl ? (
        <View style={{ gap: theme.space[1] }} testID="recipe-detail-source">
          {source ? <Text color="textSecondary">{source}</Text> : null}
          {sourceUrl ? (
            <ListRow
              title={sourceUrl}
              subtitle={t('recipes.detail.openSource')}
              variant="navigation"
              onPress={() => void Linking.openURL(sourceUrl)}
              testID="recipe-detail-source-link"
            />
          ) : null}
        </View>
      ) : null}
    </Screen>
  );
}

/** Where the recipe came from (FR-AI-15). Manual recipes say nothing unless they have a link. */
function sourceText(type: RecipeSourceType, t: (key: string) => string): string | null {
  return type === 'manual' ? null : t(`recipes.detail.source.${type}`);
}

const styles = StyleSheet.create({
  grow: {
    flex: 1,
  },
  row: {
    alignItems: 'center',
    flexDirection: 'row',
  },
  top: {
    alignItems: 'flex-start',
  },
  wrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
});
