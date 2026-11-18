// The AI parser (R-05.3): sends one source to a provider with structured output, checks the
// result, and retries once with backoff when the provider fails or returns invalid output
// (spec AI-18). Providers sit behind AiProvider, so changing provider (decision D-7) only
// changes which adapter index.ts passes in.

import { ParserError, type ParseRequest, type ParseResult, type RecipeParser } from '../parser.ts';
import { buildContent, DRAFT_SCHEMA, type ModelRequest, SYSTEM_PROMPT } from './prompt.ts';
import { validateOutput } from './validate.ts';

export interface ModelResponse {
  /** The parsed JSON the model returned, not yet checked. */
  output: unknown;
  /** The model that answered, such as `claude-opus-5-5`. */
  model: string;
  /** Input plus output tokens, for the per-job cost ceiling and cost tracking. */
  costUnits: number;
}

export interface AiProvider {
  /** Short and stable, such as `anthropic` or `fake`. */
  readonly name: string;
  generate(request: ModelRequest): Promise<ModelResponse>;
}

/**
 * A provider failure. Retryable ones (rate limits, overload, timeouts, network) get the one
 * retry; the rest fail straight away with `code`.
 */
export class ProviderError extends Error {
  constructor(
    readonly retryable: boolean,
    readonly code: 'import.parse_failed' | 'import.parser_unavailable' = 'import.parse_failed',
  ) {
    super(code);
    this.name = 'ProviderError';
  }
}

export interface AiParserOptions {
  /** The wait before the retry (AI-18). */
  retryDelayMs?: number;
  sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
}

const RETRY_DELAY_MS = 1_000;

function defaultSleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener('abort', () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

export function createAiParser(provider: AiProvider, options: AiParserOptions = {}): RecipeParser {
  const retryDelayMs = options.retryDelayMs ?? RETRY_DELAY_MS;
  const sleep = options.sleep ?? defaultSleep;

  return {
    async parse(request: ParseRequest): Promise<ParseResult> {
      const modelRequest: ModelRequest = {
        system: SYSTEM_PROMPT,
        content: buildContent(request.source, request.locale, request.region),
        schema: DRAFT_SCHEMA,
        signal: request.signal,
      };
      let costUnits = 0;
      for (let attempt = 1; ; attempt++) {
        let failure: ParserError;
        try {
          const response = await provider.generate(modelRequest);
          costUnits += response.costUnits;
          const checked = validateOutput(response.output);
          if (checked.ok) return { draft: checked.draft, model: response.model, costUnits };
          if (checked.reason === 'not_a_recipe') throw new ParserError('import.no_recipe_found');
          failure = new ParserError('import.parse_failed');
        } catch (error) {
          if (error instanceof ParserError) throw error;
          if (error instanceof ProviderError && !error.retryable) {
            throw new ParserError(error.code);
          }
          failure = new ParserError('import.parse_failed');
        }
        if (attempt >= 2 || request.signal.aborted) throw failure;
        await sleep(retryDelayMs * attempt, request.signal);
        if (request.signal.aborted) throw failure;
      }
    },
  };
}
