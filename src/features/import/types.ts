/**
 * The import-recipe function's draft, as it arrives from the server (architecture section 6).
 * It mirrors `supabase/functions/import-recipe/types.ts`; the vocabulary test checks that the
 * two stay in step.
 */
export type ImportedLine = {
  /** The line as the source wrote it (FR-AI-5). */
  original: string;
  quantity: number | null;
  /** A unit ID from the allowed list, or null. */
  unitId: string | null;
  /** The model's name for the ingredient, matched to the catalog on the device (AI-3). */
  ingredientName: string | null;
  note: string | null;
  /** 0 to 1 (AI-4). Lines from embedded page data have 0 until they're matched. */
  confidence: number;
};

export type ImportedDraft = {
  title: string | null;
  servings: number | null;
  prepMinutes: number | null;
  cookMinutes: number | null;
  ingredients: ImportedLine[];
  steps: string[];
  tags: string[];
  /** Allergen codes the source itself mentions (AI-11). */
  allergens: string[];
};

/** Where a draft came from: embedded schema.org data (free) or the AI parser (counted). */
export type ImportSource = 'structured_data' | 'parser';
