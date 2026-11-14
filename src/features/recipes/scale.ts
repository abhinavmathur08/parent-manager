import type { TFunction } from 'i18next';

import type { AllergenCode } from '@/features/ingredients/catalog-ids';
import {
  displayQuantity,
  formatQuantity,
  UNITS,
  type Dimension,
  type QuantityPart,
  type UnitSystem,
} from '@/i18n';

import { formatLine, type LineLike } from './format-line';
import { quantityBase } from './quantity';
import { inSystem, isMeasured } from './units';

const roundQuarter = (value: number) => Math.max(0.25, Math.round(value * 4) / 4);

/**
 * The amount to show for a line at `ratio` times the recipe's servings (FR-REC-8, R-ING-3,
 * R-UNIT-3). Scaling multiplies the base quantity; the saved recipe never changes.
 * - A unit of the household's own system stays as written, scaled (1 cup becomes 1½ cups).
 * - A unit of the other system is converted from the base quantity (1 US cup in a metric
 *   household shows in millilitres).
 * - Counts are rounded up to whole items. A pinch or a dash is shown as written (R-ING-5).
 * Returns null when the line has no amount to show.
 */
export function scaledParts(
  line: LineLike,
  ratio: number,
  dimension: Dimension,
  system: UnitSystem,
): QuantityPart[] | null {
  if (line.quantity === null || !(line.unitId === null || isMeasured(line.unitId))) return null;
  const base = quantityBase(line.quantity, line.unitId, dimension);
  if (base === null) return null;
  if (line.unitId === null || UNITS[line.unitId].dimension === 'count') {
    return displayQuantity(base * ratio, 'count', system);
  }
  if (inSystem(line.unitId, system)) {
    const value = line.quantity * ratio;
    return [
      {
        value: ratio === 1 || !UNITS[line.unitId].fractions ? value : roundQuarter(value),
        unitId: line.unitId,
      },
    ];
  }
  return displayQuantity(base * ratio, UNITS[line.unitId].dimension, system);
}

/** A line at the chosen servings, as text: "1½ cups milk", "350 ml milk", "3 onions". */
export function scaledLineText(
  line: LineLike,
  options: {
    ratio: number;
    dimension: Dimension;
    system: UnitSystem;
    name: (count: number | null) => string;
    locale: string;
    t: TFunction;
  },
): string {
  const parts = scaledParts(line, options.ratio, options.dimension, options.system);
  if (!parts) {
    return formatLine(line, {
      name: options.name(line.quantity),
      locale: options.locale,
      t: options.t,
    });
  }
  const amount = formatQuantity(parts, options.locale);
  const count = parts.length === 1 ? parts[0].value : 2;
  const text = options.t('recipes.line.amountAndName', { amount, name: options.name(count) });
  return line.note ? options.t('recipes.line.withNote', { line: text, note: line.note }) : text;
}

export type AllergenMatch = { allergen: AllergenCode; people: string[] };

/**
 * Allergens in the recipe that someone in the household is allergic to (FR-REC-9, AI-12),
 * matched by code only: the ingredient's allergen codes against each person's allergy codes.
 */
export function allergenMatches(
  ingredientIds: readonly string[],
  allergensOf: (ingredientId: string) => readonly AllergenCode[],
  people: readonly { displayName: string; allergies: readonly AllergenCode[] }[],
): AllergenMatch[] {
  const present = new Set(ingredientIds.flatMap((id) => allergensOf(id)));
  const matches = new Map<AllergenCode, string[]>();
  for (const person of people) {
    for (const code of person.allergies) {
      if (!present.has(code)) continue;
      matches.set(code, [...(matches.get(code) ?? []), person.displayName]);
    }
  }
  return [...matches.entries()].map(([allergen, names]) => ({ allergen, people: names }));
}
