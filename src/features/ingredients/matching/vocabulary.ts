import {
  i18n,
  REGIONAL_UNITS,
  UNITS,
  UNMEASURED_UNITS,
  type AppLocale,
  type Region,
  type UnitId,
  type UnmeasuredUnitId,
} from '@/i18n';

import { normalize } from './normalize';

/**
 * The words a language uses to write amounts, from the locale file's `ingredientParser`
 * block. A regional file overrides the whole block or none of it.
 *
 * Unit keys are either a word whose size depends on the region (tsp, tbsp, cup, floz,
 * pint) or the rest of a unit ID (`cup_us` means `unit.cup_us`). `each` covers containers
 * and pieces such as "can" and "clove".
 */
export type ParserVocabulary = {
  units: Record<string, readonly string[]>;
  caseSensitiveUnits: Record<string, readonly string[]>;
  numbers: Record<string, number>;
  rangeWords: readonly string[];
  joiners: readonly string[];
  pluralEndings: readonly string[];
  decimalSeparator: string;
};

export type ParsedUnitId = UnitId | UnmeasuredUnitId;

export function loadParserVocabulary(locale: AppLocale): ParserVocabulary {
  const block = i18n.getFixedT(locale)('ingredientParser', {
    returnObjects: true,
    postProcess: [],
  }) as unknown as Omit<ParserVocabulary, 'decimalSeparator'>;
  const decimalSeparator =
    new Intl.NumberFormat(locale).formatToParts(1.5).find((p) => p.type === 'decimal')?.value ??
    '.';
  return { ...block, decimalSeparator };
}

const isUnitId = (id: string): id is ParsedUnitId =>
  id in UNITS || (UNMEASURED_UNITS as readonly string[]).includes(id);

/** Resolves a vocabulary key to a unit ID for the household's region (R-ING-2). */
export function resolveUnitKey(key: string, region: Region): ParsedUnitId | null {
  if (key in REGIONAL_UNITS) return REGIONAL_UNITS[key as keyof typeof REGIONAL_UNITS][region];
  const id = `unit.${key}`;
  return isUnitId(id) ? id : null;
}

export type UnitLookup = {
  folded: Map<string, ParsedUnitId>;
  caseSensitive: Map<string, ParsedUnitId>;
  maxWords: number;
};

const lookups = new WeakMap<ParserVocabulary, Partial<Record<Region, UnitLookup>>>();

/** The vocabulary's unit words, resolved for a region and cached. */
export function unitLookup(vocabulary: ParserVocabulary, region: Region): UnitLookup {
  const cached = lookups.get(vocabulary) ?? {};
  const hit = cached[region];
  if (hit) return hit;
  const folded = new Map<string, ParsedUnitId>();
  const caseSensitive = new Map<string, ParsedUnitId>();
  let maxWords = 1;
  for (const [key, words] of Object.entries(vocabulary.units)) {
    const id = resolveUnitKey(key, region);
    if (!id) continue;
    for (const word of words) {
      const alias = normalize(word);
      folded.set(alias, id);
      maxWords = Math.max(maxWords, alias.split(' ').length);
    }
  }
  for (const [key, words] of Object.entries(vocabulary.caseSensitiveUnits)) {
    const id = resolveUnitKey(key, region);
    if (id) words.forEach((w) => caseSensitive.set(w, id));
  }
  const lookup = { folded, caseSensitive, maxWords };
  lookups.set(vocabulary, { ...cached, [region]: lookup });
  return lookup;
}
