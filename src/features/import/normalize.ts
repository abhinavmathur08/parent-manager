import { ALLERGEN_CODES, type AllergenCode } from '@/features/ingredients/catalog-ids';
import { householdIngredientId } from '@/features/ingredients/household';
import {
  parseIngredientLine,
  type MatchQuality,
  type ParseOptions,
} from '@/features/ingredients/matching';
import {
  emptyDraft,
  type DraftLine,
  type NewIngredient,
  type RecipeDraft,
} from '@/features/recipes/draft';
import { ingredientWords } from '@/features/recipes/quick-add';
import { isRecipeTag, RECIPE_LIMITS } from '@/features/recipes/tables';
import { isMeasured, type LineUnitId } from '@/features/recipes/units';
import { UNITS, type Dimension } from '@/i18n';

import type { ImportedDraft, ImportedLine } from './types';

/** FR-AI-6 (PROPOSED): lines below this are highlighted on review. */
export const LOW_CONFIDENCE = 0.7;

/** How much a catalog match can be trusted, by how it was found (R-01.3). */
const MATCH_CONFIDENCE: Record<MatchQuality, number> = {
  exact: 1,
  partial: 0.85,
  search: 0.5,
  none: 0,
};
const MATCH_ORDER: MatchQuality[] = ['exact', 'partial', 'search', 'none'];

const LINE_UNITS = new Set<string>([...Object.keys(UNITS), 'unit.pinch', 'unit.dash']);

/** What review needs to know about a line beyond the editor's own fields. */
export type LineReview = {
  original: string;
  /** 0 to 1, after matching (AI-4). */
  confidence: number;
  /** No catalog or household ingredient matched; it becomes a household ingredient (FR-AI-6). */
  unmatched: boolean;
};

export type ReviewDraft = {
  /** The editor's form, prefilled. Nothing is saved until the member confirms (FR-AI-4). */
  recipe: RecipeDraft;
  /** Per line ID, as first imported. */
  lines: Record<string, LineReview>;
  /** Allergens the source itself mentions (AI-11): they add to the catalog's flags. */
  sourceAllergens: AllergenCode[];
};

export const needsReview = (line: LineReview) => line.unmatched || line.confidence < LOW_CONFIDENCE;

function dimensionOf(unitId: string | null): Dimension {
  return unitId && unitId in UNITS ? UNITS[unitId as keyof typeof UNITS].dimension : 'count';
}

/** A line from embedded page data, which only has its original text so far. */
const unparsed = (line: ImportedLine) =>
  line.confidence === 0 && line.ingredientName === null && line.quantity === null;

/**
 * Matches one imported line to an ingredient ID, using the device's matcher over the
 * catalog and the household's own ingredients (R-01.3). The model's ingredient name is
 * tried first, then the original line; the better match wins.
 */
function normalizeLine(
  line: ImportedLine,
  options: ParseOptions,
  newId: () => string,
): { line: DraftLine; review: LineReview; created: NewIngredient | null } {
  const fromOriginal = parseIngredientLine(line.original, options);
  const fromName = line.ingredientName ? parseIngredientLine(line.ingredientName, options) : null;
  const best = [fromName, fromOriginal]
    .filter((p) => p !== null && p.ingredientId !== null)
    .sort((a, b) => MATCH_ORDER.indexOf(a!.match) - MATCH_ORDER.indexOf(b!.match))[0];
  const match = best?.match ?? 'none';

  const aiUnit = line.unitId && LINE_UNITS.has(line.unitId) ? line.unitId : null;
  const useModel = !unparsed(line) && (line.quantity !== null || aiUnit !== null);
  const quantity = useModel ? line.quantity : fromOriginal.quantity;
  // A counted line the model gave no unit ("2 eggs") takes the matcher's unit.each.
  const unitId = (
    useModel ? (aiUnit ?? (quantity !== null ? fromOriginal.unitId : null)) : fromOriginal.unitId
  ) as LineUnitId | null;
  const modelConfidence = unparsed(line) ? 1 : line.confidence;
  const confidence = Math.min(modelConfidence, MATCH_CONFIDENCE[match]);

  const id = newId();
  let ingredientId = best?.ingredientId ?? '';
  let created: NewIngredient | null = null;
  if (!best) {
    const rowId = newId();
    ingredientId = householdIngredientId(rowId);
    const name =
      line.ingredientName ??
      ingredientWords(line.original, options.vocabulary, options.region) ??
      line.original;
    created = {
      rowId,
      ingredientId,
      name: (name || line.original).slice(0, 120),
      sectionId: 'section.other',
      dimension: isMeasured(unitId) ? dimensionOf(unitId) : 'count',
    };
  }
  const note = (unparsed(line) ? fromOriginal.notes.join(', ') : line.note) || null;
  return {
    line: { id, ingredientId, quantity, unitId, rawText: line.original, note, optional: false },
    review: { original: line.original, confidence, unmatched: created !== null },
    created,
  };
}

/**
 * Turns the server's draft into the editor's form and the review highlights (FR-AI-5,
 * FR-AI-6). Units and ingredients end up as IDs only (R-ING-6): display text is matched here,
 * through the locale's name index, and nowhere after.
 */
export function normalizeDraft(
  draft: ImportedDraft,
  options: ParseOptions & { newId: () => string; sourceUrl?: string },
): ReviewDraft {
  const recipe = emptyDraft();
  const lines: Record<string, LineReview> = {};
  for (const imported of draft.ingredients.slice(0, RECIPE_LIMITS.maxLines)) {
    const { line, review, created } = normalizeLine(imported, options, options.newId);
    recipe.lines.push(line);
    lines[line.id] = review;
    if (created) recipe.newIngredients.push(created);
  }
  recipe.title = (draft.title ?? '').slice(0, RECIPE_LIMITS.titleLength);
  if (draft.servings !== null) {
    recipe.servings = Math.min(
      RECIPE_LIMITS.maxServings,
      Math.max(RECIPE_LIMITS.minServings, draft.servings),
    );
  }
  recipe.prepMinutes = draft.prepMinutes === null ? '' : String(draft.prepMinutes);
  recipe.cookMinutes = draft.cookMinutes === null ? '' : String(draft.cookMinutes);
  recipe.tags = draft.tags.filter(isRecipeTag);
  recipe.steps = draft.steps
    .slice(0, RECIPE_LIMITS.maxSteps)
    .map((text) => ({ id: options.newId(), text }));
  recipe.sourceUrl = options.sourceUrl ?? '';
  const sourceAllergens = ALLERGEN_CODES.filter((code) => draft.allergens.includes(code));
  return { recipe, lines, sourceAllergens };
}
