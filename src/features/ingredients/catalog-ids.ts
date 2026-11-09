/**
 * Language-neutral IDs for the ingredient catalog (architecture section 3.2, NFR-L10N-5).
 * The database checks the same lists (supabase/migrations/*_ingredient_catalog_schema.sql).
 * Display names come from the locale files: sections.<key> and allergens.<key>.
 */

/** Store sections in their default aisle order. */
export const SECTION_IDS = [
  'section.produce',
  'section.bakery',
  'section.meat',
  'section.seafood',
  'section.deli',
  'section.dairy',
  'section.frozen',
  'section.pantry',
  'section.baking',
  'section.spices',
  'section.condiments',
  'section.canned',
  'section.international',
  'section.breakfast',
  'section.snacks',
  'section.drinks',
  'section.baby',
  'section.household',
  'section.other',
] as const;

export type SectionId = (typeof SECTION_IDS)[number];

/** The US major allergens, then the rest of the UK and EU 14 (FR-HH-12). */
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

export type AllergenCode = (typeof ALLERGEN_CODES)[number];

/** Translation key for an ID, such as sections.dairy for section.dairy. */
export const nameKey = (id: SectionId | AllergenCode) =>
  id.startsWith('section.') ? `sections.${id.slice(8)}` : `allergens.${id.slice(9)}`;
