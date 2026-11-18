// The seam where the AI parser plugs in. ai/ai_parser.ts implements it over a provider
// adapter; index.ts picks the adapter from the AI_PROVIDER secret (decision D-7).

import type { Locale, ParseSource, RecipeDraft, Region } from './types.ts';

/** Everything a parser may see (spec AI-8): the source content, locale and region only. */
export interface ParseRequest {
  source: ParseSource;
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

/** Used while no provider is configured: every parse fails cleanly and nothing is counted. */
export const parserNotConfigured: RecipeParser = {
  parse() {
    return Promise.reject(new ParserError('import.parser_unavailable'));
  },
};
