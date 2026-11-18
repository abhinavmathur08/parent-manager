/**
 * The AI import evaluation (R-05.4, spec AI-21 to AI-23). It runs every fixture through the
 * same pipeline as a real import: link extraction (schema.org data first), the AI parser over
 * a provider, then normalization on the device. It scores the result against the hand-made
 * gold parse.
 *
 * CI runs it with the fake provider (__tests__/import/ai-eval.test.ts), so it needs no key.
 * `pnpm run eval:ai` runs it against a real provider; see ai-eval/README.md.
 */
import { catalogIngredient, catalogNames } from '@/features/ingredients/catalog';
import type { AllergenCode } from '@/features/ingredients/catalog-ids';
import { buildNameIndex, loadParserVocabulary, normalize } from '@/features/ingredients/matching';
import { normalizeDraft } from '@/features/import/normalize';
import type { ImportedDraft } from '@/features/import/types';
import { UNITS, type AppLocale, type Region } from '@/i18n';

import { type AiProvider, createAiParser } from '../supabase/functions/import-recipe/ai/ai_parser';
import { PROMPT_VERSION } from '../supabase/functions/import-recipe/ai/prompt';
import { readableText, recipeFromStructuredData } from '../supabase/functions/import-recipe/html';
import { ParserError } from '../supabase/functions/import-recipe/parser';
import type { ParseSource } from '../supabase/functions/import-recipe/types';

export type InputKind = 'text' | 'link' | 'link_structured' | 'screenshot' | 'photo';

export type GoldLine = {
  original: string;
  ingredientId: string;
  unitId: string | null;
  quantity: number | null;
};

export type Fixture = {
  id: string;
  region: Region;
  locale: AppLocale;
  input: InputKind;
  text?: string;
  html?: string;
  image?: string;
  transcript?: string;
  gold: { title: string; lines: GoldLine[] };
};

/** Spec AI-22 (PROPOSED). */
export const THRESHOLDS = {
  ingredientAccuracy: 0.9,
  unitAccuracy: 0.95,
  allergenRecall: 1,
  hallucinationRate: 0.01,
  medianLinkLatencyMs: 8_000,
} as const;

export type Scores = {
  recipes: number;
  failed: number;
  goldLines: number;
  ingredientAccuracy: number;
  linesWithQuantity: number;
  unitAccuracy: number;
  goldAllergens: number;
  allergenRecall: number;
  outputLines: number;
  hallucinationRate: number;
};

export type RecipeResult = {
  id: string;
  error?: string;
  latencyMs: number;
  /** Gold lines with no output line for them. */
  missing: string[];
  wrongIngredient: { original: string; expected: string; got: string | null }[];
  wrongUnit: {
    original: string;
    expected: [string | null, number | null];
    got: [string | null, number | null];
  }[];
  missedAllergens: string[];
  hallucinated: string[];
};

export type EvalReport = {
  provider: string;
  model: string | null;
  promptVersion: string;
  overall: Scores;
  byRegion: Record<string, Scores>;
  byInput: Record<string, Scores>;
  medianLinkLatencyMs: number | null;
  recipes: RecipeResult[];
};

const key = (text: string) => normalize(text.replace(/^[-•*]\s*/, ''));

function base(unitId: string | null, quantity: number | null): number | null {
  if (quantity === null || !unitId || !(unitId in UNITS)) return null;
  return quantity * UNITS[unitId as keyof typeof UNITS].toBase;
}

function allergensOf(ids: readonly string[]): Set<AllergenCode> {
  return new Set(ids.flatMap((id) => catalogIngredient(id)?.allergens ?? []));
}

type Tally = Omit<
  Scores,
  'ingredientAccuracy' | 'unitAccuracy' | 'allergenRecall' | 'hallucinationRate'
> & {
  ingredientsRight: number;
  unitsRight: number;
  allergensFound: number;
  hallucinated: number;
};

const emptyTally = (): Tally => ({
  recipes: 0,
  failed: 0,
  goldLines: 0,
  ingredientsRight: 0,
  linesWithQuantity: 0,
  unitsRight: 0,
  goldAllergens: 0,
  allergensFound: 0,
  outputLines: 0,
  hallucinated: 0,
});

const ratio = (a: number, b: number, empty: number) =>
  b === 0 ? empty : Math.round((a / b) * 10_000) / 10_000;

function scores(t: Tally): Scores {
  return {
    recipes: t.recipes,
    failed: t.failed,
    goldLines: t.goldLines,
    ingredientAccuracy: ratio(t.ingredientsRight, t.goldLines, 1),
    linesWithQuantity: t.linesWithQuantity,
    unitAccuracy: ratio(t.unitsRight, t.linesWithQuantity, 1),
    goldAllergens: t.goldAllergens,
    allergenRecall: ratio(t.allergensFound, t.goldAllergens, 1),
    outputLines: t.outputLines,
    hallucinationRate: ratio(t.hallucinated, t.outputLines, 0),
  };
}

export type EvalOptions = {
  provider: AiProvider;
  /** Reads a fixture image as base64. */
  readImage: (file: string) => string;
  now?: () => number;
};

/** Runs one fixture through extraction, parsing and normalization. */
async function importFixture(
  fixture: Fixture,
  options: EvalOptions,
): Promise<{ draft: ImportedDraft; sourceText: string; model: string | null }> {
  const parser = createAiParser(options.provider, { retryDelayMs: 1_000 });
  let source: ParseSource;
  let sourceText: string;
  if (fixture.input === 'link' || fixture.input === 'link_structured') {
    const html = fixture.html ?? '';
    const structured = recipeFromStructuredData(html);
    // Gold originals are in the page either way; the readable text holds the rest.
    sourceText = `${readableText(html, 20_000)}\n${fixture.gold.lines.map((l) => l.original).join('\n')}`;
    if (structured) return { draft: structured, sourceText, model: null };
    source = { kind: 'text', text: readableText(html, 20_000) };
  } else if (fixture.input === 'text') {
    sourceText = fixture.text ?? '';
    source = { kind: 'text', text: sourceText };
  } else {
    sourceText = fixture.transcript ?? '';
    source = { kind: 'image', mediaType: 'image/jpeg', base64: options.readImage(fixture.image!) };
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 45_000);
  try {
    const result = await parser.parse({
      source,
      locale: fixture.locale as 'en-US' | 'en-GB' | 'en-AU',
      region: fixture.region,
      signal: controller.signal,
    });
    return { draft: result.draft, sourceText, model: result.model };
  } finally {
    clearTimeout(timer);
  }
}

export async function runEval(
  fixtures: readonly Fixture[],
  options: EvalOptions,
): Promise<EvalReport> {
  const now = options.now ?? Date.now;
  const overall = emptyTally();
  const byRegion: Record<string, Tally> = {};
  const byInput: Record<string, Tally> = {};
  const linkLatencies: number[] = [];
  const recipes: RecipeResult[] = [];
  let model: string | null = null;
  const indexes = new Map<string, ReturnType<typeof buildNameIndex>>();

  for (const fixture of fixtures) {
    const tallies = [
      overall,
      (byRegion[fixture.region] ??= emptyTally()),
      (byInput[fixture.input] ??= emptyTally()),
    ];
    const add = (field: keyof Tally, n = 1) => tallies.forEach((t) => (t[field] += n));
    const result: RecipeResult = {
      id: fixture.id,
      latencyMs: 0,
      missing: [],
      wrongIngredient: [],
      wrongUnit: [],
      missedAllergens: [],
      hallucinated: [],
    };
    recipes.push(result);
    add('recipes');
    add('goldLines', fixture.gold.lines.length);
    add('linesWithQuantity', fixture.gold.lines.filter((l) => l.quantity !== null).length);
    const goldAllergens = allergensOf(fixture.gold.lines.map((l) => l.ingredientId));
    add('goldAllergens', goldAllergens.size);

    const started = now();
    let imported;
    try {
      imported = await importFixture(fixture, options);
    } catch (error) {
      result.error = error instanceof ParserError ? error.code : 'import.failed';
      result.latencyMs = now() - started;
      result.missing = fixture.gold.lines.map((l) => l.original);
      result.missedAllergens = [...goldAllergens];
      add('failed');
      continue;
    }
    result.latencyMs = now() - started;
    if (fixture.input.startsWith('link')) linkLatencies.push(result.latencyMs);
    model = imported.model ?? model;

    let index = indexes.get(fixture.locale);
    if (!index) {
      const input = catalogNames(fixture.locale);
      index = buildNameIndex(fixture.locale, input.ingredients, input.names);
      indexes.set(fixture.locale, index);
    }
    let n = 0;
    const review = normalizeDraft(imported.draft, {
      index,
      vocabulary: loadParserVocabulary(fixture.locale),
      region: fixture.region,
      newId: () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`,
    });
    const out = review.recipe.lines;
    add('outputLines', out.length);
    const source = key(imported.sourceText);
    for (const line of out) {
      if (!source.includes(key(line.rawText ?? ''))) {
        result.hallucinated.push(line.rawText ?? '');
        add('hallucinated');
      }
    }

    const used = new Set<number>();
    for (const gold of fixture.gold.lines) {
      const at = out.findIndex(
        (l, i) => !used.has(i) && key(l.rawText ?? '') === key(gold.original),
      );
      if (at < 0) {
        result.missing.push(gold.original);
        continue;
      }
      used.add(at);
      const line = out[at];
      if (line.ingredientId === gold.ingredientId) add('ingredientsRight');
      else
        result.wrongIngredient.push({
          original: gold.original,
          expected: gold.ingredientId,
          got: review.lines[line.id]?.unmatched ? null : line.ingredientId,
        });
      if (gold.quantity === null) continue;
      const want = gold.unitId === 'unit.each' ? gold.quantity : base(gold.unitId, gold.quantity);
      const got = line.unitId === 'unit.each' ? line.quantity : base(line.unitId, line.quantity);
      const close = want !== null && got !== null && Math.abs(got - want) <= Math.abs(want) * 0.02;
      if (line.unitId === gold.unitId && close) add('unitsRight');
      else
        result.wrongUnit.push({
          original: gold.original,
          expected: [gold.unitId, gold.quantity],
          got: [line.unitId, line.quantity],
        });
    }

    const found = allergensOf(out.map((l) => l.ingredientId));
    for (const code of review.sourceAllergens) found.add(code);
    for (const code of goldAllergens) {
      if (found.has(code)) add('allergensFound');
      else result.missedAllergens.push(code);
    }
  }

  const sorted = [...linkLatencies].sort((a, b) => a - b);
  return {
    provider: options.provider.name,
    model,
    promptVersion: PROMPT_VERSION,
    overall: scores(overall),
    byRegion: Object.fromEntries(Object.entries(byRegion).map(([k, t]) => [k, scores(t)])),
    byInput: Object.fromEntries(Object.entries(byInput).map(([k, t]) => [k, scores(t)])),
    medianLinkLatencyMs: sorted.length ? sorted[Math.floor((sorted.length - 1) / 2)] : null,
    recipes: recipes.filter(
      (r) =>
        r.error ||
        r.missing.length ||
        r.wrongIngredient.length ||
        r.wrongUnit.length ||
        r.missedAllergens.length ||
        r.hallucinated.length,
    ),
  };
}

/** Which AI-22 thresholds a report misses. Latency only counts for a real provider. */
export function failedThresholds(report: EvalReport, checkLatency: boolean): string[] {
  const failed: string[] = [];
  const o = report.overall;
  if (o.ingredientAccuracy < THRESHOLDS.ingredientAccuracy) failed.push('ingredientAccuracy');
  if (o.unitAccuracy < THRESHOLDS.unitAccuracy) failed.push('unitAccuracy');
  if (o.allergenRecall < THRESHOLDS.allergenRecall) failed.push('allergenRecall');
  if (o.hallucinationRate > THRESHOLDS.hallucinationRate) failed.push('hallucinationRate');
  if (
    checkLatency &&
    (report.medianLinkLatencyMs === null ||
      report.medianLinkLatencyMs > THRESHOLDS.medianLinkLatencyMs)
  ) {
    failed.push('medianLinkLatencyMs');
  }
  return failed;
}
