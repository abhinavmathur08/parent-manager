/**
 * Folds text for matching, so case, accents and punctuation don't count: "Crème Fraîche"
 * and "creme fraiche" both become "creme fraiche". scripts/catalog-seed.js uses the same
 * rules to refuse catalog words that would name two ingredients.
 */
export function normalize(text: string): string {
  return text
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/['\u2019]/g, '')
    .replace(/[^a-z0-9%]+/g, ' ')
    .trim();
}
