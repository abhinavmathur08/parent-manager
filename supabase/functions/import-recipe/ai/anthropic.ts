// The Claude adapter (decision D-7's first candidate). It's off unless the project sets the
// secrets AI_PROVIDER=anthropic and ANTHROPIC_API_KEY (see docs/decisions-needed.md, D-7).
//
// It calls the Messages API over plain fetch rather than the SDK, so the same file runs in
// the Edge Function (Deno) and in the evaluation script (Node) with no extra dependency.
// Structured output (`output_config.format`) makes the reply follow DRAFT_SCHEMA.

import type { AiProvider, ModelResponse } from './ai_parser.ts';
import { ProviderError } from './ai_parser.ts';
import type { ContentPart, ModelRequest } from './prompt.ts';

export const ANTHROPIC_DEFAULT_MODEL = 'claude-opus-5-5';
const API_URL = 'https://api.anthropic.com/v1/messages';
const API_VERSION = '2026-10-21';
/** The per-job cost ceiling on output (architecture section 6). A long recipe uses ~3,000. */
const MAX_OUTPUT_TOKENS = 8_000;
/** Models that accept server-side fallback on a refusal. */
const FALLBACK_MODELS = new Set(['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-fable-5-2']);

export interface AnthropicOptions {
  apiKey: string;
  /** From the AI_MODEL secret; Claude Opus 5.5 unless the product owner picks another. */
  model?: string;
  /** `low` keeps parsing fast and cheap; raise it only if the evaluation set shows a gain. */
  effort?: 'low' | 'medium' | 'high';
  fetch?: typeof fetch;
}

function toBlock(part: ContentPart) {
  return part.type === 'text'
    ? { type: 'text', text: part.text }
    : { type: 'image', source: { type: 'base64', media_type: part.mediaType, data: part.base64 } };
}

export function createAnthropicProvider(options: AnthropicOptions): AiProvider {
  const model = options.model ?? ANTHROPIC_DEFAULT_MODEL;
  const doFetch = options.fetch ?? fetch;
  const fallback = FALLBACK_MODELS.has(model);

  return {
    name: 'anthropic',
    async generate(request: ModelRequest): Promise<ModelResponse> {
      const headers: Record<string, string> = {
        'content-type': 'application/json',
        'x-api-key': options.apiKey,
        'anthropic-version': API_VERSION,
      };
      if (fallback) headers['anthropic-beta'] = 'server-side-fallback-2026-07-01';
      const body = {
        model,
        max_tokens: MAX_OUTPUT_TOKENS,
        system: request.system,
        messages: [{ role: 'user', content: request.content.map(toBlock) }],
        output_config: {
          effort: options.effort ?? 'low',
          format: { type: 'json_schema', schema: request.schema },
        },
        ...(fallback ? { fallbacks: 'default' } : {}),
      };

      let response: Response;
      try {
        response = await doFetch(API_URL, {
          method: 'POST',
          headers,
          body: JSON.stringify(body),
          signal: request.signal,
        });
      } catch {
        throw new ProviderError(true);
      }
      if (response.status === 401 || response.status === 403) {
        // A missing or revoked key: retrying won't help, and the import isn't counted.
        throw new ProviderError(false, 'import.parser_unavailable');
      }
      if (response.status === 429 || response.status >= 500) throw new ProviderError(true);
      if (!response.ok) throw new ProviderError(false);

      const message = (await response.json()) as {
        model?: string;
        stop_reason?: string;
        content?: { type: string; text?: string }[];
        usage?: { input_tokens?: number; output_tokens?: number };
      };
      const costUnits = (message.usage?.input_tokens ?? 0) + (message.usage?.output_tokens ?? 0);
      if (message.stop_reason === 'refusal') throw new ProviderError(false);
      const text = message.content?.find((block) => block.type === 'text')?.text;
      let output: unknown = null;
      if (message.stop_reason !== 'max_tokens' && text) {
        try {
          output = JSON.parse(text);
        } catch {
          output = null;
        }
      }
      return { output, model: message.model ?? model, costUnits };
    },
  };
}
