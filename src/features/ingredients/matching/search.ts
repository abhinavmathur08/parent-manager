import type { IndexedTerm, NameIndex } from './name-index';
import { normalize } from './normalize';

export type SearchResult = {
  ingredientId: string;
  /** The ingredient's name in the index's locale, for the picker to show. */
  displayName: string;
  /** The folded name, plural or synonym that matched. */
  matchedTerm: string;
  score: number;
};

/** How well a term answers the query, from 100 (exact) down to 0 (no match). */
export const SCORE = {
  exact: 100,
  prefix: 90,
  wordPrefix: 70,
  allWords: 60,
  contains: 40,
  fuzzy: 25,
} as const;

/** Levenshtein distance, giving up once it passes `max`. */
function distanceWithin(a: string, b: string, max: number): boolean {
  if (Math.abs(a.length - b.length) > max) return false;
  let previous = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const current = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      current[j] = Math.min(previous[j] + 1, current[j - 1] + 1, previous[j - 1] + cost);
      rowMin = Math.min(rowMin, current[j]);
    }
    if (rowMin > max) return false;
    previous = current;
  }
  return previous[b.length] <= max;
}

const typoAllowance = (word: string) => (word.length >= 8 ? 2 : word.length >= 4 ? 1 : 0);

function scoreTerm(term: IndexedTerm, query: string, queryWords: string[]): number {
  const { key, words } = term;
  if (key === query) return SCORE.exact;
  if (key.startsWith(query)) return SCORE.prefix;
  if (queryWords.length === 1 && words.some((w) => w.startsWith(query))) return SCORE.wordPrefix;
  if (queryWords.every((q) => words.some((w) => w.startsWith(q)))) return SCORE.allWords;
  if (key.includes(query)) return SCORE.contains;
  const fuzzy = queryWords.every((q) => {
    const allowed = typoAllowance(q);
    return (
      allowed > 0 &&
      words.some(
        (w) =>
          distanceWithin(q, w, allowed) ||
          // A typo in a word still being typed: compare with the same-length start.
          (w.length > q.length && distanceWithin(q, w.slice(0, q.length), allowed)),
      )
    );
  });
  return fuzzy ? SCORE.fuzzy : 0;
}

/**
 * Searches the locale's names and synonyms for a picker or a typed list item (FR-REC-5,
 * FR-LIST-6). Each ingredient appears once, at its best match. Results are ranked by score,
 * then household items, names before synonyms, shorter terms, and ID, never by display text.
 */
export function searchIngredients(
  index: NameIndex,
  text: string,
  { limit = 10, minScore = SCORE.fuzzy }: { limit?: number; minScore?: number } = {},
): SearchResult[] {
  const query = normalize(text);
  if (!query) return [];
  const queryWords = query.split(' ');
  const best = new Map<string, { term: IndexedTerm; score: number }>();
  for (const term of index.terms) {
    const score = scoreTerm(term, query, queryWords);
    if (score < minScore) continue;
    const current = best.get(term.ingredientId);
    // Terms are pre-sorted best first, so only a strictly higher score replaces a match.
    if (!current || score > current.score) best.set(term.ingredientId, { term, score });
  }
  return [...best.values()]
    .sort(
      (a, b) =>
        b.score - a.score ||
        Number(b.term.household) - Number(a.term.household) ||
        a.term.key.length - b.term.key.length ||
        (a.term.ingredientId < b.term.ingredientId ? -1 : 1),
    )
    .slice(0, limit)
    .map(({ term, score }) => ({
      ingredientId: term.ingredientId,
      displayName: index.displayName.get(term.ingredientId) ?? term.key,
      matchedTerm: term.key,
      score,
    }));
}
