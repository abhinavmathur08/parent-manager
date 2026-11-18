// The fixed lists a parse may use (spec AI-1, AI-2): unit IDs, regional unit sizes, recipe
// tags and allergen codes. They copy the app's lists, which Edge Functions can't import;
// __tests__/import-vocabulary.test.ts fails if the two drift apart.

import type { Region } from './types.ts';

/** Every unit a line can use, as stored in recipe_ingredients.unit_id (R-ING-5). */
export const UNIT_IDS = [
  'unit.tsp_us',
  'unit.tbsp_us',
  'unit.cup_us',
  'unit.floz_us',
  'unit.pint_us',
  'unit.qt_us',
  'unit.tsp_metric',
  'unit.tbsp_metric',
  'unit.tbsp_au',
  'unit.cup_metric',
  'unit.pint_imperial',
  'unit.floz_imperial',
  'unit.ml',
  'unit.l',
  'unit.g',
  'unit.kg',
  'unit.oz',
  'unit.lb',
  'unit.each',
  'unit.pinch',
  'unit.dash',
] as const;
export type UnitId = (typeof UNIT_IDS)[number];

/** Which unit an ambiguous word means in each region (AI-2): a tbsp is 20 ml in Australia. */
export const REGIONAL_UNITS = {
  tsp: { US: 'unit.tsp_us', GB: 'unit.tsp_metric', AU: 'unit.tsp_metric' },
  tbsp: { US: 'unit.tbsp_us', GB: 'unit.tbsp_metric', AU: 'unit.tbsp_au' },
  cup: { US: 'unit.cup_us', GB: 'unit.cup_metric', AU: 'unit.cup_metric' },
  floz: { US: 'unit.floz_us', GB: 'unit.floz_imperial', AU: 'unit.floz_imperial' },
  pint: { US: 'unit.pint_us', GB: 'unit.pint_imperial', AU: 'unit.pint_imperial' },
} as const satisfies Record<string, Record<Region, UnitId>>;

/** The fixed Phase 1 tag set (FR-REC-7). */
export const RECIPE_TAGS = [
  'tag.no_cook',
  'tag.one_handed',
  'tag.freezer_friendly',
  'tag.batch_prep',
  'tag.quick',
  'tag.kid_friendly',
  'tag.toddler',
  'tag.baby_led_weaning',
  'tag.needs_defrosting',
] as const;

/** Allergen codes (FR-HH-12). */
export const ALLERGEN_CODES = [
  'allergen.milk',
  'allergen.egg',
  'allergen.fish',
  'allergen.crustacean',
  'allergen.tree_nut',
  'allergen.peanut',
  'allergen.wheat',
  'allergen.soy',
  'allergen.sesame',
  'allergen.gluten',
  'allergen.celery',
  'allergen.mustard',
  'allergen.sulphite',
  'allergen.lupin',
  'allergen.mollusc',
] as const;

export const isUnitId = (value: unknown): value is UnitId =>
  (UNIT_IDS as readonly unknown[]).includes(value);
