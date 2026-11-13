import type { SectionId } from '@/features/ingredients/catalog-ids';
import { HOUSEHOLD_INGREDIENTS } from '@/features/ingredients/household';
import type { Dimension } from '@/i18n';
import type { SyncValue } from '@/lib/sync/types';

import { quantityBase } from './quantity';
import {
  RECIPE_INGREDIENTS,
  RECIPE_LIMITS,
  RECIPE_STEPS,
  RECIPES,
  type RecipeIngredientRow,
  type RecipeRow,
  type RecipeStepRow,
  type RecipeTag,
} from './tables';
import type { LineUnitId } from './units';

/** One ingredient line being edited (FR-REC-5). */
export type DraftLine = {
  id: string;
  ingredientId: string;
  quantity: number | null;
  unitId: LineUnitId | null;
  rawText: string | null;
  note: string | null;
  optional: boolean;
};

export type DraftStep = { id: string; text: string };

/** An ingredient added with "add as new ingredient", written when the recipe is saved. */
export type NewIngredient = {
  rowId: string;
  ingredientId: string;
  name: string;
  sectionId: SectionId;
  dimension: Dimension;
};

/** The S-18 form (FR-REC-4). Minutes stay as typed until saved. */
export type RecipeDraft = {
  title: string;
  servings: number;
  prepMinutes: string;
  cookMinutes: string;
  tags: RecipeTag[];
  notes: string;
  sourceUrl: string;
  lines: DraftLine[];
  steps: DraftStep[];
  newIngredients: NewIngredient[];
};

export type SavedRecipe = {
  recipe: RecipeRow;
  lines: readonly RecipeIngredientRow[];
  steps: readonly RecipeStepRow[];
};

export function emptyDraft(): RecipeDraft {
  return {
    title: '',
    servings: RECIPE_LIMITS.defaultServings,
    prepMinutes: '',
    cookMinutes: '',
    tags: [],
    notes: '',
    sourceUrl: '',
    lines: [],
    steps: [],
    newIngredients: [],
  };
}

const byPosition = <T extends { position: number }>(rows: readonly T[]) =>
  [...rows].sort((a, b) => a.position - b.position);

export function draftFromRecipe({ recipe, lines, steps }: SavedRecipe): RecipeDraft {
  return {
    title: recipe.title,
    servings: recipe.servings,
    prepMinutes: recipe.prep_minutes === null ? '' : String(recipe.prep_minutes),
    cookMinutes: recipe.cook_minutes === null ? '' : String(recipe.cook_minutes),
    tags: [...recipe.tags],
    notes: recipe.notes ?? '',
    sourceUrl: recipe.source_url ?? '',
    lines: byPosition(lines).map((l) => ({
      id: l.id,
      ingredientId: l.ingredient_id,
      quantity: l.quantity,
      unitId: l.unit_id as LineUnitId | null,
      rawText: l.raw_text,
      note: l.note,
      optional: l.optional,
    })),
    steps: byPosition(steps).map((s) => ({ id: s.id, text: s.text })),
    newIngredients: [],
  };
}

/** Whole minutes from 0 to 1440, null when empty, undefined when not a number. */
export function parseMinutes(text: string): number | null | undefined {
  const trimmed = text.trim();
  if (trimmed === '') return null;
  if (!/^\d{1,4}$/.test(trimmed)) return undefined;
  const value = Number(trimmed);
  return value <= 1440 ? value : undefined;
}

export type DraftErrors = Partial<
  Record<'title' | 'prepMinutes' | 'cookMinutes' | 'sourceUrl' | 'lines' | 'steps', string>
>;

/** Checks the form against FR-REC-4. Values are translation keys. */
export function validateDraft(draft: RecipeDraft): DraftErrors {
  const errors: DraftErrors = {};
  const title = draft.title.trim();
  if (!title) errors.title = 'recipes.editor.errors.titleRequired';
  else if (title.length > RECIPE_LIMITS.titleLength)
    errors.title = 'recipes.editor.errors.titleLong';
  if (parseMinutes(draft.prepMinutes) === undefined)
    errors.prepMinutes = 'recipes.editor.errors.minutes';
  if (parseMinutes(draft.cookMinutes) === undefined)
    errors.cookMinutes = 'recipes.editor.errors.minutes';
  const url = draft.sourceUrl.trim();
  if (url && !/^https?:\/\/\S+$/i.test(url)) errors.sourceUrl = 'recipes.editor.errors.link';
  if (draft.lines.length > RECIPE_LIMITS.maxLines)
    errors.lines = 'recipes.editor.errors.tooManyLines';
  if (draft.steps.filter((s) => s.text.trim()).length > RECIPE_LIMITS.maxSteps)
    errors.steps = 'recipes.editor.errors.tooManySteps';
  return errors;
}

export type SaveOp =
  | { kind: 'insert' | 'update'; table: string; id: string; values: Record<string, SyncValue> }
  | { kind: 'remove'; table: string; id: string };

/** The fields that changed, so an edit only touches what the household changed. */
function changed(
  before: Record<string, unknown> | undefined,
  after: Record<string, SyncValue>,
): Record<string, SyncValue> {
  if (!before) return after;
  return Object.fromEntries(
    Object.entries(after).filter(
      ([key, value]) => JSON.stringify(before[key] ?? null) !== JSON.stringify(value ?? null),
    ),
  );
}

/**
 * The writes that save a draft, in order: new ingredients first (so they reach the server
 * before the lines that use them), then the recipe, its lines and its steps. Lines and steps
 * are their own rows, so only the ones that changed are written (architecture section 5).
 */
export function planSave(
  existing: SavedRecipe | null,
  draft: RecipeDraft,
  context: { recipeId: string; locale: string; dimension: (ingredientId: string) => Dimension },
): SaveOp[] {
  const ops: SaveOp[] = [];
  const used = new Set(draft.lines.map((l) => l.ingredientId));
  for (const added of draft.newIngredients) {
    if (!used.has(added.ingredientId)) continue;
    ops.push({
      kind: 'insert',
      table: HOUSEHOLD_INGREDIENTS.name,
      id: added.rowId,
      values: {
        name: added.name.trim(),
        locale: context.locale,
        section_id: added.sectionId,
        default_dimension: added.dimension,
      },
    });
  }
  const dimensionOf = (id: string) =>
    draft.newIngredients.find((n) => n.ingredientId === id)?.dimension ?? context.dimension(id);

  const recipe: Record<string, SyncValue> = {
    title: draft.title.trim(),
    servings: draft.servings,
    prep_minutes: parseMinutes(draft.prepMinutes) ?? null,
    cook_minutes: parseMinutes(draft.cookMinutes) ?? null,
    tags: draft.tags,
    notes: draft.notes.trim() || null,
    source_url: draft.sourceUrl.trim() || null,
  };
  if (existing) {
    const patch = changed(existing.recipe, recipe);
    if (Object.keys(patch).length)
      ops.push({ kind: 'update', table: RECIPES.name, id: context.recipeId, values: patch });
  } else {
    ops.push({
      kind: 'insert',
      table: RECIPES.name,
      id: context.recipeId,
      values: {
        ...recipe,
        source_type: 'manual',
        library_recipe_id: null,
        content_locale: context.locale,
      },
    });
  }

  const children = <Row extends { id: string }>(
    table: string,
    before: readonly Row[],
    after: { id: string; values: Record<string, SyncValue> }[],
  ) => {
    const kept = new Set(after.map((a) => a.id));
    for (const row of before)
      if (!kept.has(row.id)) ops.push({ kind: 'remove', table, id: row.id });
    const old = new Map(before.map((row) => [row.id, row as unknown as Record<string, unknown>]));
    for (const { id, values } of after) {
      const previous = old.get(id);
      if (!previous) {
        ops.push({ kind: 'insert', table, id, values: { recipe_id: context.recipeId, ...values } });
        continue;
      }
      const patch = changed(previous, values);
      if (Object.keys(patch).length) ops.push({ kind: 'update', table, id, values: patch });
    }
  };

  children(
    RECIPE_INGREDIENTS.name,
    existing?.lines ?? [],
    draft.lines.map((line, position) => ({
      id: line.id,
      values: {
        position,
        ingredient_id: line.ingredientId,
        quantity: line.quantity,
        unit_id: line.unitId,
        quantity_base: quantityBase(line.quantity, line.unitId, dimensionOf(line.ingredientId)),
        raw_text: line.rawText,
        note: line.note,
        optional: line.optional,
      },
    })),
  );
  children(
    RECIPE_STEPS.name,
    existing?.steps ?? [],
    draft.steps
      .filter((s) => s.text.trim())
      .map((step, position) => ({ id: step.id, values: { position, text: step.text.trim() } })),
  );
  return ops;
}
