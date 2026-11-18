// A deterministic stand-in for a model, for tests, CI, local development and E2E (decision
// D-7 isn't made yet). It reads the source with simple rules and answers in the same JSON
// shape a real provider returns, so everything after the provider runs for real: checking,
// retries, normalization on the device, review and save.
//
// It must never run for real users: index.ts only allows it against a local stack.

import type { AiProvider, ModelResponse } from './ai_parser.ts';
import { type ContentPart, type ModelRequest, sourceText } from './prompt.ts';
import type { Region } from '../types.ts';
import { REGIONAL_UNITS, type UnitId } from '../vocabulary.ts';

export const FAKE_MODEL = 'fake-parser-1';

/** What the fake "sees" in an image. Tests pass their own; the default is a fixed recipe. */
export type Transcriber = (image: { base64: string }) => string | null;

export const FAKE_IMAGE_RECIPE = [
  'Tomato pasta',
  'Serves 4',
  'Ingredients',
  '400 g spaghetti',
  '2 tbsp olive oil',
  '1 onion, chopped',
  '1 tin chopped tomatoes',
  'Method',
  'Cook the pasta.',
  'Fry the onion in the oil, add the tomatoes and simmer.',
  'Toss with the pasta.',
].join('\n');

const UNIT_WORDS: Record<string, UnitId | keyof typeof REGIONAL_UNITS> = {
  g: 'unit.g',
  gram: 'unit.g',
  grams: 'unit.g',
  kg: 'unit.kg',
  ml: 'unit.ml',
  l: 'unit.l',
  litre: 'unit.l',
  litres: 'unit.l',
  liter: 'unit.l',
  liters: 'unit.l',
  oz: 'unit.oz',
  ounce: 'unit.oz',
  ounces: 'unit.oz',
  lb: 'unit.lb',
  lbs: 'unit.lb',
  pound: 'unit.lb',
  pounds: 'unit.lb',
  pinch: 'unit.pinch',
  dash: 'unit.dash',
  tsp: 'tsp',
  teaspoon: 'tsp',
  teaspoons: 'tsp',
  tbsp: 'tbsp',
  tbs: 'tbsp',
  tablespoon: 'tbsp',
  tablespoons: 'tbsp',
  cup: 'cup',
  cups: 'cup',
  pint: 'pint',
  pints: 'pint',
};

const FRACTIONS: Record<string, number> = {
  '½': 0.5,
  '⅓': 1 / 3,
  '⅔': 2 / 3,
  '¼': 0.25,
  '¾': 0.75,
};
const HEADING = /^(ingredients|method|instructions|directions|steps|preparation)\b:?\s*$/i;
const STEP_HEADING = /^(method|instructions|directions|steps|preparation)\b/i;
const AMOUNT =
  /^(\d+(?:[.,]\d+)?(?:\s+\d+\/\d+)?|\d+\/\d+|[½⅓⅔¼¾]|\d+[½⅓⅔¼¾])(?:\s*(?:-|to)\s*(\d+(?:[.,]\d+)?))?/;

function amount(text: string): number | null {
  let total = 0;
  for (const part of text.trim().split(/\s+/)) {
    const glued = /^(\d+)([½⅓⅔¼¾])$/.exec(part);
    if (glued) total += Number(glued[1]) + FRACTIONS[glued[2]];
    else if (part in FRACTIONS) total += FRACTIONS[part];
    else if (part.includes('/')) {
      const [a, b] = part.split('/').map(Number);
      if (!b) return null;
      total += a / b;
    } else total += Number(part.replace(',', '.'));
  }
  return Number.isFinite(total) && total > 0 ? Math.round(total * 1000) / 1000 : null;
}

function fakeLine(original: string, region: Region) {
  let rest = original.replace(/^[-•*]\s*/, '').trim();
  let quantity: number | null = null;
  let unitId: UnitId | null = null;
  const match = AMOUNT.exec(rest);
  if (match) {
    quantity = amount(match[2] ?? match[1]);
    rest = rest.slice(match[0].length).trim();
    const word = /^([a-zA-Z]+)\.?\b/.exec(rest);
    const unit = word ? UNIT_WORDS[word[1].toLowerCase()] : undefined;
    if (unit) {
      unitId = unit.startsWith('unit.')
        ? (unit as UnitId)
        : REGIONAL_UNITS[unit as keyof typeof REGIONAL_UNITS][region];
      rest = rest
        .slice(word![0].length)
        .trim()
        .replace(/^of\s+/i, '');
    } else {
      unitId = 'unit.each';
    }
  } else {
    const word = /^(a\s+)?(pinch|dash)\s+of\s+/i.exec(rest);
    if (word) {
      unitId = UNIT_WORDS[word[2].toLowerCase()] as UnitId;
      rest = rest.slice(word[0].length);
    }
  }
  const notes: string[] = [];
  rest = rest.replace(/\(([^)]*)\)/g, (_, inner: string) => {
    if (inner.trim()) notes.push(inner.trim());
    return ' ';
  });
  const comma = rest.indexOf(',');
  if (comma >= 0) {
    notes.push(rest.slice(comma + 1).trim());
    rest = rest.slice(0, comma);
  }
  const name = rest.replace(/\s+/g, ' ').trim() || null;
  return {
    original,
    quantity,
    unitId,
    ingredientName: name,
    note: notes.filter(Boolean).join(', ') || null,
    confidence: name && (quantity !== null || unitId) ? 0.9 : 0.6,
    inferred: false,
  };
}

function minutes(text: string, label: RegExp): number | null {
  const match = new RegExp(`${label.source}[^0-9]*(\\d+)\\s*(h|hours?|m|mins?|minutes?)`, 'i').exec(
    text,
  );
  if (!match) return null;
  return /^h/i.test(match[2]) ? Number(match[1]) * 60 : Number(match[1]);
}

/** The fake's whole "model": rules over the text, in the provider's JSON shape. */
export function fakeParse(text: string, region: Region): Record<string, unknown> {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  const meta = lines.join('\n');
  let section: 'head' | 'ingredients' | 'steps' = 'head';
  let title: string | null = null;
  const ingredients = [];
  const steps: string[] = [];
  for (const l of lines) {
    if (HEADING.test(l)) {
      section = STEP_HEADING.test(l) ? 'steps' : 'ingredients';
      continue;
    }
    if (section === 'head') {
      if (!title && !/^(serves|servings|makes|prep|cook|total)\b/i.test(l)) title = l;
    } else if (section === 'ingredients') {
      ingredients.push(fakeLine(l, region));
    } else {
      steps.push(l.replace(/^\d+[.)]\s*/, ''));
    }
  }
  const serves = /\b(?:serves|servings:?|makes)\s*(\d+)/i.exec(meta);
  const isRecipe = ingredients.length > 0 || steps.length > 0;
  return {
    isRecipe,
    title: isRecipe ? title : null,
    servings: serves ? Number(serves[1]) : null,
    prepMinutes: minutes(meta, /prep(?:aration)?(?: time)?/),
    cookMinutes: minutes(meta, /cook(?:ing)?(?: time)?/),
    ingredients,
    steps,
    tags: /\bfreez(e|es|er)\b/i.test(meta) ? ['tag.freezer_friendly'] : [],
    allergens: /\b(contains|may contain)\b[^.\n]*\bnuts?\b/i.test(meta)
      ? ['allergen.tree_nut']
      : [],
  };
}

function regionOf(content: ContentPart[]): Region {
  const first = content.find((p) => p.type === 'text');
  const match = first?.type === 'text' ? /Region: (US|GB|AU)\./.exec(first.text) : null;
  return (match?.[1] as Region | undefined) ?? 'US';
}

export function createFakeProvider(options: { transcribe?: Transcriber } = {}): AiProvider {
  const transcribe = options.transcribe ?? (() => FAKE_IMAGE_RECIPE);
  return {
    name: 'fake',
    generate(request: ModelRequest): Promise<ModelResponse> {
      const image = request.content.find((p) => p.type === 'image');
      const text = image?.type === 'image' ? transcribe(image) : sourceText(request.content);
      const output =
        text === null ? { isRecipe: false } : fakeParse(text, regionOf(request.content));
      return Promise.resolve({ output, model: FAKE_MODEL, costUnits: 0 });
    },
  };
}
