import { UNITS, type Dimension, type UnitId } from '@/i18n';

/**
 * A line's quantity in base units (g, ml or each), as the server works it out (R-ING-3,
 * R-ING-4, R-ING-5), so a line written offline shows the same as it will after syncing:
 * - a quantity and a measured unit: quantity x the unit's factor
 * - a quantity, no unit, and an ingredient counted by default ("2 onions"): quantity each
 * - anything else ("a pinch", "salt to taste", no quantity): null
 */
export function quantityBase(
  quantity: number | null,
  unitId: string | null,
  ingredientDimension: Dimension,
): number | null {
  if (quantity === null) return null;
  if (unitId === null) return ingredientDimension === 'count' ? quantity : null;
  const unit = UNITS[unitId as UnitId] as (typeof UNITS)[UnitId] | undefined;
  return unit ? quantity * unit.toBase : null;
}
