// Types shared by the import-recipe pipeline (architecture section 6).

export type Locale = 'en-US' | 'en-GB' | 'en-AU';
export type Region = 'US' | 'GB' | 'AU';
export type InputType = 'link' | 'text' | 'image';

/** What the app sends. The household's locale and region are read on the server. */
export type ImportRequest = { type: 'text'; text: string };

/** One ingredient line of a draft (spec AI-1, AI-4). */
export interface DraftIngredientLine {
  /** The line as it appeared in the source, shown beside the parse (FR-AI-5). */
  original: string;
  quantity: number | null;
  /** A unit ID such as `unit.cup_us`, or null when the line has no unit (AI-2). */
  unitId: string | null;
  /** The ingredient name to match against the catalog (AI-3). */
  ingredientName: string | null;
  note: string | null;
  /** 0 to 1 (AI-4). Lines below 0.7 are highlighted on review (FR-AI-6). */
  confidence: number;
}

/** A draft recipe. Nothing is saved until a member confirms it (FR-AI-4, AI-5). */
export interface RecipeDraft {
  title: string | null;
  servings: number | null;
  prepMinutes: number | null;
  cookMinutes: number | null;
  ingredients: DraftIngredientLine[];
  steps: string[];
  /** Tag IDs from the fixed list. */
  tags: string[];
  /** Allergen codes the source flags, such as `allergen.peanut` (AI-11). */
  allergens: string[];
}

/** Where a successful draft came from. Only `parser` counts against the allowance. */
export type DraftSource = 'structured_data' | 'parser';
