import type { TFunction } from 'i18next';

import { formatQuantity, UNITS, type UnitId } from '@/i18n';

import { quantityToText } from './quantity-text';

export type LineLike = {
  ingredientId: string;
  quantity: number | null;
  unitId: string | null;
  note: string | null;
};

/**
 * A line as the household reads it, such as "1½ cups milk, warm", "2 onions" or "salt".
 * Amounts and unit names go through the locale helpers; the ingredient name comes from the
 * name index. `quantity` may already be scaled (FR-REC-8).
 */
export function formatLine(
  line: LineLike,
  options: { name: string; locale: string; t: TFunction },
): string {
  const { name, locale, t } = options;
  let amount = '';
  if (line.quantity !== null) {
    if (line.unitId === 'unit.pinch' || line.unitId === 'unit.dash') {
      const count = line.quantity;
      amount = `${quantityToText(count, locale)} ${t(`units.${line.unitId.slice(5)}`, { count: count > 1 ? 2 : 1 })}`;
    } else {
      const unitId = (line.unitId && line.unitId in UNITS ? line.unitId : 'unit.each') as UnitId;
      amount = formatQuantity({ value: line.quantity, unitId }, locale);
    }
  } else if (line.unitId === 'unit.pinch' || line.unitId === 'unit.dash') {
    amount = t(`recipes.line.${line.unitId.slice(5)}`);
  }
  const text = amount ? t('recipes.line.amountAndName', { amount, name }) : name;
  return line.note ? t('recipes.line.withNote', { line: text, note: line.note }) : text;
}
