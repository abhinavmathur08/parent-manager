import type { RecipeTag } from '../tables';
import type { LineUnitId } from '../units';

/**
 * The starter library (R-04.1, FR-REC-2, FR-REC-3): read-only recipes every household sees,
 * shipped with the app as versioned seed data so they work offline from the first launch.
 *
 * PLACEHOLDER CONTENT. These five recipes were written by the Parent Manager team for
 * development, in their own words, and aren't copied from any source. The real library
 * (40 to 60 recipes, with rights recorded) is R-04.2 and waits on decision D-8. Bump
 * STARTER_LIBRARY_VERSION whenever the content changes.
 *
 * Ingredients use catalog IDs and units use unit IDs (FR-REC-2). Amounts are in grams,
 * millilitres, metric teaspoons or counts; recipe detail shows them in the household's
 * unit system. Titles and steps are per locale, falling back to en-US.
 */
export const STARTER_LIBRARY_VERSION = 1;

export type StarterLine = {
  ingredientId: string;
  quantity: number | null;
  unitId: LineUnitId | null;
  note?: string;
};

export type StarterText = { title: string; steps: readonly string[]; notes?: string };

export type StarterRecipe = {
  /** A stable ID, kept in `recipes.library_recipe_id` on saved copies. */
  key: `starter.${string}`;
  servings: number;
  prepMinutes: number | null;
  cookMinutes: number | null;
  tags: readonly RecipeTag[];
  lines: readonly StarterLine[];
  text: { 'en-US': StarterText } & Partial<Record<'en-GB' | 'en-AU', StarterText>>;
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

export const STARTER_RECIPES: readonly StarterRecipe[] = [
  {
    key: 'starter.overnight_oats',
    servings: 2,
    prepMinutes: 5,
    cookMinutes: null,
    tags: ['tag.no_cook', 'tag.one_handed', 'tag.quick'],
    lines: [
      { ingredientId: 'ingredient.rolled_oats', quantity: 100, unitId: 'unit.g' },
      { ingredientId: 'ingredient.milk', quantity: 250, unitId: 'unit.ml' },
      { ingredientId: 'ingredient.greek_yogurt', quantity: 120, unitId: 'unit.ml' },
      { ingredientId: 'ingredient.chia_seeds', quantity: 10, unitId: 'unit.g' },
      { ingredientId: 'ingredient.banana', quantity: 1, unitId: 'unit.each' },
      { ingredientId: 'ingredient.honey', quantity: 2, unitId: 'unit.tsp_metric' },
    ],
    text: {
      'en-US': {
        title: 'Overnight oats',
        steps: [
          'Stir the oats, milk, yogurt and chia seeds together in a jar or bowl.',
          'Cover and chill overnight, or for at least four hours.',
          'Slice the banana on top and drizzle with honey to serve.',
        ],
        notes: 'Leave out the honey for children under one.',
      },
      'en-GB': {
        title: 'Overnight oats',
        steps: [
          'Stir the oats, milk, yoghurt and chia seeds together in a jar or bowl.',
          'Cover and chill overnight, or for at least four hours.',
          'Slice the banana on top and drizzle with honey to serve.',
        ],
        notes: 'Leave out the honey for children under one.',
      },
    },
  },
  {
    key: 'starter.lentil_tomato_soup',
    servings: 4,
    prepMinutes: 10,
    cookMinutes: 30,
    tags: ['tag.freezer_friendly', 'tag.batch_prep'],
    lines: [
      { ingredientId: 'ingredient.olive_oil', quantity: 15, unitId: 'unit.ml' },
      { ingredientId: 'ingredient.onion', quantity: 1, unitId: 'unit.each', note: 'chopped' },
      { ingredientId: 'ingredient.carrot', quantity: 2, unitId: 'unit.each', note: 'chopped' },
      { ingredientId: 'ingredient.garlic', quantity: 2, unitId: 'unit.each', note: 'cloves' },
      { ingredientId: 'ingredient.cumin', quantity: 1, unitId: 'unit.tsp_metric' },
      { ingredientId: 'ingredient.dried_lentils', quantity: 200, unitId: 'unit.g' },
      { ingredientId: 'ingredient.canned_tomatoes', quantity: 1, unitId: 'unit.each' },
      { ingredientId: 'ingredient.vegetable_stock', quantity: 1000, unitId: 'unit.ml' },
      { ingredientId: 'ingredient.salt', quantity: null, unitId: null },
    ],
    text: {
      'en-US': {
        title: 'Lentil and tomato soup',
        steps: [
          'Warm the oil in a large pan and cook the onion and carrot gently for about 8 minutes.',
          'Add the garlic and cumin and cook for a minute more.',
          'Add the lentils, tomatoes and stock, then simmer for 25 minutes until the lentils are soft.',
          'Blend if you like it smooth, and season to taste.',
        ],
        notes: 'Cool, then freeze in single portions for up to three months.',
      },
    },
  },
  {
    key: 'starter.chicken_traybake',
    servings: 4,
    prepMinutes: 10,
    cookMinutes: 40,
    tags: ['tag.batch_prep', 'tag.kid_friendly'],
    lines: [
      { ingredientId: 'ingredient.chicken_thigh', quantity: 600, unitId: 'unit.g' },
      { ingredientId: 'ingredient.sweet_potato', quantity: 2, unitId: 'unit.each', note: 'cubed' },
      { ingredientId: 'ingredient.broccoli', quantity: 1, unitId: 'unit.each', note: 'in florets' },
      { ingredientId: 'ingredient.red_onion', quantity: 1, unitId: 'unit.each', note: 'in wedges' },
      { ingredientId: 'ingredient.olive_oil', quantity: 30, unitId: 'unit.ml' },
      { ingredientId: 'ingredient.smoked_paprika', quantity: 1, unitId: 'unit.tsp_metric' },
      { ingredientId: 'ingredient.salt', quantity: null, unitId: null },
      { ingredientId: 'ingredient.black_pepper', quantity: null, unitId: null },
    ],
    text: {
      'en-US': {
        title: 'One-tray chicken and sweet potato',
        steps: [
          'Heat the oven to 400°F (200°C).',
          'Toss the chicken, sweet potato and onion with the oil, paprika, salt and pepper on a large tray.',
          'Roast for 25 minutes, add the broccoli, then roast for 15 minutes more until the chicken is cooked through.',
        ],
      },
      'en-GB': {
        title: 'One-tray chicken and sweet potato',
        steps: [
          'Heat the oven to 200°C (180°C fan).',
          'Toss the chicken, sweet potato and onion with the oil, paprika, salt and pepper on a large tray.',
          'Roast for 25 minutes, add the broccoli, then roast for 15 minutes more until the chicken is cooked through.',
        ],
      },
      'en-AU': {
        title: 'One-tray chicken and sweet potato',
        steps: [
          'Heat the oven to 200°C (180°C fan-forced).',
          'Toss the chicken, sweet potato and onion with the oil, paprika, salt and pepper on a large tray.',
          'Roast for 25 minutes, add the broccoli, then roast for 15 minutes more until the chicken is cooked through.',
        ],
      },
    },
  },
  {
    key: 'starter.banana_pancakes',
    servings: 2,
    prepMinutes: 5,
    cookMinutes: 10,
    tags: ['tag.baby_led_weaning', 'tag.toddler', 'tag.quick'],
    lines: [
      { ingredientId: 'ingredient.banana', quantity: 1, unitId: 'unit.each', note: 'ripe' },
      { ingredientId: 'ingredient.egg', quantity: 2, unitId: 'unit.each' },
      { ingredientId: 'ingredient.flour', quantity: 30, unitId: 'unit.g' },
      { ingredientId: 'ingredient.baking_powder', quantity: 0.5, unitId: 'unit.tsp_metric' },
      { ingredientId: 'ingredient.butter', quantity: 10, unitId: 'unit.g' },
    ],
    text: {
      'en-US': {
        title: 'Banana pancakes',
        steps: [
          'Mash the banana well, then whisk in the eggs, flour and baking powder.',
          'Melt a little butter in a frying pan over medium heat.',
          'Cook small spoonfuls for about 2 minutes on each side until golden.',
          'Let them cool before serving to little ones.',
        ],
      },
    },
  },
  {
    key: 'starter.cheesy_pasta_peas',
    servings: 4,
    prepMinutes: 5,
    cookMinutes: 12,
    tags: ['tag.kid_friendly', 'tag.toddler', 'tag.quick'],
    lines: [
      { ingredientId: 'ingredient.pasta', quantity: 300, unitId: 'unit.g' },
      { ingredientId: 'ingredient.pea', quantity: 150, unitId: 'unit.g', note: 'frozen' },
      { ingredientId: 'ingredient.butter', quantity: 15, unitId: 'unit.g' },
      { ingredientId: 'ingredient.milk', quantity: 100, unitId: 'unit.ml' },
      { ingredientId: 'ingredient.cheddar', quantity: 100, unitId: 'unit.g', note: 'grated' },
    ],
    text: {
      'en-US': {
        title: 'Cheesy pasta with peas',
        steps: [
          'Cook the pasta in salted water, adding the peas for the last 3 minutes.',
          'Drain, then stir in the butter, milk and cheese over low heat until creamy.',
        ],
      },
    },
  },
];

/** A starter recipe's text in the household's locale, falling back to en-US. */
export function starterText(recipe: StarterRecipe, locale: string): StarterText {
  return recipe.text[locale as keyof StarterRecipe['text']] ?? recipe.text['en-US'];
}

export function findStarter(key: string): StarterRecipe | undefined {
  return STARTER_RECIPES.find((r) => r.key === key);
}
