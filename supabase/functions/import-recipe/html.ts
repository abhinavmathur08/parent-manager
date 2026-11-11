// Turning untrusted HTML into data: embedded schema.org Recipe data first (spec AI-17),
// otherwise the page's readable text for the parser. Nothing here runs page code, and
// everything taken from a page is capped in size.

import type { DraftIngredientLine, RecipeDraft } from './types.ts';

const MAX_TITLE_CHARS = 200;
const MAX_LINE_CHARS = 500;
const MAX_STEP_CHARS = 2_000;
const MAX_LINES = 100;
const MAX_STEPS = 100;
const MAX_JSON_LD_BLOCKS = 20;

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  frac12: '½',
  frac14: '¼',
  frac34: '¾',
  deg: '°',
  ndash: '–',
  mdash: '—',
  hellip: '…',
  rsquo: '’',
  lsquo: '‘',
  rdquo: '”',
  ldquo: '“',
};

/** Decodes the HTML entities recipe pages commonly use. Unknown ones are left as they are. */
export function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z][a-z0-9]*);/gi, (match, entity: string) => {
    if (entity[0] === '#') {
      const code =
        entity[1] === 'x' || entity[1] === 'X'
          ? parseInt(entity.slice(2), 16)
          : parseInt(entity.slice(1), 10);
      return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : match;
    }
    return NAMED_ENTITIES[entity.toLowerCase()] ?? match;
  });
}

/** Strips tags, decodes entities and collapses whitespace in one value from a page. */
function cleanText(value: string, maxChars: number): string {
  return decodeEntities(value.replace(/<[^>]*>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxChars);
}

// ---------------------------------------------------------------------------
// schema.org Recipe (JSON-LD)
// ---------------------------------------------------------------------------

/** The JSON-LD blocks on a page, parsed. Blocks that aren't valid JSON are skipped. */
function jsonLdBlocks(html: string): unknown[] {
  const blocks: unknown[] = [];
  const pattern =
    /<script\b[^>]*\btype\s*=\s*["']?application\/ld\+json["']?[^>]*>([\s\S]*?)<\/script\s*>/gi;
  for (const match of html.matchAll(pattern)) {
    if (blocks.length >= MAX_JSON_LD_BLOCKS) break;
    try {
      blocks.push(JSON.parse(match[1].trim()));
    } catch {
      // Ignore malformed blocks; another one may hold the recipe.
    }
  }
  return blocks;
}

function isRecipe(node: Record<string, unknown>): boolean {
  const type = node['@type'];
  const types = Array.isArray(type) ? type : [type];
  return types.some((t) => typeof t === 'string' && /^(https?:\/\/schema\.org\/)?Recipe$/.test(t));
}

/** Finds the first Recipe node, looking through arrays and @graph, a few levels deep. */
function findRecipe(node: unknown, depth = 0): Record<string, unknown> | null {
  if (depth > 5 || node === null || typeof node !== 'object') return null;
  if (Array.isArray(node)) {
    for (const item of node) {
      const found = findRecipe(item, depth + 1);
      if (found) return found;
    }
    return null;
  }
  const record = node as Record<string, unknown>;
  if (isRecipe(record)) return record;
  return findRecipe(record['@graph'], depth + 1) ?? findRecipe(record.mainEntity, depth + 1);
}

/** Minutes in an ISO 8601 duration such as PT1H30M, or null. */
export function durationMinutes(value: unknown): number | null {
  if (typeof value !== 'string') return null;
  const match = /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?)?$/i.exec(
    value.trim(),
  );
  if (!match || value.trim() === 'P' || /T$/i.test(value.trim())) return null;
  const [, days, hours, minutes, seconds] = match.map((part) => Number(part ?? 0));
  const total = days * 1440 + hours * 60 + minutes + Math.round(seconds / 60);
  return total > 0 && total < 100_000 ? total : null;
}

/** The serving count from recipeYield, such as 4, "4", "Serves 4" or ["4", "4 servings"]. */
export function servingsFrom(value: unknown): number | null {
  const values = Array.isArray(value) ? value : [value];
  for (const item of values) {
    if (typeof item === 'number' && Number.isFinite(item) && item > 0) return Math.round(item);
    if (typeof item === 'string') {
      const match = /\d+/.exec(item);
      if (match) {
        const count = Number(match[0]);
        if (count > 0 && count <= 1000) return count;
      }
    }
  }
  return null;
}

/** Steps from recipeInstructions: a string, strings, HowToStep or HowToSection nodes. */
function stepsFrom(value: unknown, depth = 0): string[] {
  if (depth > 4 || value === null || value === undefined) return [];
  if (typeof value === 'string') {
    // A single block of text: one step per line or paragraph.
    return value
      .split(/<br\s*\/?>|<\/p>|\n/i)
      .map((part) => cleanText(part, MAX_STEP_CHARS))
      .filter(Boolean);
  }
  if (Array.isArray(value)) return value.flatMap((item) => stepsFrom(item, depth + 1));
  if (typeof value === 'object') {
    const node = value as Record<string, unknown>;
    if (node.itemListElement !== undefined) return stepsFrom(node.itemListElement, depth + 1);
    const text = node.text ?? node.name;
    if (typeof text === 'string') {
      const step = cleanText(text, MAX_STEP_CHARS);
      return step ? [step] : [];
    }
  }
  return [];
}

/**
 * The line as written, for review and catalog matching. Quantity, unit and ingredient are
 * left for normalization (R-05.3), so the line starts at zero confidence and is highlighted.
 */
function lineFrom(original: string): DraftIngredientLine {
  return {
    original,
    quantity: null,
    unitId: null,
    ingredientName: null,
    note: null,
    confidence: 0,
  };
}

/**
 * The draft from a page's embedded schema.org Recipe, or null when there's none or it's
 * incomplete. Complete means a title, at least one ingredient and at least one step; a
 * page short of that goes to the parser instead (AI-17).
 */
export function recipeFromStructuredData(html: string): RecipeDraft | null {
  for (const block of jsonLdBlocks(html)) {
    const recipe = findRecipe(block);
    if (!recipe) continue;

    const title = typeof recipe.name === 'string' ? cleanText(recipe.name, MAX_TITLE_CHARS) : '';
    const rawLines = recipe.recipeIngredient ?? recipe.ingredients;
    const lines = (Array.isArray(rawLines) ? rawLines : [])
      .filter((line): line is string => typeof line === 'string')
      .map((line) => cleanText(line, MAX_LINE_CHARS))
      .filter(Boolean)
      .slice(0, MAX_LINES);
    const steps = stepsFrom(recipe.recipeInstructions).slice(0, MAX_STEPS);

    if (!title || lines.length === 0 || steps.length === 0) continue;
    return {
      title,
      servings: servingsFrom(recipe.recipeYield),
      prepMinutes: durationMinutes(recipe.prepTime),
      cookMinutes: durationMinutes(recipe.cookTime),
      ingredients: lines.map(lineFrom),
      steps,
      tags: [],
      allergens: [],
    };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Readable text
// ---------------------------------------------------------------------------

const DROPPED_ELEMENTS = [
  'script',
  'style',
  'noscript',
  'template',
  'svg',
  'iframe',
  'head',
  'nav',
  'header',
  'footer',
  'aside',
  'form',
];
const BLOCK_TAGS =
  /<\/?(p|div|br|li|ul|ol|h[1-6]|tr|td|th|table|section|article|main|blockquote|pre|dd|dt)\b[^>]*>/gi;

/**
 * The page's readable text, for the parser: page furniture and code removed, one block per
 * line, at most `maxChars`. The parser treats it as data, never instructions (AI-9).
 */
export function readableText(html: string, maxChars: number): string {
  let text = html.replace(/<!--[\s\S]*?-->/g, ' ');
  for (const tag of DROPPED_ELEMENTS) {
    text = text.replace(new RegExp(`<${tag}\\b[\\s\\S]*?<\\/${tag}\\s*>`, 'gi'), ' ');
  }
  text = text.replace(BLOCK_TAGS, '\n').replace(/<[^>]*>/g, ' ');
  return decodeEntities(text)
    .split('\n')
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .join('\n')
    .slice(0, maxChars);
}
