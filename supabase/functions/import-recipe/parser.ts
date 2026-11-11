// The seam where the AI parser plugs in (R-05.3).
//
// The provider isn't chosen yet (decision D-7), so no implementation calls a model. R-05.3
// adds one that implements RecipeParser and is passed to createHandler in index.ts.

import type { Locale, RecipeDraft, Region } from './types.ts';

/** Everything a parser may see (spec AI-8): the source content, locale and region only. */
export interface ParseRequest {
  source: { kind: 'text'; text: string };
  /** Always set (FR-AI-14, AI-15). */
  locale: Locale;
  region: Region;
  /** Aborted when the import's time limit runs out (FR-AI-11). */
  signal: AbortSignal;
}

export interface ParseResult {
  draft: RecipeDraft;
  /** The model that produced the draft, for quality tracking. */
  model: string;
  /** Provider cost units, for the per-job cost ceiling. */
  costUnits: number;
}

export interface RecipeParser {
  parse(request: ParseRequest): Promise<ParseResult>;
}

/** A parser failure with a stable code, such as `import.parse_failed`. */
export class ParserError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = 'ParserError';
  }
}

/** Used until R-05.3: every parse fails cleanly, so the reservation is released. */
export const parserNotConfigured: RecipeParser = {
  parse() {
    return Promise.reject(new ParserError('import.parser_unavailable'));
  },
};
