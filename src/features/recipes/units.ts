import { REGIONAL_UNITS, UNITS, type Region, type UnitId, type UnitSystem } from '@/i18n';

/** Units a line can use: the measured ones, plus "a pinch" and "a dash" (R-ING-5). */
export type LineUnitId = UnitId | 'unit.pinch' | 'unit.dash';

const regional = (region: Region, words: (keyof typeof REGIONAL_UNITS)[]) =>
  words.map((w) => REGIONAL_UNITS[w][region]);

/**
 * The unit picker's order (FR-REC-5): the household's unit system first, with regional sizes
 * for its region ("tbsp" is 20 ml in Australia), then counts, a pinch and a dash. Everything
 * else is under "more units".
 */
export function unitChoices(
  system: UnitSystem,
  region: Region,
): { primary: LineUnitId[]; more: LineUnitId[] } {
  const primary: LineUnitId[] =
    system === 'metric'
      ? ['unit.g', 'unit.kg', 'unit.ml', 'unit.l', ...regional(region, ['tsp', 'tbsp', 'cup'])]
      : [...regional('US', ['tsp', 'tbsp', 'cup']), 'unit.oz', 'unit.lb', 'unit.floz_us'];
  primary.push('unit.each', 'unit.pinch', 'unit.dash');
  const more = (Object.keys(UNITS) as UnitId[]).filter((id) => !primary.includes(id));
  return { primary, more };
}

export function isMeasured(unitId: string | null): unitId is UnitId {
  return unitId !== null && unitId in UNITS;
}

/** Which units belong to each unit system, as the `units.systems` column says (R-UNIT-3). */
const SYSTEM_UNITS: Record<UnitSystem, readonly UnitId[]> = {
  us_customary: [
    'unit.tsp_us',
    'unit.tbsp_us',
    'unit.cup_us',
    'unit.floz_us',
    'unit.pint_us',
    'unit.qt_us',
    'unit.oz',
    'unit.lb',
    'unit.g',
    'unit.ml',
    'unit.each',
  ],
  metric: [
    'unit.g',
    'unit.kg',
    'unit.ml',
    'unit.l',
    'unit.tsp_metric',
    'unit.tbsp_metric',
    'unit.tbsp_au',
    'unit.cup_metric',
    'unit.pint_imperial',
    'unit.floz_imperial',
    'unit.each',
  ],
};

export function inSystem(unitId: UnitId, system: UnitSystem): boolean {
  return SYSTEM_UNITS[system].includes(unitId);
}
