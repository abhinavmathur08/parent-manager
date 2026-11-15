import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';

import { BottomSheet } from '@/components/bottom-sheet';
import { Button } from '@/components/button';
import { Chip } from '@/components/chip';
import { ListRow } from '@/components/list-row';
import { SectionHeader } from '@/components/section-header';
import { Text } from '@/components/text';
import { TextField } from '@/components/text-field';
import { nameKey, SECTION_IDS, type SectionId } from '@/features/ingredients/catalog-ids';
import { searchIngredients } from '@/features/ingredients/matching';
import type { Ingredients } from '@/features/ingredients/use-ingredients';
import { parseQuantityText } from '@/features/recipes/quantity-text';
import { isMeasured, unitChoices } from '@/features/recipes/units';
import { useTheme } from '@/hooks/use-theme';
import type { Region, UnitId, UnitSystem } from '@/i18n';

import type { AddAmount, AddChoice } from './add-item';

const MAX_SUGGESTIONS = 6;

/**
 * S-14, the add item sheet (FR-LIST-6): type an item and pick a catalog suggestion, or add
 * the text as typed in a chosen section (R-LIST-6), with an optional amount and unit, then
 * "Add to list". Suggestions come from the locale's ingredient names and synonyms, matched
 * to IDs, never compared as display text (R-ING-6). Before anything is typed, it shows the
 * household's frequently bought items (FR-MEM-3): one tap adds one, and "don't suggest" hides
 * it for 90 days (FR-MEM-5).
 */
export function AddItemSheet({
  visible,
  ingredients,
  sectionOf,
  locale,
  region,
  unitSystem,
  onAdd,
  onClose,
  frequent = [],
  onAddFrequent,
  onHideFrequent,
}: {
  visible: boolean;
  ingredients: Ingredients;
  /** The store section of an ingredient (R-LIST-6). */
  sectionOf: (ingredientId: string) => SectionId;
  locale: string;
  region: Region;
  unitSystem: UnitSystem;
  onAdd: (
    choice: AddChoice,
    amount: AddAmount | null,
    source: 'typed' | 'suggestion_catalog',
  ) => void;
  onClose: () => void;
  /** Frequently bought ingredients, most bought first; hidden when empty. */
  frequent?: readonly { ingredientId: string; name: string }[];
  /** Adds a frequently bought ingredient; `rank` counts from 1. */
  onAddFrequent?: (ingredientId: string, rank: number) => void;
  onHideFrequent?: (ingredientId: string) => void;
}) {
  const { t } = useTranslation();
  const theme = useTheme();
  const [text, setText] = useState('');
  const [quantityText, setQuantityText] = useState('');
  const [unitId, setUnitId] = useState<UnitId | null>(null);
  const [typing, setTyping] = useState<{ sectionId: SectionId } | null>(null);
  const [chosen, setChosen] = useState<{ ingredientId: string; name: string } | null>(null);
  const [error, setError] = useState<string | undefined>();

  const units = useMemo(
    () => unitChoices(unitSystem, region).primary.filter((id): id is UnitId => isMeasured(id)),
    [unitSystem, region],
  );
  const suggestions = useMemo(
    () =>
      text.trim() && !typing && !chosen
        ? searchIngredients(ingredients.index, text, { limit: MAX_SUGGESTIONS })
        : [],
    [ingredients.index, text, typing, chosen],
  );

  const reset = () => {
    setText('');
    setQuantityText('');
    setUnitId(null);
    setTyping(null);
    setChosen(null);
    setError(undefined);
  };

  /** The amount typed, null for none, or undefined when it isn't a number. */
  const readAmount = (): AddAmount | null | undefined => {
    const quantity = parseQuantityText(quantityText, locale);
    if (quantity === undefined) {
      setError(t('list.add.quantityInvalid'));
      return undefined;
    }
    return quantity === null ? null : { quantity, unitId };
  };

  const add = () => {
    const amount = readAmount();
    if (amount === undefined) return;
    if (chosen) {
      onAdd(
        {
          kind: 'ingredient',
          ingredientId: chosen.ingredientId,
          sectionId: sectionOf(chosen.ingredientId),
        },
        amount,
        'suggestion_catalog',
      );
    } else if (typing && text.trim()) {
      onAdd({ kind: 'text', name: text.trim(), sectionId: typing.sectionId }, amount, 'typed');
    } else {
      return;
    }
    reset();
  };

  return (
    <BottomSheet
      visible={visible}
      onClose={() => {
        reset();
        onClose();
      }}
      title={t('list.add.title')}
      variant="form"
      testID="add-item-sheet"
      footer={
        chosen || typing ? (
          <Button label={t('list.add.done')} onPress={add} fullWidth testID="add-item-done" />
        ) : undefined
      }
    >
      <View style={{ gap: theme.space[4] }}>
        <View style={{ gap: theme.space[2] }}>
          <TextField
            variant="search"
            accessibilityLabel={t('list.add.search')}
            placeholder={t('list.add.search')}
            value={text}
            onChangeText={(value) => {
              setText(value);
              setTyping(null);
              setChosen(null);
            }}
            autoCorrect={false}
            autoFocus
            testID="add-item-search"
          />
          {!text.trim() && !typing && !chosen && frequent.length ? (
            <View testID="add-item-frequent">
              <SectionHeader title={t('list.add.frequent')} variant="group" />
              {frequent.map((item, i) => (
                <View key={item.ingredientId} style={[styles.row, { gap: theme.space[2] }]}>
                  <ListRow
                    title={item.name}
                    accessibilityHint={t('list.add.frequentHint', { name: item.name })}
                    onPress={() => {
                      reset();
                      onAddFrequent?.(item.ingredientId, i + 1);
                    }}
                    testID={`add-item-frequent-${i}`}
                    style={styles.grow}
                  />
                  <Button
                    variant="ghost"
                    label={t('list.add.dontSuggest')}
                    accessibilityHint={t('list.add.dontSuggestHint', { name: item.name })}
                    onPress={() => onHideFrequent?.(item.ingredientId)}
                    testID={`add-item-frequent-${i}-hide`}
                  />
                </View>
              ))}
            </View>
          ) : null}
          {suggestions.map((result, i) => (
            <ListRow
              key={result.ingredientId}
              title={result.displayName}
              onPress={() =>
                setChosen({ ingredientId: result.ingredientId, name: result.displayName })
              }
              divider={i < suggestions.length - 1}
              testID={`add-item-suggestion-${i}`}
            />
          ))}
          {chosen ? (
            <Text variant="bodyStrong" testID="add-item-chosen">
              {chosen.name}
            </Text>
          ) : null}
          {text.trim() && !typing && !chosen ? (
            <Button
              variant="secondary"
              icon="add"
              label={t('list.add.asTyped', { name: text.trim() })}
              onPress={() => setTyping({ sectionId: 'section.other' })}
              testID="add-item-as-typed"
            />
          ) : null}
          {typing ? (
            <View style={{ gap: theme.space[2] }}>
              <Text variant="label" color="textSecondary">
                {t('list.add.section')}
              </Text>
              <View style={[styles.wrap, { gap: theme.space[2] }]}>
                {SECTION_IDS.map((section) => (
                  <Chip
                    key={section}
                    label={t(nameKey(section))}
                    selected={typing.sectionId === section}
                    onPress={() => setTyping({ sectionId: section })}
                    testID={`add-item-section-${section.slice('section.'.length)}`}
                  />
                ))}
              </View>
            </View>
          ) : null}
        </View>

        <TextField
          label={t('list.add.quantity')}
          hint={t('list.add.quantityHint')}
          error={error}
          value={quantityText}
          onChangeText={(value) => {
            setQuantityText(value);
            setError(undefined);
          }}
          keyboardType="numbers-and-punctuation"
          testID="add-item-quantity"
        />
        <View style={{ gap: theme.space[2] }}>
          <Text variant="label" color="textSecondary">
            {t('list.add.unit')}
          </Text>
          <View style={[styles.wrap, { gap: theme.space[2] }]}>
            <Chip
              label={t('list.add.noUnit')}
              selected={unitId === null}
              onPress={() => setUnitId(null)}
              testID="add-item-unit-none"
            />
            {units.map((id) => (
              <Chip
                key={id}
                label={t(`recipes.unitNames.${id.slice('unit.'.length)}`)}
                selected={unitId === id}
                onPress={() => setUnitId(id)}
                testID={`add-item-unit-${id.slice('unit.'.length)}`}
              />
            ))}
          </View>
        </View>
      </View>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  wrap: { flexDirection: 'row', flexWrap: 'wrap' },
  row: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap' },
  grow: { flex: 1, minWidth: 160 },
});
