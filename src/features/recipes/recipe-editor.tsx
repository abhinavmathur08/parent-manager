import { randomUUID } from 'expo-crypto';
import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';

import { Button } from '@/components/button';
import { Chip } from '@/components/chip';
import { IconButton } from '@/components/icon-button';
import { ListRow } from '@/components/list-row';
import { Screen } from '@/components/screen';
import { Stepper } from '@/components/stepper';
import { Text } from '@/components/text';
import { TextField } from '@/components/text-field';
import { loadParserVocabulary } from '@/features/ingredients/matching';
import { useIngredients } from '@/features/ingredients/use-ingredients';
import { useDraftState } from '@/hooks/use-draft-state';
import { useTheme } from '@/hooks/use-theme';
import { formatNumber, type AppLocale, type Region, type UnitSystem } from '@/i18n';

import { useApplyOps } from './data';
import {
  draftFromRecipe,
  emptyDraft,
  planSave,
  validateDraft,
  type DraftErrors,
  type DraftLine,
  type RecipeDraft,
  type SavedRecipe,
} from './draft';
import { formatLine } from './format-line';
import { LineSheet, type LineSheetResult } from './line-sheet';
import { quickAddLine } from './quick-add';
import { RECIPE_LIMITS, RECIPE_TAGS } from './tables';

type Household = { locale: AppLocale; region: Region; unitSystem: UnitSystem };

type Editing = (DraftLine & { isNew: boolean; searchText?: string }) | null;

/**
 * S-18, the recipe editor (FR-REC-4 to FR-REC-6): title, servings, times, tags, ingredient
 * lines, steps, notes and a source link. Built for one hand: typing "1 1/2 cups milk" and
 * pressing return adds a line and keeps the keyboard up for the next. The form survives the
 * app being killed (NFR-A11Y-8), and saving writes through the sync layer, so it works offline.
 */
export function RecipeEditor({
  saved,
  recipeId,
  draftKey,
  household,
  onSaved,
}: {
  /** The recipe being edited, or null for a new one. */
  saved: SavedRecipe | null;
  recipeId: string;
  /** Where the unsaved form is kept on the device. */
  draftKey: string;
  household: Household;
  onSaved: (recipeId: string) => void;
}) {
  const { t } = useTranslation();
  const theme = useTheme();
  const { locale, region, unitSystem } = household;
  const ingredients = useIngredients(locale);
  const vocabulary = useMemo(() => loadParserVocabulary(locale), [locale]);
  const apply = useApplyOps();

  const [draft, setDraft, clearDraft] = useDraftState<RecipeDraft>(
    draftKey,
    saved ? draftFromRecipe(saved) : emptyDraft(),
  );
  const [quickText, setQuickText] = useState('');
  const [editing, setEditing] = useState<Editing>(null);
  const [errors, setErrors] = useState<DraftErrors>({});
  const [formError, setFormError] = useState<string>();
  const [busy, setBusy] = useState(false);

  const update = (patch: Partial<RecipeDraft>) => setDraft((d) => ({ ...d, ...patch }));

  const lineName = (line: DraftLine) =>
    draft.newIngredients.find((n) => n.ingredientId === line.ingredientId)?.name ??
    ingredients.nameFor(line.ingredientId, line.quantity) ??
    t('recipes.line.unknown');

  function quickAdd() {
    const text = quickText.trim();
    if (!text) return;
    const { line, confident, searchText } = quickAddLine(
      text,
      { index: ingredients.index, vocabulary, region },
      randomUUID(),
    );
    if (confident) {
      update({ lines: [...draft.lines, line] });
    } else {
      setEditing({ ...line, isNew: true, searchText });
    }
    setQuickText('');
  }

  function finishLine({ line, newIngredient }: LineSheetResult) {
    setDraft((d) => {
      const exists = d.lines.some((l) => l.id === line.id);
      return {
        ...d,
        lines: exists ? d.lines.map((l) => (l.id === line.id ? line : l)) : [...d.lines, line],
        newIngredients: newIngredient ? [...d.newIngredients, newIngredient] : d.newIngredients,
      };
    });
    setEditing(null);
  }

  async function save() {
    const found = validateDraft(draft);
    setErrors(found);
    if (Object.keys(found).length) {
      setFormError(t('recipes.editor.errors.check'));
      return;
    }
    setBusy(true);
    setFormError(undefined);
    try {
      await apply(
        planSave(saved, draft, { recipeId, locale, dimension: (id) => ingredients.dimension(id) }),
      );
      clearDraft();
      onSaved(recipeId);
    } catch (error) {
      setFormError(
        error instanceof Error && error.message.includes('not open')
          ? t('recipes.editor.errors.notReady')
          : t('recipes.editor.errors.saveFailed'),
      );
      setBusy(false);
    }
  }

  return (
    <Screen
      title={saved ? t('recipes.editor.editTitle') : t('recipes.editor.newTitle')}
      onBack={() => router.back()}
      actions={[
        { label: t('recipes.editor.save'), onPress: () => void save(), testID: 'recipe-save-top' },
      ]}
      hasTabBar={false}
      testID="recipe-editor"
    >
      <View style={{ gap: theme.space[4] }}>
        <TextField
          label={t('recipes.editor.name')}
          value={draft.title}
          onChangeText={(title) => update({ title })}
          error={errors.title ? t(errors.title) : undefined}
          maxLength={RECIPE_LIMITS.titleLength}
          autoCapitalize="sentences"
          testID="recipe-title"
        />
        <View style={[styles.row, { gap: theme.space[3] }]}>
          <Text variant="label" color="textSecondary" style={styles.grow}>
            {t('recipes.editor.servings')}
          </Text>
          <Stepper
            value={draft.servings}
            onChange={(servings) => update({ servings })}
            min={RECIPE_LIMITS.minServings}
            max={RECIPE_LIMITS.maxServings}
            accessibilityLabel={t('recipes.editor.servings')}
            formatValue={(n) => formatNumber(n, locale)}
            testID="recipe-servings"
          />
        </View>
        <TextField
          label={t('recipes.editor.prep')}
          value={draft.prepMinutes}
          onChangeText={(prepMinutes) => update({ prepMinutes })}
          error={errors.prepMinutes ? t(errors.prepMinutes) : undefined}
          keyboardType="number-pad"
          maxLength={4}
          testID="recipe-prep"
        />
        <TextField
          label={t('recipes.editor.cook')}
          value={draft.cookMinutes}
          onChangeText={(cookMinutes) => update({ cookMinutes })}
          error={errors.cookMinutes ? t(errors.cookMinutes) : undefined}
          keyboardType="number-pad"
          maxLength={4}
          testID="recipe-cook"
        />
        <View style={{ gap: theme.space[2] }}>
          <Text variant="label" color="textSecondary">
            {t('recipes.editor.tags')}
          </Text>
          <View style={[styles.wrap, { gap: theme.space[2] }]}>
            {RECIPE_TAGS.map((tag) => (
              <Chip
                key={tag}
                label={t(`recipes.tags.${tag.slice(4)}`)}
                selected={draft.tags.includes(tag)}
                onPress={() =>
                  update({
                    tags: draft.tags.includes(tag)
                      ? draft.tags.filter((x) => x !== tag)
                      : RECIPE_TAGS.filter((x) => x === tag || draft.tags.includes(x)),
                  })
                }
                testID={`recipe-tag-${tag.slice(4)}`}
              />
            ))}
          </View>
        </View>
      </View>

      <View style={{ gap: theme.space[2] }}>
        <Text variant="sectionLabel" accessibilityRole="header">
          {t('recipes.editor.ingredients')}
        </Text>
        {draft.lines.map((line, i) => {
          const text = formatLine(line, { name: lineName(line), locale, t });
          return (
            <ListRow
              key={line.id}
              title={text}
              subtitle={line.optional ? t('recipes.line.optional') : undefined}
              variant="navigation"
              onPress={() => setEditing({ ...line, isNew: false })}
              accessibilityHint={t('recipes.editor.editLine', { line: text })}
              divider={i < draft.lines.length - 1}
              testID={`recipe-line-${i}`}
            />
          );
        })}
        {errors.lines ? <Text color="error">{t(errors.lines)}</Text> : null}
        <TextField
          label={t('recipes.editor.quickAdd')}
          hint={t('recipes.editor.quickAddHint')}
          value={quickText}
          onChangeText={setQuickText}
          onSubmitEditing={quickAdd}
          submitBehavior="submit"
          returnKeyType="next"
          autoCorrect={false}
          testID="recipe-quick-add"
        />
        <Button
          variant="secondary"
          icon="search"
          label={t('recipes.editor.chooseIngredient')}
          onPress={() =>
            setEditing({
              id: randomUUID(),
              ingredientId: '',
              quantity: null,
              unitId: null,
              rawText: null,
              note: null,
              optional: false,
              isNew: true,
            })
          }
          testID="recipe-choose-ingredient"
        />
      </View>

      <View style={{ gap: theme.space[2] }}>
        <Text variant="sectionLabel" accessibilityRole="header">
          {t('recipes.editor.steps')}
        </Text>
        {draft.steps.map((step, i) => (
          <View key={step.id} style={[styles.row, { gap: theme.space[2] }]}>
            <TextField
              label={t('recipes.editor.stepLabel', { n: formatNumber(i + 1, locale) })}
              value={step.text}
              onChangeText={(text) =>
                update({ steps: draft.steps.map((s) => (s.id === step.id ? { ...s, text } : s)) })
              }
              multiline
              maxLength={2000}
              style={styles.grow}
              testID={`recipe-step-${i}`}
            />
            <IconButton
              icon="remove"
              accessibilityLabel={t('recipes.editor.removeStep', {
                n: formatNumber(i + 1, locale),
              })}
              onPress={() => update({ steps: draft.steps.filter((s) => s.id !== step.id) })}
              testID={`recipe-step-remove-${i}`}
            />
          </View>
        ))}
        {errors.steps ? <Text color="error">{t(errors.steps)}</Text> : null}
        <Button
          variant="secondary"
          icon="add"
          label={t('recipes.editor.addStep')}
          onPress={() => update({ steps: [...draft.steps, { id: randomUUID(), text: '' }] })}
          testID="recipe-add-step"
        />
      </View>

      <View style={{ gap: theme.space[4] }}>
        <TextField
          label={t('recipes.editor.notes')}
          value={draft.notes}
          onChangeText={(notes) => update({ notes })}
          multiline
          maxLength={5000}
          testID="recipe-notes"
        />
        <TextField
          label={t('recipes.editor.source')}
          hint={t('recipes.editor.sourceHint')}
          value={draft.sourceUrl}
          onChangeText={(sourceUrl) => update({ sourceUrl })}
          error={errors.sourceUrl ? t(errors.sourceUrl) : undefined}
          keyboardType="url"
          autoCapitalize="none"
          autoCorrect={false}
          testID="recipe-source"
        />
        {formError ? (
          <Text color="error" accessibilityRole="alert" testID="recipe-error">
            {formError}
          </Text>
        ) : null}
        <Button
          label={t('recipes.editor.save')}
          onPress={() => void save()}
          loading={busy}
          disabled={busy}
          fullWidth
          testID="recipe-save"
        />
      </View>

      {editing ? (
        <LineSheet
          initial={editing}
          ingredients={ingredients}
          newIngredients={draft.newIngredients}
          locale={locale}
          region={region}
          unitSystem={unitSystem}
          onDone={finishLine}
          onRemove={() => {
            update({ lines: draft.lines.filter((l) => l.id !== editing.id) });
            setEditing(null);
          }}
          onClose={() => setEditing(null)}
        />
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  grow: {
    flex: 1,
  },
  row: {
    alignItems: 'center',
    flexDirection: 'row',
  },
  wrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
});
