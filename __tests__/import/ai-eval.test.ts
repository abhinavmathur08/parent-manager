import { fakeEvalOptions, FIXTURES } from '../../ai-eval/fake';
import { failedThresholds, runEval } from '../../ai-eval/run';

// The AI import evaluation with the fake provider (R-05.4, spec AI-21 to AI-23). It runs on
// every CI build, so changes to the prompt, schema, extraction or matching code are scored.
// The stored report (ai-eval/results/fake.json) must match, so score changes show up in the
// diff: run `AI_EVAL_WRITE=1 pnpm test __tests__/import/ai-eval` to update it.
const STORED = `${process.cwd()}/ai-eval/results/fake.json`;
// The app's TypeScript config has no Node types, so load fs untyped.
const fs = jest.requireActual<{
  readFileSync(path: string, encoding: 'utf8'): string;
  writeFileSync(path: string, text: string): void;
}>('fs');

describe('AI import evaluation (fake provider)', () => {
  it('has at least 20 fixtures per region, mixing input types (AI-21)', () => {
    for (const region of ['US', 'GB', 'AU']) {
      const own = FIXTURES.filter((f) => f.region === region);
      expect(own.length).toBeGreaterThanOrEqual(20);
      expect(new Set(own.map((f) => f.input))).toEqual(
        new Set(['text', 'link', 'link_structured', 'screenshot', 'photo']),
      );
    }
  });

  it('meets the AI-22 thresholds and matches the stored report', async () => {
    const report = await runEval(FIXTURES, { ...fakeEvalOptions(), now: () => 0 });
    if (process.env.AI_EVAL_WRITE === '1') {
      fs.writeFileSync(STORED, `${JSON.stringify(report, null, 2)}\n`);
    }
    expect(failedThresholds(report, false)).toEqual([]);
    expect(report).toEqual(JSON.parse(fs.readFileSync(STORED, 'utf8')));
  });
});
