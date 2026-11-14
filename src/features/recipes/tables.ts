import type { SyncRow, SyncTableDefinition } from '@/lib/sync/types';

/**
 * The recipe tables in the household sync layer (R-02.1, FR-REC-12, architecture section 3.2).
 * Plain definitions with no app imports, so the two-device harness can use them too.
 * `sync.ts` registers them with the sync layer.
 */
export const RECIPES = {
  name: 'recipes',
  columns: {
    title: 'text',
    servings: 'integer',
    prep_minutes: 'integer',
    cook_minutes: 'integer',
    tags: 'json',
    notes: 'text',
    source_type: 'text',
    source_url: 'text',
    library_recipe_id: 'text',
    content_locale: 'text',
    created_by: 'text',
    updated_by: 'text',
  },
} as const satisfies SyncTableDefinition;

export const RECIPE_INGREDIENTS = {
  name: 'recipe_ingredients',
  columns: {
    recipe_id: 'text',
    position: 'integer',
    ingredient_id: 'text',
    quantity: 'real',
    unit_id: 'text',
    quantity_base: 'real',
    raw_text: 'text',
    note: 'text',
    optional: 'boolean',
  },
} as const satisfies SyncTableDefinition;

export const RECIPE_STEPS = {
  name: 'recipe_steps',
  columns: {
    recipe_id: 'text',
    position: 'integer',
    text: 'text',
  },
} as const satisfies SyncTableDefinition;

export const RECIPE_TABLES = [RECIPES, RECIPE_INGREDIENTS, RECIPE_STEPS] as const;

/** The fixed Phase 1 tag set (FR-REC-7). Names come from the locale files (`recipes.tags.*`). */
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
export type RecipeTag = (typeof RECIPE_TAGS)[number];

export type RecipeSourceType =
  'manual' | 'url' | 'photo' | 'screenshot' | 'text' | 'voice' | 'library';

/** Limits from FR-REC-4 (PROPOSED). The database checks the same. */
export const RECIPE_LIMITS = {
  titleLength: 120,
  minServings: 1,
  maxServings: 24,
  defaultServings: 4,
  maxLines: 100,
  maxSteps: 50,
} as const;

export type RecipeRow = SyncRow & {
  title: string;
  servings: number;
  prep_minutes: number | null;
  cook_minutes: number | null;
  tags: RecipeTag[];
  notes: string | null;
  source_type: RecipeSourceType;
  source_url: string | null;
  library_recipe_id: string | null;
  content_locale: string;
  created_by: string | null;
  updated_by: string | null;
};

export type RecipeIngredientRow = SyncRow & {
  recipe_id: string;
  position: number;
  ingredient_id: string;
  quantity: number | null;
  unit_id: string | null;
  /** quantity x unit.to_base, in g, ml or each (R-ING-3). Worked out again by the server. */
  quantity_base: number | null;
  raw_text: string | null;
  note: string | null;
  optional: boolean;
};

export type RecipeStepRow = SyncRow & {
  recipe_id: string;
  position: number;
  text: string;
};
