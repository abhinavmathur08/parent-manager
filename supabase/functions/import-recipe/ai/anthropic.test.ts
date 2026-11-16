import { assertEquals, assertRejects } from 'jsr:@std/assert@1';

import { ProviderError } from './ai_parser.ts';
import { createAnthropicProvider } from './anthropic.ts';
import { DRAFT_SCHEMA, type ModelRequest } from './prompt.ts';

const REQUEST: ModelRequest = {
  system: 'rules',
  content: [
    { type: 'text', text: 'Locale: en-US. Region: US.' },
    { type: 'image', mediaType: 'image/jpeg', base64: 'AAAA' },
  ],
  schema: DRAFT_SCHEMA,
  signal: new AbortController().signal,
};

function fakeFetch(
  status: number,
  body: unknown,
  calls: { url: string; init: RequestInit }[] = [],
) {
  return ((url: string, init: RequestInit) => {
    calls.push({ url, init });
    return Promise.resolve(new Response(JSON.stringify(body), { status }));
  }) as typeof fetch;
}

Deno.test('sends structured output, the image and the key, and reads the JSON reply', async () => {
  const calls: { url: string; init: RequestInit }[] = [];
  const provider = createAnthropicProvider({
    apiKey: 'test-key',
    fetch: fakeFetch(
      200,
      {
        model: 'claude-opus-5-5',
        stop_reason: 'end_turn',
        content: [{ type: 'text', text: '{"isRecipe":false}' }],
        usage: { input_tokens: 1200, output_tokens: 30 },
      },
      calls,
    ),
  });
  const response = await provider.generate(REQUEST);
  assertEquals(response, {
    output: { isRecipe: false },
    model: 'claude-opus-5-5',
    costUnits: 1230,
  });

  const { url, init } = calls[0];
  assertEquals(url, 'https://api.anthropic.com/v1/messages');
  const headers = init.headers as Record<string, string>;
  assertEquals(headers['x-api-key'], 'test-key');
  assertEquals(headers['anthropic-version'], '2026-10-21');
  const body = JSON.parse(init.body as string);
  assertEquals(body.model, 'claude-opus-5-5');
  assertEquals(body.system, 'rules');
  assertEquals(body.output_config.format, { type: 'json_schema', schema: DRAFT_SCHEMA });
  assertEquals(body.messages[0].content[1], {
    type: 'image',
    source: { type: 'base64', media_type: 'image/jpeg', data: 'AAAA' },
  });
});

Deno.test('rate limits and server errors are retryable; a bad key is not', async () => {
  for (const [status, retryable, code] of [
    [429, true, 'import.parse_failed'],
    [529, true, 'import.parse_failed'],
    [401, false, 'import.parser_unavailable'],
    [400, false, 'import.parse_failed'],
  ] as const) {
    const provider = createAnthropicProvider({ apiKey: 'k', fetch: fakeFetch(status, {}) });
    const error = await assertRejects(() => provider.generate(REQUEST), ProviderError);
    assertEquals([error.retryable, error.code], [retryable, code]);
  }
});

Deno.test('a truncated or non-JSON reply comes back as invalid output, to be retried', async () => {
  for (const reply of [
    { stop_reason: 'max_tokens', content: [{ type: 'text', text: '{"isRecipe":tr' }] },
    { stop_reason: 'end_turn', content: [{ type: 'text', text: 'not json' }] },
  ]) {
    const provider = createAnthropicProvider({ apiKey: 'k', fetch: fakeFetch(200, reply) });
    assertEquals((await provider.generate(REQUEST)).output, null);
  }
});

Deno.test('a refusal fails without a retry', async () => {
  const provider = createAnthropicProvider({
    apiKey: 'k',
    fetch: fakeFetch(200, { stop_reason: 'refusal', content: [] }),
  });
  const error = await assertRejects(() => provider.generate(REQUEST), ProviderError);
  assertEquals(error.retryable, false);
});
