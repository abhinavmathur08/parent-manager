import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';

import { BottomSheet } from '@/components/bottom-sheet';
import { Button } from '@/components/button';
import { Chip } from '@/components/chip';
import { Text } from '@/components/text';
import { TextField } from '@/components/text-field';
import { toDate } from '@/features/planner/week';
import { parseQuantityText, quantityToText } from '@/features/recipes/quantity-text';
import { useTheme } from '@/hooks/use-theme';
import { formatDate, formatQuantity, type Region, type UnitId, type UnitSystem } from '@/i18n';

import type { AddAmount } from './add-item';
import { canEditAmount, editAmount, editUnits, type ItemSourceView } from './detail';
import { itemDisplayParts } from './engine';
import type { GroceryItemRow } from './tables';

export type ItemEdit = { name?: string; amount: AddAmount | null; amountEdited: boolean };

/**
 * S-15, item detail (FR-LIST-7, FR-LIST-12, FR-PAN-4): edit the name, amount or unit, see the
 * planned meals and recipe lines the item comes from, mark "I already have this", or delete
 * it. Opened from a list row's details button. Mounted by the caller only while open, so it
 * starts from the item each time.
 */
export function ItemSheet({
  item,
  name,
  sources,
  locale,
  region,
  unitSystem,
  onSave,
  onHave,
  onDelete,
  onClose,
}: {
  item: GroceryItemRow;
  /** The name the list shows for the item. */
  name: string;
  sources: readonly ItemSourceView[];
  locale: string;
  region: Region;
  unitSystem: UnitSystem;
  onSave: (edit: ItemEdit) => void;
  onHave: () => void;
  onDelete: () => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const theme = useTheme();
  const initialAmount = editAmount(item, unitSystem);
  const [nameText, setNameText] = useState(name);
  const [quantityText, setQuantityText] = useState(
    quantityToText(initialAmount?.quantity ?? null, locale),
  );
  const [unitId, setUnitId] = useState<UnitId | null>(initialAmount?.unitId ?? null);
  const [amountEdited, setAmountEdited] = useState(false);
  const [errors, setErrors] = useState<{ name?: string; quantity?: string }>({});
  const units = editUnits(item, unitSystem, region);
  const amountEditable = canEditAmount(item);

  const save = () => {
    const quantity = parseQuantityText(quantityText, locale);
    const next = {
      name: !item.ingredient_id && !nameText.trim() ? t('list.item.nameRequired') : undefined,
      quantity:
        quantity === undefined || (quantity === null && item.origin === 'plan' && amountEdited)
          ? t('list.add.quantityInvalid')
          : undefined,
    };
    setErrors(next);
    if (next.name || next.quantity || quantity === undefined) return;
    onSave({
      name: nameText.trim() === name.trim() ? undefined : nameText,
      amount: quantity === null ? null : { quantity, unitId },
      amountEdited,
    });
  };

  const day = (date: string) =>
    formatDate(toDate(date), locale, { weekday: 'long', timeZone: 'UTC' });

  return (
    <BottomSheet
      visible
      onClose={onClose}
      title={name}
      variant="form"
      testID="item-sheet"
      footer={<Button label={t('list.item.save')} onPress={save} fullWidth testID="item-save" />}
    >
      <View style={{ gap: theme.space[4] }}>
        <TextField
          label={t('list.item.name')}
          error={errors.name}
          value={nameText}
          onChangeText={(value) => {
            setNameText(value);
            setErrors((e) => ({ ...e, name: undefined }));
          }}
          maxLength={120}
          testID="item-name"
        />
        {amountEditable ? (
          <>
            <TextField
              label={t('list.item.quantity')}
              hint={t('list.add.quantityHint')}
              error={errors.quantity}
              value={quantityText}
              onChangeText={(value) => {
                setQuantityText(value);
                setAmountEdited(true);
                setErrors((e) => ({ ...e, quantity: undefined }));
              }}
              keyboardType="numbers-and-punctuation"
              testID="item-quantity"
            />
            {units.length || item.origin === 'manual' ? (
              <View style={{ gap: theme.space[2] }}>
                <Text variant="label" color="textSecondary">
                  {t('list.add.unit')}
                </Text>
                <View style={[styles.wrap, { gap: theme.space[2] }]}>
                  {item.origin === 'manual' ? (
                    <Chip
                      label={t('list.add.noUnit')}
                      selected={unitId === null}
                      onPress={() => {
                        setUnitId(null);
                        setAmountEdited(true);
                      }}
                      testID="item-unit-none"
                    />
                  ) : null}
                  {units.map((id) => (
                    <Chip
                      key={id}
                      label={t(`recipes.unitNames.${id.slice('unit.'.length)}`)}
                      selected={unitId === id}
                      onPress={() => {
                        setUnitId(id);
                        setAmountEdited(true);
                      }}
                      testID={`item-unit-${id.slice('unit.'.length)}`}
                    />
                  ))}
                </View>
              </View>
            ) : null}
          </>
        ) : null}

        <View style={{ gap: theme.space[2] }} testID="item-sources">
          <Text variant="label" color="textSecondary" accessibilityRole="header">
            {t('list.item.sources')}
          </Text>
          {sources.length ? (
            sources.map((source, i) => {
              const parts = itemDisplayParts(item.dimension, source.quantityBase, unitSystem);
              return (
                <View key={source.id} testID={`item-source-${i}`}>
                  <Text>
                    {t('list.item.source', {
                      day: day(source.date),
                      slot: t(`plan.slots.${source.slot}`),
                      recipe: source.recipeTitle ?? t('list.item.unknownRecipe'),
                    })}
                  </Text>
                  {parts ? (
                    <Text variant="label" color="textSecondary" tabular>
                      {formatQuantity(parts, locale)}
                    </Text>
                  ) : null}
                </View>
              );
            })
          ) : (
            <Text color="textSecondary" testID="item-no-sources">
              {item.origin === 'manual' ? t('list.item.manual') : t('list.item.noSources')}
            </Text>
          )}
        </View>

        {item.ingredient_id ? (
          <Button
            variant="secondary"
            label={t('list.item.have')}
            onPress={onHave}
            fullWidth
            testID="item-have"
          />
        ) : null}
        <Button
          variant="destructive"
          label={t('list.item.delete')}
          onPress={onDelete}
          fullWidth
          testID="item-delete"
        />
      </View>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  wrap: { flexDirection: 'row', flexWrap: 'wrap' },
});
