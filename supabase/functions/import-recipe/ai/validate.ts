// Checks a model's output and turns it into a draft (spec AI-1 to AI-6). The schema already
// constrains the shape, but providers differ, so every field is checked again here: anything
// malformed makes the whole output invalid, which is retried once (AI-18).

import type { DraftIngredientLine, RecipeDraft } from '../types.ts';
import { ALLERGEN_CODES, isUnitId, RECIPE_TAGS } from '../vocabulary.ts';

const MAX_TITLE_CHARS = 200;
const MAX_LINE_CHARS = 500;
const MAX_NAME_CHARS = 120;
const MAX_STEP_CHARS = 2_000;
const MAX_LINES = 100;
const MAX_STEPS = 100;
const MAX_SERVINGS = 100;
const MAX_MINUTES = 1_440;

/** A line with no amount is guidance-highlighted (AI-6, FR-AI-6). */
const MISSING_QUANTITY_CONFIDENCE = 0.6;
/** An ingredient the source only implies (AI-6). */
const INFERRED_CONFIDENCE = 0.4;

export type Validated =
  { ok: true; draft: RecipeDraft } | { ok: false; reason: 'not_a_recipe' | 'invalid' };

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

function text(value: unknown, max: number): string | null | undefined {
  if (value === null) return null;
  if (typeof value !== 'string') return undefined;
  const trimmed = value.replace(/\s+/g, ' ').trim();
  return trimmed ? trimmed.slice(0, max) : null;
}

/** A whole number in range, null when absent or out of range. Undefined when malformed. */
function wholeNumber(value: unknown, max: number): number | null | undefined {
  if (value === null) return null;
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined;
  const n = Math.round(value);
  return n >= 1 && n <= max ? n : null;
}

function line(value: unknown): DraftIngredientLine | undefined {
  if (!isObject(value)) return undefined;
  const original = text(value.original, MAX_LINE_CHARS);
  const name = text(value.ingredientName, MAX_NAME_CHARS);
  const note = text(value.note, MAX_LINE_CHARS);
  if (!original || name === undefined || note === undefined) return undefined;
  if (typeof value.confidence !== 'number' || !Number.isFinite(value.confidence)) return undefined;
  if (value.inferred !== undefined && typeof value.inferred !== 'boolean') return undefined;

  let quantity: number | null = null;
  if (value.quantity !== null) {
    if (typeof value.quantity !== 'number' || !Number.isFinite(value.quantity)) return undefined;
    quantity = value.quantity > 0 && value.quantity < 100_000 ? value.quantity : null;
  }
  // A unit outside the allowed list is dropped, not trusted (AI-2).
  const unitId = isUnitId(value.unitId) ? value.unitId : null;
  const unitDropped = value.unitId !== null && unitId === null;

  let confidence = Math.min(1, Math.max(0, value.confidence));
  const unmeasured = unitId === 'unit.pinch' || unitId === 'unit.dash';
  if (quantity === null && !unmeasured)
    confidence = Math.min(confidence, MISSING_QUANTITY_CONFIDENCE);
  if (unitDropped) confidence = Math.min(confidence, MISSING_QUANTITY_CONFIDENCE);
  if (value.inferred === true) confidence = Math.min(confidence, INFERRED_CONFIDENCE);

  return { original, quantity, unitId, ingredientName: name, note, confidence };
}

function fromList<T extends string>(value: unknown, allowed: readonly T[]): T[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return allowed.filter((id) => value.includes(id));
}

export function validateOutput(output: unknown): Validated {
  if (!isObject(output) || typeof output.isRecipe !== 'boolean') {
    return { ok: false, reason: 'invalid' };
  }
  if (!output.isRecipe) return { ok: false, reason: 'not_a_recipe' };

  const title = text(output.title, MAX_TITLE_CHARS);
  const servings = wholeNumber(output.servings, MAX_SERVINGS);
  const prepMinutes = wholeNumber(output.prepMinutes, MAX_MINUTES);
  const cookMinutes = wholeNumber(output.cookMinutes, MAX_MINUTES);
  const tags = fromList(output.tags, RECIPE_TAGS);
  const allergens = fromList(output.allergens, ALLERGEN_CODES);
  if (
    title === undefined ||
    servings === undefined ||
    prepMinutes === undefined ||
    cookMinutes === undefined ||
    !tags ||
    !allergens ||
    !Array.isArray(output.ingredients) ||
    !Array.isArray(output.steps)
  ) {
    return { ok: false, reason: 'invalid' };
  }

  const ingredients: DraftIngredientLine[] = [];
  for (const raw of output.ingredients.slice(0, MAX_LINES)) {
    const parsed = line(raw);
    if (!parsed) return { ok: false, reason: 'invalid' };
    ingredients.push(parsed);
  }
  const steps: string[] = [];
  for (const raw of output.steps.slice(0, MAX_STEPS)) {
    const step = text(raw, MAX_STEP_CHARS);
    if (step === undefined) return { ok: false, reason: 'invalid' };
    if (step) steps.push(step);
  }
  // Nothing usable at all is a failed parse, not an empty draft.
  if (!title && ingredients.length === 0 && steps.length === 0) {
    return { ok: false, reason: 'not_a_recipe' };
  }

  return {
    ok: true,
    draft: { title, servings, prepMinutes, cookMinutes, ingredients, steps, tags, allergens },
  };
}
