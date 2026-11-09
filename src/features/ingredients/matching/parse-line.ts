import { UNITS, type Region, type UnitId } from '@/i18n';

import type { NameIndex } from './name-index';
import { normalize } from './normalize';
import { SCORE, searchIngredients } from './search';
import { unitLookup, type ParsedUnitId, type ParserVocabulary } from './vocabulary';

/**
 * How sure the match is:
 * - `exact`: the whole ingredient text is a name, plural or synonym.
 * - `partial`: a name was found inside it, such as "onions" in "large red-ish onions".
 * - `search`: only a fuzzy search matched, so the line needs review (FR-AI-5).
 * - `none`: nothing matched.
 */
export type MatchQuality = 'exact' | 'partial' | 'search' | 'none';

export type ParsedLine = {
  raw: string;
  /** The amount as written, or the top of a range ("2 to 3" is 3). */
  quantity: number | null;
  /** The bottom of a range, when the line gave one. */
  quantityFrom: number | null;
  unitId: ParsedUnitId | null;
  /**
   * quantity × the unit's factor, in g, ml or each (R-ING-3). Null with no amount, for a
   * pinch or a dash, and for an amount with no unit on an ingredient that isn't counted.
   */
  quantityBase: number | null;
  ingredientId: string | null;
  match: MatchQuality;
  /** Text in brackets and after the first comma, such as "finely chopped". */
  notes: string[];
};

export type ParseOptions = { index: NameIndex; vocabulary: ParserVocabulary; region: Region };

const VULGAR_FRACTIONS: Record<string, string> = {
  '½': '1/2',
  '⅓': '1/3',
  '⅔': '2/3',
  '¼': '1/4',
  '¾': '3/4',
  '⅕': '1/5',
  '⅛': '1/8',
  '⅜': '3/8',
  '⅝': '5/8',
  '⅞': '7/8',
};

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Spaces out fractions, ranges and units glued to numbers: "1½" and "200g" become "1 1/2" and "200 g". */
function prepare(text: string): string {
  return text
    .replace(/[½⅓⅔¼¾⅕⅛⅜⅝⅞]/g, (c) => ` ${VULGAR_FRACTIONS[c]} `)
    .replace(/\u2044/g, '/')
    .replace(/[\u2012-\u2015]/g, '-')
    .replace(/(\d)-(\d+\/\d+)/g, '$1 $2')
    .replace(/(\d)\s*-\s*(\d)/g, '$1 - $2')
    .replace(/(\d)([^\d\s.,/-])/g, '$1 $2')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Splits off notes: anything in brackets, and anything after the first comma. */
function splitNotes(text: string, decimalSeparator: string): { head: string; notes: string[] } {
  const notes: string[] = [];
  let head = text.replace(/\(([^)]*)\)|\[([^\]]*)\]/g, (_, round?: string, square?: string) => {
    const note = (round ?? square ?? '').trim();
    if (note) notes.push(note);
    return ' ';
  });
  // With a decimal comma, only a comma followed by a space ends the ingredient.
  const comma = decimalSeparator === ',' ? /,\s|;/ : /[,;]/;
  const at = head.search(comma);
  if (at >= 0) {
    const tail = head.slice(at + 1).trim();
    if (tail) notes.push(tail);
    head = head.slice(0, at);
  }
  return { head: head.replace(/\s+/g, ' ').trim(), notes };
}

type Read<T> = { value: T; next: number } | null;

function readNumber(words: string[], at: number, vocabulary: ParserVocabulary): Read<number> {
  const word = words[at];
  if (word === undefined) return null;
  const decimal = new RegExp(`^\\d+(?:${escape(vocabulary.decimalSeparator)}\\d+)?$`);
  const fraction = /^(\d+)\/(\d+)$/;
  const asFraction = (w: string | undefined) => {
    const m = w?.match(fraction);
    return m && Number(m[2]) > 0 ? Number(m[1]) / Number(m[2]) : null;
  };
  if (/^\d+$/.test(word)) {
    const part = asFraction(words[at + 1]);
    if (part !== null) return { value: Number(word) + part, next: at + 2 };
  }
  const part = asFraction(word);
  if (part !== null) return { value: part, next: at + 1 };
  if (decimal.test(word)) {
    return { value: Number(word.replace(vocabulary.decimalSeparator, '.')), next: at + 1 };
  }
  // Number words, longest first: "half a" before "half".
  for (let n = 2; n >= 1; n--) {
    const phrase = normalize(words.slice(at, at + n).join(' '));
    if (words.length >= at + n && phrase in vocabulary.numbers) {
      return { value: vocabulary.numbers[phrase], next: at + n };
    }
  }
  return null;
}

function readQuantity(
  words: string[],
  vocabulary: ParserVocabulary,
): Read<{ quantity: number; from: number | null }> {
  const first = readNumber(words, 0, vocabulary);
  if (!first) return null;
  const joiner = words[first.next];
  if (joiner === '-' || (joiner && vocabulary.rangeWords.includes(normalize(joiner)))) {
    const second = readNumber(words, first.next + 1, vocabulary);
    // A range's top is what to buy for (PROPOSED).
    if (second && second.value > first.value) {
      return { value: { quantity: second.value, from: first.value }, next: second.next };
    }
  }
  return { value: { quantity: first.value, from: null }, next: first.next };
}

/** The ingredient named by words, trying the whole text, then the longest piece inside it. */
function findIngredient(
  words: string[],
  index: NameIndex,
  vocabulary: ParserVocabulary,
): { id: string; match: MatchQuality } | null {
  const lookup = (key: string) => {
    const ids = index.exact.get(key);
    if (ids) return ids[0];
    // Fall back to a singular form of the last word: "zucchinis" to "zucchini".
    const last = key.lastIndexOf(' ') + 1;
    for (const ending of vocabulary.pluralEndings) {
      if (key.endsWith(ending) && key.length - last > ending.length + 2) {
        const singular = index.exact.get(key.slice(0, -ending.length));
        if (singular) return singular[0];
      }
    }
    return null;
  };
  const longest = Math.min(index.maxWords, words.length);
  for (let n = longest; n >= 1; n--) {
    // Rightmost first: an English ingredient's main word comes last ("salted butter").
    for (let start = words.length - n; start >= 0; start--) {
      const id = lookup(words.slice(start, start + n).join(' '));
      if (id) return { id, match: n === words.length ? 'exact' : 'partial' };
    }
  }
  const [hit] = searchIngredients(index, words.join(' '), { limit: 1, minScore: SCORE.fuzzy });
  return hit ? { id: hit.ingredientId, match: 'search' } : null;
}

/**
 * Turns a free-text line such as "1½ cups whole milk, warm" into an ingredient ID, a
 * quantity and a unit, using the household's region for unit sizes ("1 tbsp" is 20 ml in
 * Australia). Ingredient words are matched only through the locale's own name index, and
 * the result carries IDs only (R-ING-6, FR-REC-5).
 */
export function parseIngredientLine(
  text: string,
  { index, vocabulary, region }: ParseOptions,
): ParsedLine {
  const raw = text.trim();
  const { head, notes } = splitNotes(prepare(raw), vocabulary.decimalSeparator);
  const rawWords = head ? head.split(' ') : [];

  const quantityRead = readQuantity(rawWords, vocabulary);
  let at = quantityRead?.next ?? 0;
  const quantity = quantityRead?.value.quantity ?? null;

  // The unit, unless the rest is itself an ingredient name ("head of garlic").
  const units = unitLookup(vocabulary, region);
  const restIsIngredient = index.exact.has(normalize(rawWords.slice(at).join(' ')));
  let unitId: ParsedUnitId | null = null;
  if (!restIsIngredient) {
    const sensitive = units.caseSensitive.get(rawWords[at]?.replace(/\.$/, '') ?? '');
    if (sensitive && quantity !== null) {
      unitId = sensitive;
      at += 1;
    } else {
      for (let n = Math.min(units.maxWords, rawWords.length - at); n >= 1; n--) {
        const id = units.folded.get(normalize(rawWords.slice(at, at + n).join(' ')));
        // Without an amount, only "a pinch" and "a dash" make sense ("pinch of salt").
        if (id && (quantity !== null || !(id in UNITS))) {
          unitId = id;
          at += n;
          break;
        }
      }
    }
  }
  while (rawWords[at] && vocabulary.joiners.includes(normalize(rawWords[at]))) at += 1;

  const words = normalize(rawWords.slice(at).join(' ')).split(' ').filter(Boolean);
  const found = words.length ? findIngredient(words, index, vocabulary) : null;
  const ingredientId = found?.id ?? null;

  // No unit: a count if the ingredient is counted ("2 onions"), otherwise "to taste" (FR-REC-6).
  if (unitId === null && quantity !== null && ingredientId) {
    if (index.info.get(ingredientId)?.defaultDimension === 'count') unitId = 'unit.each';
  }
  const measured = unitId !== null && unitId in UNITS;
  const quantityBase =
    quantity !== null && measured ? quantity * UNITS[unitId as UnitId].toBase : null;

  return {
    raw,
    quantity,
    quantityFrom: quantityRead?.value.from ?? null,
    unitId,
    quantityBase,
    ingredientId,
    match: found?.match ?? 'none',
    notes,
  };
}
