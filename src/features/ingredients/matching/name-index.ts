import type { Dimension } from '@/i18n';

import { normalize } from './normalize';

/** An ingredient as the matcher needs it: catalog or household (R-ING-1). */
export type IngredientInfo = {
  id: string;
  defaultDimension: Dimension;
  /** Set for a household's own ingredient, null for the catalog. */
  householdId: string | null;
};

/** One row of `ingredient_names` for the index's locale. */
export type IngredientNames = {
  ingredientId: string;
  name: string;
  plural: string | null;
  synonyms: readonly string[];
};

type TermKind = 'name' | 'plural' | 'synonym';

export type IndexedTerm = {
  key: string;
  words: string[];
  ingredientId: string;
  kind: TermKind;
  /** Household items win ties, because the household named them on purpose. */
  household: boolean;
};

/**
 * The locale's own name index: every name, plural and synonym, folded for matching and
 * pointing at an ingredient ID. It's the only place display text is matched. Everything
 * after it compares IDs only (R-ING-6).
 */
export type NameIndex = {
  locale: string;
  terms: IndexedTerm[];
  /** Folded term to the IDs it names, best first. */
  exact: Map<string, string[]>;
  info: Map<string, IngredientInfo>;
  displayName: Map<string, string>;
  /** The longest term, in words, so the parser knows how far to look. */
  maxWords: number;
};

const KIND_ORDER: Record<TermKind, number> = { name: 0, plural: 1, synonym: 2 };

export function buildNameIndex(
  locale: string,
  ingredients: readonly IngredientInfo[],
  names: readonly IngredientNames[],
): NameIndex {
  const info = new Map(ingredients.map((i) => [i.id, i]));
  const terms: IndexedTerm[] = [];
  const displayName = new Map<string, string>();
  for (const row of names) {
    const ingredient = info.get(row.ingredientId);
    if (!ingredient) continue;
    displayName.set(row.ingredientId, row.name);
    const household = ingredient.householdId !== null;
    const add = (text: string | null, kind: TermKind) => {
      const key = text ? normalize(text) : '';
      if (key)
        terms.push({ key, words: key.split(' '), ingredientId: row.ingredientId, kind, household });
    };
    add(row.name, 'name');
    add(row.plural, 'plural');
    row.synonyms.forEach((s) => add(s, 'synonym'));
  }

  terms.sort(
    (a, b) =>
      Number(b.household) - Number(a.household) ||
      KIND_ORDER[a.kind] - KIND_ORDER[b.kind] ||
      (a.ingredientId < b.ingredientId ? -1 : a.ingredientId > b.ingredientId ? 1 : 0),
  );
  const exact = new Map<string, string[]>();
  let maxWords = 1;
  for (const term of terms) {
    const ids = exact.get(term.key) ?? [];
    if (!ids.includes(term.ingredientId)) ids.push(term.ingredientId);
    exact.set(term.key, ids);
    maxWords = Math.max(maxWords, term.words.length);
  }
  return { locale, terms, exact, info, displayName, maxWords };
}

/** The seed file's shape (supabase/catalog/ingredients.json), for an offline catalog. */
type CatalogJson = {
  ingredients: readonly {
    id: string;
    dimension: string;
    names: Record<string, { name: string; plural: string | null; synonyms: readonly string[] }>;
  }[];
};

/** Reads the seed catalog into index input for one locale. */
export function catalogIndexInput(catalog: CatalogJson, locale: string) {
  const ingredients: IngredientInfo[] = catalog.ingredients.map((i) => ({
    id: i.id,
    defaultDimension: i.dimension as Dimension,
    householdId: null,
  }));
  const names: IngredientNames[] = catalog.ingredients.flatMap((i) => {
    const n = i.names[locale];
    return n ? [{ ingredientId: i.id, name: n.name, plural: n.plural, synonyms: n.synonyms }] : [];
  });
  return { ingredients, names };
}
