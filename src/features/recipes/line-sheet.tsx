import { randomUUID } from 'expo-crypto';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';

import { BottomSheet } from '@/components/bottom-sheet';
import { Button } from '@/components/button';
import { Chip } from '@/components/chip';
import { ListRow } from '@/components/list-row';
import { Switch } from '@/components/switch';
import { Text } from '@/components/text';
import { TextField } from '@/components/text-field';
import { nameKey, SECTION_IDS, type SectionId } from '@/features/ingredients/catalog-ids';
import { householdIngredientId } from '@/features/ingredients/household';
import { searchIngredients } from '@/features/ingredients/matching';
import type { Ingredients } from '@/features/ingredients/use-ingredients';
import { useTheme } from '@/hooks/use-theme';
import { UNITS, type Region, type UnitId, type UnitSystem } from '@/i18n';

import type { DraftLine, NewIngredient } from './draft';
import { parseQuantityText, quantityToText } from './quantity-text';
import { unitChoices, type LineUnitId } from './units';

const MAX_RESULTS = 6;

export type LineSheetResult = { line: DraftLine; newIngredient: NewIngredient | null };

/**
 * Adds or edits one ingredient line (FR-REC-5, FR-REC-6): an amount (fractions and mixed
 * numbers welcome), a unit with the household's system first, and an ingredient found by
 * name or synonym, or added as a new household ingredient with a store section.
 */
export function LineSheet({
  initial,
  ingredients,
  newIngredients,
  locale,
  region,
  unitSystem,
  onDone,
  onRemove,
  onClose,
}: {
  /** The line to edit, or a partly filled new line (from typed text). */
  initial: DraftLine & { isNew: boolean; searchText?: string };
  ingredients: Ingredients;
  /** Ingredients added in this draft but not saved yet. */
  newIngredients: readonly NewIngredient[];
  locale: string;
  region: Region;
  unitSystem: UnitSystem;
  onDone: (result: LineSheetResult) => void;
  onRemove: () => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const theme = useTheme();
  const [quantityText, setQuantityText] = useState(quantityToText(initial.quantity, locale));
  const [unitId, setUnitId] = useState<LineUnitId | null>(initial.unitId);
  const [ingredientId, setIngredientId] = useState<string | null>(initial.ingredientId || null);
  const [search, setSearch] = useState(initial.searchText ?? '');
  const [note, setNote] = useState(initial.note ?? '');
  const [optional, setOptional] = useState(initial.optional);
  const [showMore, setShowMore] = useState(false);
  const [creating, setCreating] = useState<NewIngredient | null>(null);
  const [errors, setErrors] = useState<{ quantity?: string; ingredient?: string }>({});

  const choices = useMemo(() => unitChoices(unitSystem, region), [unitSystem, region]);
  const units = showMore ? [...choices.primary, ...choices.more] : choices.primary;
  const results = useMemo(
    () =>
      search.trim() ? searchIngredients(ingredients.index, search, { limit: MAX_RESULTS }) : [],
    [ingredients.index, search],
  );

  const pendingName = (id: string) => newIngredients.find((n) => n.ingredientId === id)?.name;
  const chosenName = creating
    ? creating.name
    : ingredientId
      ? (pendingName(ingredientId) ?? ingredients.name(ingredientId) ?? t('recipes.line.unknown'))
      : null;

  function startNew() {
    const rowId = randomUUID();
    const measured = unitId && unitId in UNITS ? UNITS[unitId as UnitId].dimension : 'count';
    setCreating({
      rowId,
      ingredientId: householdIngredientId(rowId),
      name: search.trim(),
      sectionId: 'section.other',
      dimension: measured,
    });
    setIngredientId(null);
    setErrors((e) => ({ ...e, ingredient: undefined }));
  }

  function done() {
    const quantity = parseQuantityText(quantityText, locale);
    const id = creating?.ingredientId ?? ingredientId;
    const next = {
      quantity: quantity === undefined ? t('recipes.lineSheet.quantityInvalid') : undefined,
      ingredient: id ? undefined : t('recipes.lineSheet.ingredientRequired'),
    };
    setErrors(next);
    if (next.quantity || next.ingredient || !id || quantity === undefined) return;
    onDone({
      line: {
        id: initial.id,
        ingredientId: id,
        quantity,
        unitId,
        rawText: initial.rawText,
        note: note.trim() || null,
        optional,
      },
      newIngredient: creating,
    });
  }

  return (
    <BottomSheet
      visible
      onClose={onClose}
      title={initial.isNew ? t('recipes.lineSheet.addTitle') : t('recipes.lineSheet.editTitle')}
      variant="form"
      testID="line-sheet"
      footer={
        <Button label={t('recipes.lineSheet.done')} onPress={done} fullWidth testID="line-done" />
      }
    >
      <View style={{ gap: theme.space[4] }}>
        <TextField
          label={t('recipes.lineSheet.quantity')}
          hint={t('recipes.lineSheet.quantityHint')}
          error={errors.quantity}
          value={quantityText}
          onChangeText={setQuantityText}
          keyboardType="numbers-and-punctuation"
          testID="line-quantity"
        />

        <View style={{ gap: theme.space[2] }}>
          <Text variant="label" color="textSecondary">
            {t('recipes.lineSheet.unit')}
          </Text>
          <View style={[styles.wrap, { gap: theme.space[2] }]}>
            <Chip
              label={t('recipes.lineSheet.noUnit')}
              selected={unitId === null}
              onPress={() => setUnitId(null)}
              testID="line-unit-none"
            />
            {units.map((id) => (
              <Chip
                key={id}
                label={t(`recipes.unitNames.${id.slice(5)}`)}
                selected={unitId === id}
                onPress={() => setUnitId(id)}
                testID={`line-unit-${id.slice(5)}`}
              />
            ))}
            <Chip
              variant="action"
              label={
                showMore ? t('recipes.lineSheet.fewerUnits') : t('recipes.lineSheet.moreUnits')
              }
              onPress={() => setShowMore((v) => !v)}
              testID="line-units-more"
            />
          </View>
        </View>

        <View style={{ gap: theme.space[2] }}>
          <Text variant="label" color="textSecondary">
            {t('recipes.lineSheet.ingredient')}
          </Text>
          {chosenName ? (
            <Text variant="bodyStrong" testID="line-ingredient-chosen">
              {creating ? t('recipes.lineSheet.newIngredient', { name: chosenName }) : chosenName}
            </Text>
          ) : null}
          <TextField
            variant="search"
            accessibilityLabel={t('recipes.lineSheet.search')}
            placeholder={t('recipes.lineSheet.search')}
            error={errors.ingredient}
            value={search}
            onChangeText={(text) => {
              setSearch(text);
              setCreating(null);
            }}
            autoCorrect={false}
            testID="line-search"
          />
          {results.map((result, i) => (
            <ListRow
              key={result.ingredientId}
              title={result.displayName}
              onPress={() => {
                setIngredientId(result.ingredientId);
                setCreating(null);
                setSearch('');
                setErrors((e) => ({ ...e, ingredient: undefined }));
              }}
              divider={i < results.length - 1}
              testID={`line-result-${i}`}
            />
          ))}
          {search.trim() && !creating ? (
            <Button
              variant="secondary"
              icon="add"
              label={t('recipes.lineSheet.addNew', { name: search.trim() })}
              onPress={startNew}
              testID="line-add-new"
            />
          ) : null}
          {creating ? (
            <View style={{ gap: theme.space[2] }}>
              <Text variant="label" color="textSecondary">
                {t('recipes.lineSheet.section')}
              </Text>
              <View style={[styles.wrap, { gap: theme.space[2] }]}>
                {SECTION_IDS.map((section: SectionId) => (
                  <Chip
                    key={section}
                    label={t(nameKey(section))}
                    selected={creating.sectionId === section}
                    onPress={() => setCreating({ ...creating, sectionId: section })}
                    testID={`line-section-${section.slice(8)}`}
                  />
                ))}
              </View>
            </View>
          ) : null}
        </View>

        <TextField
          label={t('recipes.lineSheet.note')}
          hint={t('recipes.lineSheet.noteHint')}
          value={note}
          onChangeText={setNote}
          maxLength={200}
          testID="line-note"
        />
        <Switch
          label={t('recipes.lineSheet.optional')}
          value={optional}
          onValueChange={setOptional}
          testID="line-optional"
        />
        {initial.isNew ? null : (
          <Button
            variant="destructive"
            label={t('recipes.lineSheet.remove')}
            onPress={onRemove}
            fullWidth
            testID="line-remove"
          />
        )}
      </View>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
});
