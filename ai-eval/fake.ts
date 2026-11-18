import { createFakeProvider } from '../supabase/functions/import-recipe/ai/fake';
import type { EvalOptions, Fixture } from './run';

// The app's TypeScript config has no Node types, so load fs untyped.
const fs = jest.requireActual<{
  readFileSync(path: string): { toString(encoding: 'base64'): string };
}>('fs');

export const FIXTURES: Fixture[] = require('./fixtures.json').recipes;

export const readImage = (file: string) =>
  fs.readFileSync(`${process.cwd()}/ai-eval/images/${file}`).toString('base64');

/**
 * The fake provider can't read images, so for the evaluation it "reads" each fixture image
 * from its transcript. Real providers get the image itself.
 */
export function fakeEvalOptions(): EvalOptions {
  const transcripts = new Map(
    FIXTURES.filter((f) => f.image).map((f) => [readImage(f.image!), f.transcript ?? null]),
  );
  return {
    provider: createFakeProvider({ transcribe: ({ base64 }) => transcripts.get(base64) ?? null }),
    readImage,
  };
}
