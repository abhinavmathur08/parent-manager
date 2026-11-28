import { formatNumber, i18n } from '@/i18n';

import type { RecipeTag } from '../tables';
import type { LineUnitId } from '../units';
import data from './recipes.json';
import enAU from './text/en-AU.json';
import enGB from './text/en-GB.json';
import enUS from './text/en-US.json';

/**
 * The starter library (R-04.1, R-04.2, FR-REC-2, FR-REC-3): read-only recipes every household
 * sees, shipped with the app as versioned seed data so they work offline from the first launch.
 *
 * The recipes are data: `recipes.json` holds each recipe's servings, times, tags and lines, and
 * `text/<locale>.json` its title, steps, notes and line notes. en-US has text for every recipe;
 * en-GB and en-AU only where the words differ, field by field, falling back to en-US. Steps write
 * temperatures as tokens, so each region reads its own scale: `{oven:200}` is a conventional
 * oven at 200 °C and `{temp:74}` a food's internal temperature in °C.
 *
 * Ingredients use catalog IDs and units are base units (grams, millilitres, metric teaspoons or
 * counts); recipe detail shows them in the household's unit system. `pnpm run recipes:check`
 * (scripts/starter-recipes.js) enforces that, a new-parent tag on every recipe, safe doneness
 * cues and the infant-feeding rules, and keeps docs/starter-recipe-review.md, the test cooks'
 * sheet and rights record (decision D-8), current. Bump `version` in recipes.json whenever the
 * content changes.
 */
export const STARTER_LIBRARY_VERSION: number = data.version;

export type StarterLine = {
  ingredientId: string;
  quantity: number | null;
  unitId: LineUnitId | null;
};

export type StarterText = {
  title: string;
  steps: readonly string[];
  notes?: string;
  /** Short notes on lines, such as "chopped", by line index. */
  lineNotes?: Readonly<Record<string, string>>;
};

type TextLocale = 'en-US' | 'en-GB' | 'en-AU';

export type StarterRecipe = {
  /** A stable ID, kept in `recipes.library_recipe_id` on saved copies. */
  key: `starter.${string}`;
  servings: number;
  prepMinutes: number | null;
  cookMinutes: number | null;
  tags: readonly RecipeTag[];
  lines: readonly StarterLine[];
  /** The text as written, tokens and all. Read it with `starterText`. */
  text: { 'en-US': StarterText } & Partial<
    Record<Exclude<TextLocale, 'en-US'>, Partial<StarterText>>
  >;
};

/** Tags that make a recipe suit new parents (FR-REC-2): every starter has at least one. */
export const NEW_PARENT_TAGS: readonly RecipeTag[] = [
  'tag.no_cook',
  'tag.one_handed',
  'tag.freezer_friendly',
  'tag.batch_prep',
  'tag.quick',
  'tag.baby_led_weaning',
  'tag.toddler',
];

type TextFile = Record<string, Partial<StarterText>>;
const TEXTS: Record<TextLocale, TextFile> = { 'en-US': enUS, 'en-GB': enGB, 'en-AU': enAU };

type RecipeData = Omit<StarterRecipe, 'text'>;

export const STARTER_RECIPES: readonly StarterRecipe[] = (
  data.recipes as unknown as RecipeData[]
).map((recipe) => {
  const text: Record<string, Partial<StarterText>> = {};
  for (const [locale, file] of Object.entries(TEXTS)) {
    if (file[recipe.key]) text[locale] = file[recipe.key];
  }
  return { ...recipe, text: text as StarterRecipe['text'] };
});

const TOKEN = /\{(oven|temp):(\d+)\}/g;

/** Fahrenheit, rounded the way recipes print it: ovens to 25 °F, food to 5 °F. */
const fahrenheit = (celsius: number, step: number) =>
  Math.round(((celsius * 9) / 5 + 32) / step) * step;

/** Replaces temperature tokens with the region's scale, for example 400°F or 200°C (180°C fan). */
export function renderTemperatures(text: string, locale: string): string {
  const t = i18n.getFixedT(locale);
  const n = (value: number) => formatNumber(value, locale);
  return text.replace(TOKEN, (_, kind: string, value: string) => {
    const celsius = Number(value);
    return kind === 'oven'
      ? t('recipes.starter.ovenTemp', {
          celsius: n(celsius),
          fan: n(celsius - 20),
          fahrenheit: n(fahrenheit(celsius, 25)),
        })
      : t('recipes.starter.foodTemp', {
          celsius: n(celsius),
          fahrenheit: n(fahrenheit(celsius, 5)),
        });
  });
}

/** A starter recipe's text in the household's locale, field by field falling back to en-US. */
export function starterText(recipe: StarterRecipe, locale: string): StarterText {
  const base = recipe.text['en-US'];
  const own = recipe.text[locale as Exclude<TextLocale, 'en-US'>] ?? {};
  const render = (s: string) => renderTemperatures(s, locale);
  const notes = own.notes ?? base.notes;
  const lineNotes = own.lineNotes ?? base.lineNotes;
  return {
    title: render(own.title ?? base.title),
    steps: (own.steps ?? base.steps).map(render),
    ...(notes === undefined ? {} : { notes: render(notes) }),
    ...(lineNotes === undefined ? {} : { lineNotes }),
  };
}

export function findStarter(key: string): StarterRecipe | undefined {
  return STARTER_RECIPES.find((r) => r.key === key);
}
