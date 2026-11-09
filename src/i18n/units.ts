/**
 * Units and display rules from docs/spec.md: R-ING-2 (factors), R-UNIT-3 (display unit)
 * and R-UNIT-4 (display rounding). Quantities are stored in base units: grams,
 * millilitres or "each". Display rounding never changes stored values.
 */
export type Dimension = 'mass' | 'volume' | 'count';
export type UnitSystem = 'us_customary' | 'metric';

type UnitDef = { dimension: Dimension; toBase: number; label: string; fractions: boolean };

export const UNITS = {
  'unit.tsp_us': { dimension: 'volume', toBase: 4.92892, label: 'tsp', fractions: true },
  'unit.tbsp_us': { dimension: 'volume', toBase: 14.7868, label: 'tbsp', fractions: true },
  'unit.cup_us': { dimension: 'volume', toBase: 236.588, label: 'cup', fractions: true },
  'unit.floz_us': { dimension: 'volume', toBase: 29.5735, label: 'floz', fractions: true },
  'unit.pint_us': { dimension: 'volume', toBase: 473.176, label: 'pint', fractions: true },
  'unit.qt_us': { dimension: 'volume', toBase: 946.353, label: 'qt', fractions: true },
  'unit.tsp_metric': { dimension: 'volume', toBase: 5, label: 'tsp', fractions: true },
  'unit.tbsp_metric': { dimension: 'volume', toBase: 15, label: 'tbsp', fractions: true },
  'unit.tbsp_au': { dimension: 'volume', toBase: 20, label: 'tbsp', fractions: true },
  'unit.cup_metric': { dimension: 'volume', toBase: 250, label: 'cup', fractions: true },
  'unit.pint_imperial': { dimension: 'volume', toBase: 568.261, label: 'pint', fractions: true },
  'unit.floz_imperial': { dimension: 'volume', toBase: 28.4131, label: 'floz', fractions: true },
  'unit.ml': { dimension: 'volume', toBase: 1, label: 'ml', fractions: false },
  'unit.l': { dimension: 'volume', toBase: 1000, label: 'l', fractions: false },
  'unit.g': { dimension: 'mass', toBase: 1, label: 'g', fractions: false },
  'unit.kg': { dimension: 'mass', toBase: 1000, label: 'kg', fractions: false },
  'unit.oz': { dimension: 'mass', toBase: 28.3495, label: 'oz', fractions: true },
  'unit.lb': { dimension: 'mass', toBase: 453.592, label: 'lb', fractions: false },
  'unit.each': { dimension: 'count', toBase: 1, label: 'each', fractions: false },
} as const satisfies Record<string, UnitDef>;

export type UnitId = keyof typeof UNITS;

/** One displayable amount, such as 1 ½ cups. A display can have two parts: 1 lb 4 oz. */
export type QuantityPart = { value: number; unitId: UnitId };

export function toBase(quantity: number, unitId: UnitId): number {
  return quantity * UNITS[unitId].toBase;
}

const roundTo = (value: number, step: number) => Math.round(value / step) * step;
/** Rounds to a step, but never shows 0 for a non-zero amount. */
const roundNonZero = (value: number, step: number) =>
  value > 0 ? Math.max(step, roundTo(value, step)) : 0;

const TBSP_US = UNITS['unit.tbsp_us'].toBase;
const CUP_US = UNITS['unit.cup_us'].toBase;
const OZ = UNITS['unit.oz'].toBase;

/** Picks the display unit and rounding for a base quantity (R-UNIT-3, R-UNIT-4). */
export function displayQuantity(
  base: number,
  dimension: Dimension,
  system: UnitSystem,
  options: { liquid?: boolean } = {},
): QuantityPart[] {
  if (dimension === 'count') {
    return [{ value: base > 0 ? Math.ceil(base - 1e-9) : 0, unitId: 'unit.each' }];
  }
  if (system === 'metric') {
    const [small, large]: [UnitId, UnitId] =
      dimension === 'volume' ? ['unit.ml', 'unit.l'] : ['unit.g', 'unit.kg'];
    const rounded = base < 100 ? roundNonZero(base, 5) : roundTo(base, 25);
    if (rounded < 1000) return [{ value: rounded, unitId: small }];
    return [{ value: roundTo(base / 1000, 0.1), unitId: large }];
  }
  if (dimension === 'mass') {
    const oz = base / OZ;
    if (roundTo(oz, 0.5) < 16) return [{ value: roundNonZero(oz, 0.5), unitId: 'unit.oz' }];
    let lb = Math.floor(oz / 16);
    let rest = Math.round(oz - lb * 16);
    if (rest === 16) {
      lb += 1;
      rest = 0;
    }
    return rest
      ? [
          { value: lb, unitId: 'unit.lb' },
          { value: rest, unitId: 'unit.oz' },
        ]
      : [{ value: lb, unitId: 'unit.lb' }];
  }
  // US customary volume
  if (base < TBSP_US) {
    return [
      { value: roundNonZero(base / UNITS['unit.tsp_us'].toBase, 0.25), unitId: 'unit.tsp_us' },
    ];
  }
  if (base < 3 * TBSP_US)
    return [{ value: roundNonZero(base / TBSP_US, 0.5), unitId: 'unit.tbsp_us' }];
  if (options.liquid && base > 4 * CUP_US) {
    return [{ value: roundNonZero(base / UNITS['unit.qt_us'].toBase, 0.25), unitId: 'unit.qt_us' }];
  }
  return [{ value: roundNonZero(base / CUP_US, 0.25), unitId: 'unit.cup_us' }];
}
