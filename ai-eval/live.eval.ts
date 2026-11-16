import type { AiProvider } from '../supabase/functions/import-recipe/ai/ai_parser';
import { createAnthropicProvider } from '../supabase/functions/import-recipe/ai/anthropic';
import { fakeEvalOptions, FIXTURES, readImage } from './fake';
import { nodeFetch } from './node-fetch';
import { failedThresholds, runEval } from './run';

// Runs the evaluation set against the provider named by AI_EVAL_PROVIDER and writes the
// report to ai-eval/results/<provider>-<model>.json for comparison (AI-23). The key is read
// from the environment and never written anywhere.
jest.setTimeout(60 * 60 * 1000);
const fs = jest.requireActual<{ writeFileSync(path: string, text: string): void }>('fs');

function provider(): { provider: AiProvider; real: boolean } {
  const name = process.env.AI_EVAL_PROVIDER ?? 'fake';
  if (name === 'fake') return { provider: fakeEvalOptions().provider, real: false };
  if (name === 'anthropic') {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) throw new Error('Set ANTHROPIC_API_KEY to evaluate Claude.');
    return {
      provider: createAnthropicProvider({
        apiKey,
        model: process.env.AI_MODEL || undefined,
        fetch: nodeFetch,
      }),
      real: true,
    };
  }
  throw new Error(`Unknown AI_EVAL_PROVIDER "${name}"`);
}

test('AI import evaluation against a provider', async () => {
  const { provider: chosen, real } = provider();
  const only = process.env.AI_EVAL_ONLY; // for example "us-0" for a quick sample
  const fixtures = only ? FIXTURES.filter((f) => f.id.startsWith(only)) : FIXTURES;
  const report = await runEval(fixtures, { provider: chosen, readImage });
  const file = `${chosen.name}-${(report.model ?? 'none').replace(/[^a-z0-9.-]/gi, '_')}.json`;
  fs.writeFileSync(
    `${process.cwd()}/ai-eval/results/${file}`,
    `${JSON.stringify({ ranAt: new Date().toISOString(), fixtures: fixtures.length, ...report }, null, 2)}\n`,
  );
  console.log(`Wrote ai-eval/results/${file}\n${JSON.stringify(report.overall, null, 2)}`);
  expect(failedThresholds(report, real)).toEqual([]);
});
