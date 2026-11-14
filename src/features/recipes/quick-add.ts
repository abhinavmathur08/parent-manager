import {
  normalize,
  parseIngredientLine,
  type ParseOptions,
  type ParserVocabulary,
} from '@/features/ingredients/matching';
import { unitLookup } from '@/features/ingredients/matching/vocabulary';
import type { Region } from '@/i18n';

import type { DraftLine } from './draft';
import type { LineUnitId } from './units';

const AMOUNT = /^[\d½⅓⅔¼¾⅛/.,⁄-]+$/;

/** The words after the amount and unit: "2 tbsp za'atar" gives "za'atar". */
export function ingredientWords(
  text: string,
  vocabulary: ParserVocabulary,
  region: Region,
): string {
  const words = text.trim().split(/\s+/);
  let at = 0;
  while (at < words.length && AMOUNT.test(words[at])) at += 1;
  const units = unitLookup(vocabulary, region);
  for (let n = Math.min(units.maxWords, words.length - at); n >= 1; n--) {
    if (units.folded.has(normalize(words.slice(at, at + n).join(' ')))) {
      at += n;
      break;
    }
  }
  while (at < words.length && vocabulary.joiners.includes(normalize(words[at]))) at += 1;
  return words.slice(at).join(' ').split(',')[0].trim();
}

/**
 * Turns a typed line into a draft line (FR-REC-5). A line whose ingredient is found by name
 * goes straight in; anything less certain opens the line sheet, prefilled, so the household
 * picks the ingredient or adds it as new.
 */
export function quickAddLine(
  text: string,
  options: ParseOptions,
  id: string,
): { line: DraftLine; confident: boolean; searchText: string } {
  const parsed = parseIngredientLine(text, options);
  const confident =
    parsed.ingredientId !== null && (parsed.match === 'exact' || parsed.match === 'partial');
  return {
    line: {
      id,
      ingredientId: parsed.ingredientId ?? '',
      quantity: parsed.quantity,
      unitId: parsed.unitId as LineUnitId | null,
      rawText: parsed.raw,
      note: parsed.notes.join(', ') || null,
      optional: false,
    },
    confident,
    searchText: confident ? '' : ingredientWords(text, options.vocabulary, options.region),
  };
}
