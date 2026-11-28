// Checks the starter recipe library (R-04.2, FR-REC-2, decision D-8) and writes its review sheet.
//
//   node scripts/starter-recipes.js --check   fail on any problem or a stale review sheet (CI)
//   node scripts/starter-recipes.js --write   regenerate docs/starter-recipe-review.md
//
// The recipes are in src/features/recipes/starter/recipes.json, their text in
// src/features/recipes/starter/text/<locale>.json (en-US for every recipe, en-GB and en-AU only
// where the words differ), and the people who test-cooked and health-reviewed each one in
// docs/starter-recipe-review.json. The rules below are data, so adding one is a table entry.
// They're a safety net for food safety and infant feeding, not a replacement for the test cooks
// and health reviewers D-8 asks for.
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const LOCALES = ['en-US', 'en-GB', 'en-AU'];
const TEXT_FIELDS = ['title', 'steps', 'notes', 'lineNotes'];

// Must match RECIPE_TAGS in src/features/recipes/tables.ts and NEW_PARENT_TAGS in
// src/features/recipes/starter/library.ts (a unit test checks both).
const TAGS = [
  'tag.no_cook',
  'tag.one_handed',
  'tag.freezer_friendly',
  'tag.batch_prep',
  'tag.quick',
  'tag.kid_friendly',
  'tag.toddler',
  'tag.baby_led_weaning',
  'tag.needs_defrosting',
];
const NEW_PARENT_TAGS = [
  'tag.no_cook',
  'tag.one_handed',
  'tag.freezer_friendly',
  'tag.batch_prep',
  'tag.quick',
  'tag.baby_led_weaning',
  'tag.toddler',
];
/** Recipes for babies and toddlers: the infant rules apply, and a health reviewer checks them. */
const INFANT_TAGS = ['tag.baby_led_weaning', 'tag.toddler'];
const BATCH_TAGS = ['tag.freezer_friendly', 'tag.batch_prep'];

// Amounts are stored in base units and converted only for display (CLAUDE.md), so a line uses
// grams, millilitres, metric teaspoons, a count, a pinch or a dash. Each unit's dimension:
const UNITS = {
  'unit.g': 'mass',
  'unit.ml': 'volume',
  'unit.tsp_metric': 'volume',
  'unit.each': 'count',
  'unit.pinch': null,
  'unit.dash': null,
};

// Temperatures are tokens, so each region reads its own scale: {oven:200} is a conventional
// oven at 200 °C, and {temp:74} is a food's internal temperature in °C (library.ts renders both).
const TOKEN = /\{(oven|temp):(\d+)\}/g;
const TOKEN_RANGES = { oven: [100, 260], temp: [50, 100] };

// Safe doneness (USDA and NHS guidance). Every recipe that cooks one of these needs a cue in its
// steps, in every locale: an internal temperature of at least minC, or, where `cue` is given, a
// visible cue. Infant recipes use infantMinC where it's set, since babies' meat is cooked through.
const DONENESS = {
  poultry: {
    minC: 74,
    ingredients: [
      'ingredient.chicken_breast',
      'ingredient.chicken_thigh',
      'ingredient.chicken_drumstick',
      'ingredient.chicken_wing',
      'ingredient.whole_chicken',
      'ingredient.ground_chicken',
      'ingredient.ground_turkey',
      'ingredient.turkey_breast',
    ],
  },
  ground_meat: {
    minC: 71,
    ingredients: [
      'ingredient.ground_beef',
      'ingredient.ground_pork',
      'ingredient.ground_lamb',
      'ingredient.sausage',
      'ingredient.meatballs',
    ],
  },
  whole_meat: {
    minC: 63,
    infantMinC: 71,
    ingredients: [
      'ingredient.beef_steak',
      'ingredient.beef_stew',
      'ingredient.beef_roast',
      'ingredient.pork_chop',
      'ingredient.pork_tenderloin',
      'ingredient.pork_shoulder',
      'ingredient.lamb_chop',
      'ingredient.lamb_leg',
      'ingredient.bacon',
      'ingredient.pancetta',
      'ingredient.chorizo',
    ],
  },
  fish: {
    minC: 63,
    cue: /\b(flakes easily|opaque all the way through)\b/i,
    ingredients: [
      'ingredient.salmon',
      'ingredient.white_fish',
      'ingredient.tuna_steak',
      'ingredient.fish_sticks',
    ],
  },
  shellfish: {
    minC: 63,
    cue: /\b(pink and opaque|opaque all the way through|shells have opened)\b/i,
    ingredients: [
      'ingredient.shrimp',
      'ingredient.crab',
      'ingredient.lobster',
      'ingredient.mussel',
      'ingredient.clam',
      'ingredient.scallop',
      'ingredient.squid',
    ],
  },
  egg: {
    minC: 71,
    cue: /\b(set|firm|cooked through|comes out clean|springs back)\b/i,
    ingredients: ['ingredient.egg'],
  },
};

// Infant-feeding rules (NHS, CDC and Australian infant feeding guidance) for baby-led weaning and
// toddler recipes. `tags` narrows a rule to some infant tags; it applies to both otherwise.
const INFANT_BANNED = [
  { why: 'honey (botulism risk under one)', ingredients: ['ingredient.honey'] },
  {
    why: 'whole nuts (a choking risk: use a smooth nut butter or ground nuts)',
    ingredients: [
      'ingredient.almonds',
      'ingredient.walnuts',
      'ingredient.pecans',
      'ingredient.cashews',
      'ingredient.pine_nuts',
      'ingredient.pistachios',
      'ingredient.hazelnuts',
      'ingredient.peanuts',
      'ingredient.mixed_nuts',
      'ingredient.macadamias',
      'ingredient.brazil_nuts',
    ],
  },
  {
    why: 'added salt or a salty seasoning',
    ingredients: [
      'ingredient.salt',
      'ingredient.bouillon',
      'ingredient.soy_sauce',
      'ingredient.fish_sauce',
      'ingredient.oyster_sauce',
      'ingredient.yeast_spread',
      'ingredient.miso',
      'ingredient.gravy',
      'ingredient.canned_soup',
      'ingredient.taco_seasoning',
    ],
  },
  {
    why: 'a salty processed meat',
    ingredients: [
      'ingredient.bacon',
      'ingredient.pancetta',
      'ingredient.ham',
      'ingredient.prosciutto',
      'ingredient.salami',
      'ingredient.chorizo',
      'ingredient.hot_dog',
      'ingredient.deli_turkey',
      'ingredient.smoked_salmon',
      'ingredient.anchovies',
    ],
  },
  {
    why: 'a choking risk',
    ingredients: ['ingredient.popcorn', 'ingredient.hot_dog', 'ingredient.chocolate_chips'],
  },
  {
    why: 'alcohol or caffeine',
    ingredients: [
      'ingredient.white_wine',
      'ingredient.red_wine',
      'ingredient.beer',
      'ingredient.cooking_sherry',
      'ingredient.shaoxing_wine',
      'ingredient.mirin',
      'ingredient.coffee',
      'ingredient.instant_coffee',
      'ingredient.tea',
    ],
  },
  {
    why: 'a mould-ripened or blue cheese (listeria risk)',
    ingredients: ['ingredient.brie', 'ingredient.blue_cheese'],
  },
  {
    why: 'added sugar (not for babies under one)',
    tags: ['tag.baby_led_weaning'],
    ingredients: [
      'ingredient.sugar',
      'ingredient.caster_sugar',
      'ingredient.brown_sugar',
      'ingredient.powdered_sugar',
      'ingredient.maple_syrup',
      'ingredient.golden_syrup',
      'ingredient.corn_syrup',
      'ingredient.molasses',
      'ingredient.condensed_milk',
      'ingredient.jam',
      'ingredient.nutella',
    ],
  },
];

// Ingredients an infant recipe may use only when every locale's line note says how to make
// them safe.
const INFANT_LINE_NOTES = [
  {
    why: 'whole grapes and cherry tomatoes are a choking risk: quarter them lengthways',
    note: /\bquarter(ed)? lengthways\b/i,
    ingredients: ['ingredient.grape', 'ingredient.cherry_tomato', 'ingredient.olives'],
  },
  {
    why: 'whole blueberries are a choking risk: squash or halve them',
    note: /\b(squashed|flattened|halved|quartered)\b/i,
    ingredients: ['ingredient.blueberry'],
  },
  {
    why: 'stock is salty: use a low-salt or salt-free stock',
    note: /\b(low-salt|salt-free|no-salt|no added salt)\b/i,
    ingredients: [
      'ingredient.chicken_stock',
      'ingredient.beef_stock',
      'ingredient.vegetable_stock',
    ],
  },
];

// Words an infant recipe's text never uses.
const INFANT_TEXT = [
  { why: 'honey', pattern: /\bhoney\b/i },
  {
    why: 'added salt',
    pattern:
      /\b(salted water|season(ed|ing)?\b(?! (it )?with (herbs|spices))|add (a pinch of )?salt|salt to taste|sprinkle (of |with )?salt)/i,
  },
  { why: 'whole nuts or whole grapes', pattern: /\bwhole (nuts|grapes|peanuts|almonds)\b/i },
];

// Any recipe's text: amounts belong in the lines and temperatures in tokens, so each region
// reads its own units.
const TEXT_RULES = [
  {
    why: 'an amount (amounts belong in the lines)',
    pattern:
      /\b\d+(\.\d+)?\s*(cups?|tbsp|tsp|tablespoons?|teaspoons?|oz|ounces?|lbs?|pounds?|g|grams?|kg|ml|millilit(er|re)s?|lit(er|re)s?|inch(es)?|cm|mm)\b/i,
  },
  { why: 'a written-out temperature (use a token)', pattern: /°|\bdegrees\b|\bfahrenheit\b/i },
];

// US words that UK or Australian English says differently. If the en-US text uses one, the
// listed locales need their own text that doesn't.
const US_TERMS = [
  { us: /\byogurts?\b/i, locales: { 'en-GB': 'yoghurt', 'en-AU': 'yoghurt' } },
  { us: /\bzucchinis?\b/i, locales: { 'en-GB': 'courgette' } },
  { us: /\beggplants?\b/i, locales: { 'en-GB': 'aubergine' } },
  { us: /\bcilantro\b/i, locales: { 'en-GB': 'coriander', 'en-AU': 'coriander' } },
  {
    us: /\b(scallions?|green onions?)\b/i,
    locales: { 'en-GB': 'spring onion', 'en-AU': 'spring onion' },
  },
  { us: /\bbell peppers?\b/i, locales: { 'en-GB': 'pepper', 'en-AU': 'capsicum' } },
  {
    us: /\bground (beef|pork|chicken|turkey|lamb)\b/i,
    locales: { 'en-GB': 'mince', 'en-AU': 'mince' },
  },
  { us: /\bbroil(s|ed|er|ing)?\b/i, locales: { 'en-GB': 'grill', 'en-AU': 'grill' } },
  { us: /\bskillet\b/i, locales: { 'en-GB': 'frying pan', 'en-AU': 'frying pan' } },
  { us: /\bstovetop\b/i, locales: { 'en-GB': 'hob' } },
  { us: /\bplastic wrap\b/i, locales: { 'en-GB': 'cling film' } },
  { us: /\baluminum\b/i, locales: { 'en-GB': 'foil', 'en-AU': 'foil' } },
  { us: /\ball-purpose flour\b/i, locales: { 'en-GB': 'plain flour', 'en-AU': 'plain flour' } },
  { us: /\bheavy cream\b/i, locales: { 'en-GB': 'double cream', 'en-AU': 'thickened cream' } },
  { us: /\bcornstarch\b/i, locales: { 'en-GB': 'cornflour', 'en-AU': 'cornflour' } },
  {
    us: /\bbaking soda\b/i,
    locales: { 'en-GB': 'bicarbonate of soda', 'en-AU': 'bicarb soda' },
  },
  { us: /\bshrimps?\b/i, locales: { 'en-GB': 'prawns', 'en-AU': 'prawns' } },
  {
    us: /\b(cookie sheet|sheet pan)s?\b/i,
    locales: { 'en-GB': 'baking tray', 'en-AU': 'baking tray' },
  },
  {
    us: /\b(colors?|flavors?|favorites?|flavorful)\b/i,
    locales: { 'en-GB': 'colour, flavour', 'en-AU': 'colour, flavour' },
  },
  { us: /\bchili\b/i, locales: { 'en-GB': 'chilli', 'en-AU': 'chilli' } },
  { us: /\barugula\b/i, locales: { 'en-GB': 'rocket', 'en-AU': 'rocket' } },
  { us: /\b(oatmeal)\b/i, locales: { 'en-GB': 'porridge', 'en-AU': 'porridge' } },
  {
    us: /\b(cupcake|muffin) liners?\b/i,
    locales: { 'en-GB': 'paper cases', 'en-AU': 'paper cases' },
  },
  { us: /\bpopsicles?\b/i, locales: { 'en-GB': 'ice lolly', 'en-AU': 'icy pole' } },
  { us: /\bbeets?\b/i, locales: { 'en-GB': 'beetroot', 'en-AU': 'beetroot' } },
  { us: /\brutabagas?\b/i, locales: { 'en-GB': 'swede', 'en-AU': 'swede' } },
  { us: /\btomato paste\b/i, locales: { 'en-GB': 'tomato purée' } },
  { us: /\bpowdered sugar\b/i, locales: { 'en-GB': 'icing sugar', 'en-AU': 'icing sugar' } },
  { us: /\b(french )?fries\b/i, locales: { 'en-GB': 'chips' } },
  { us: /\bcanned\b/i, locales: { 'en-GB': 'tinned' } },
  { us: /\bcookies?\b/i, locales: { 'en-GB': 'biscuit', 'en-AU': 'biscuit' } },
  { us: /\bfish sticks?\b/i, locales: { 'en-GB': 'fish fingers', 'en-AU': 'fish fingers' } },
];

const isInfant = (recipe) => (recipe.tags ?? []).some((t) => INFANT_TAGS.includes(t));

/** A recipe's text in a locale, each field falling back to en-US, as library.ts resolves it. */
function resolveText(texts, key, locale) {
  const base = texts['en-US']?.[key] ?? {};
  const own = texts[locale]?.[key] ?? {};
  return Object.fromEntries(TEXT_FIELDS.map((f) => [f, own[f] ?? base[f]]));
}

const allText = (text) => [
  text.title ?? '',
  ...(text.steps ?? []),
  text.notes ?? '',
  ...Object.values(text.lineNotes ?? {}),
];

/**
 * Returns a list of problems, empty when the library is fine.
 * @param {{ version: number, recipes: object[] }} data recipes.json
 * @param {Record<string, object>} texts each locale's text file, by locale code
 * @param {{ ingredients: object[] }} catalog supabase/catalog/ingredients.json
 * @param {Record<string, object>} records docs/starter-recipe-review.json
 */
function validate(data, texts, catalog, records = {}) {
  const errors = [];
  const ingredients = new Map(catalog.ingredients.map((i) => [i.id, i]));
  if (!Number.isInteger(data.version) || data.version < 1) errors.push('version: bad version');
  const keys = new Set();

  for (const recipe of data.recipes ?? []) {
    const key = recipe.key ?? '(recipe without key)';
    if (!/^starter\.[a-z0-9_]+$/.test(recipe.key ?? '')) errors.push(`${key}: bad key`);
    if (keys.has(recipe.key)) errors.push(`${key}: duplicate key`);
    keys.add(recipe.key);

    if (!Number.isInteger(recipe.servings) || recipe.servings < 1) {
      errors.push(`${key}: servings must be a whole number of at least 1`);
    }
    for (const field of ['prepMinutes', 'cookMinutes']) {
      const value = recipe[field];
      if (value !== null && !(Number.isInteger(value) && value > 0)) {
        errors.push(`${key}: ${field} must be a positive whole number or null`);
      }
    }

    const tags = Array.isArray(recipe.tags) ? recipe.tags : [];
    for (const tag of tags) if (!TAGS.includes(tag)) errors.push(`${key}: unknown tag ${tag}`);
    if (new Set(tags).size !== tags.length) errors.push(`${key}: a tag is listed twice`);
    if (!tags.some((t) => NEW_PARENT_TAGS.includes(t))) {
      errors.push(`${key}: no new-parent tag (FR-REC-2)`);
    }

    const lines = Array.isArray(recipe.lines) ? recipe.lines : [];
    if (lines.length === 0) errors.push(`${key}: no ingredient lines`);
    lines.forEach((line, i) => {
      const at = `${key} line ${i}`;
      const item = ingredients.get(line.ingredientId);
      if (!item) {
        errors.push(`${at}: ${line.ingredientId ?? 'no ingredient'} isn't a catalog ingredient ID`);
        return;
      }
      if (line.unitId !== null && !(line.unitId in UNITS)) {
        errors.push(
          `${at}: unit ${line.unitId} isn't a base unit (${Object.keys(UNITS).join(', ')})`,
        );
        return;
      }
      if (line.quantity !== null && !(typeof line.quantity === 'number' && line.quantity > 0)) {
        errors.push(`${at}: quantity must be a positive number or null`);
      }
      if (line.quantity === null && line.unitId !== null && UNITS[line.unitId] !== null) {
        errors.push(`${at}: a measured unit needs a quantity`);
      }
      const dimension = line.unitId ? UNITS[line.unitId] : null;
      if (dimension && dimension !== item.dimension) {
        const convertible = dimension !== 'count' && item.dimension !== 'count' && item.density;
        if (!convertible) {
          errors.push(
            `${at}: ${line.ingredientId} is measured by ${item.dimension}, not ${dimension}`,
          );
        }
      }
    });

    const infant = isInfant(recipe);
    const ids = new Set(lines.map((l) => l.ingredientId));
    if (infant) {
      for (const rule of INFANT_BANNED) {
        if (rule.tags && !rule.tags.some((t) => tags.includes(t))) continue;
        for (const id of rule.ingredients) {
          if (ids.has(id)) errors.push(`${key}: an infant recipe has ${rule.why}: ${id}`);
        }
      }
    }

    // Text, as each locale will read it.
    const own = texts['en-US']?.[recipe.key];
    if (!own) {
      errors.push(`${key}: no en-US text`);
      continue;
    }
    for (const locale of LOCALES) {
      const text = resolveText(texts, recipe.key, locale);
      const at = `${key} (${locale})`;
      if (typeof text.title !== 'string' || text.title.trim() === '')
        errors.push(`${at}: no title`);
      if (!Array.isArray(text.steps) || text.steps.length === 0) {
        errors.push(`${at}: no steps`);
        continue;
      }
      if (text.steps.some((s) => typeof s !== 'string' || s.trim() === '')) {
        errors.push(`${at}: an empty step`);
      }
      if (text.notes !== undefined && typeof text.notes !== 'string') {
        errors.push(`${at}: notes must be text`);
      }
      for (const [index, note] of Object.entries(text.lineNotes ?? {})) {
        if (!/^\d+$/.test(index) || Number(index) >= lines.length) {
          errors.push(`${at}: a line note for line ${index}, which doesn't exist`);
        } else if (typeof note !== 'string' || note.trim() === '') {
          errors.push(`${at}: an empty line note`);
        }
      }

      const strings = allText(text).filter((s) => typeof s === 'string');
      for (const s of strings) {
        const stray = s.replace(TOKEN, '');
        if (/[{}]/.test(stray)) errors.push(`${at}: an unknown token in "${s}"`);
        for (const [, kind, value] of s.matchAll(TOKEN)) {
          const [min, max] = TOKEN_RANGES[kind];
          if (Number(value) < min || Number(value) > max) {
            errors.push(`${at}: {${kind}:${value}} is out of range`);
          }
        }
        for (const rule of TEXT_RULES) {
          if (rule.pattern.test(s.replace(TOKEN, '')))
            errors.push(`${at}: has ${rule.why}: "${s}"`);
        }
        if (infant) {
          for (const rule of INFANT_TEXT) {
            if (rule.pattern.test(s))
              errors.push(`${at}: an infant recipe mentions ${rule.why}: "${s}"`);
          }
        }
        if (locale !== 'en-US') {
          for (const term of US_TERMS) {
            const word = term.locales[locale];
            if (word && term.us.test(s)) {
              errors.push(`${at}: uses the US word "${s.match(term.us)[0]}" (${locale}: ${word})`);
            }
          }
        }
      }

      const steps = text.steps.join('\n');
      const temps = [...steps.matchAll(TOKEN)]
        .filter((m) => m[1] === 'temp')
        .map((m) => Number(m[2]));
      for (const [kind, rule] of Object.entries(DONENESS)) {
        if (!rule.ingredients.some((id) => ids.has(id))) continue;
        const min = infant && rule.infantMinC ? rule.infantMinC : rule.minC;
        const hot = temps.some((t) => t >= min);
        if (!hot && !(rule.cue && rule.cue.test(steps))) {
          const want = rule.cue ? `{temp:${min}} or a cue like ${rule.cue}` : `{temp:${min}}`;
          errors.push(`${at}: cooks ${kind.replace('_', ' ')} with no safe doneness cue (${want})`);
        }
      }

      if (infant) {
        for (const rule of INFANT_LINE_NOTES) {
          lines.forEach((line, i) => {
            if (!rule.ingredients.includes(line.ingredientId)) return;
            if (!rule.note.test(text.lineNotes?.[String(i)] ?? '')) {
              errors.push(`${at} line ${i}: ${rule.why}`);
            }
          });
        }
      }
    }
  }

  // Text for a recipe the library doesn't have, or a field the app doesn't read.
  for (const [locale, file] of Object.entries(texts)) {
    if (!LOCALES.includes(locale)) errors.push(`${locale}: unknown locale`);
    for (const [key, entry] of Object.entries(file ?? {})) {
      if (!keys.has(key)) errors.push(`${key}: ${locale} text for an unknown recipe`);
      for (const field of Object.keys(entry ?? {})) {
        if (!TEXT_FIELDS.includes(field)) errors.push(`${key}: unknown ${locale} field ${field}`);
      }
    }
  }

  const byKey = new Map((data.recipes ?? []).map((r) => [r.key, r]));
  for (const [key, record] of Object.entries(records)) {
    const recipe = byKey.get(key);
    if (!recipe) {
      errors.push(`${key}: a review record for an unknown recipe`);
      continue;
    }
    for (const field of Object.keys(record)) {
      if (!['testCooked', 'healthReview'].includes(field)) {
        errors.push(`${key}: unknown review field ${field}`);
      }
    }
    if (record.healthReview && !isInfant(recipe)) {
      errors.push(`${key}: only baby-led weaning and toddler recipes get a health review`);
    }
  }
  return errors;
}

/** Allergens a recipe contains, from its ingredients' catalog codes (FR-REC-9). */
function recipeAllergens(recipe, catalog) {
  const ingredients = new Map(catalog.ingredients.map((i) => [i.id, i]));
  const codes = new Set(
    recipe.lines.flatMap((l) => ingredients.get(l.ingredientId)?.allergens ?? []),
  );
  return [...codes].sort();
}

const SHEET = 'docs/starter-recipe-review.md';
const short = (id) => id.slice(id.indexOf('.') + 1).replace(/_/g, ' ');
const cell = (text) => (text ? String(text).replace(/\|/g, '\\|') : '');

/** The review sheet: the test cooks' and health reviewers' checklist, and the rights record. */
function reviewSheet(data, texts, catalog, records = {}) {
  const recipes = data.recipes;
  const infant = recipes.filter(isInfant).length;
  const batch = recipes.filter((r) => r.tags.some((t) => BATCH_TAGS.includes(t))).length;
  const tested = recipes.filter((r) => records[r.key]?.testCooked).length;
  const lines = [
    '# Starter recipe library: review sheet',
    '',
    '<!-- Generated by `pnpm run recipes:sheet` from src/features/recipes/starter/, the ingredient catalog and docs/starter-recipe-review.json. Do not edit by hand. -->',
    '',
    `Library version ${data.version}: ${recipes.length} recipes, ${batch} freezer-friendly or batch prep, ${infant} for babies or toddlers. ${tested} of ${recipes.length} test-cooked.`,
    '',
    '## Rights',
    '',
    'Claude, an AI model by Anthropic, wrote every recipe in this library for Parent Manager under decision D-8 (2026-11-27), in its own words. The text is original: it is not copied or closely reworded from any book, site or other source. Ingredient lists and amounts are ordinary cooking facts. The library has no photos. Parent Manager owns the text and may change it freely.',
    '',
    '## How to review',
    '',
    'Before the beta, a person cooks each recipe from the app and records it. Baby-led weaning and toddler recipes (**Infant: yes**) also go to the health reviewers who check the starter checklists (D-27). To record a review, add the recipe to `docs/starter-recipe-review.json`, for example `"starter.overnight_oats": { "testCooked": "Sam, 2026-12-03" }` or `{ "healthReview": "Dr Lee, 2026-12-05" }`, then run `pnpm run recipes:sheet`. Change the recipe itself in `src/features/recipes/starter/` and bump its `version`.',
    '',
    '`pnpm run recipes:check` already enforces: catalog ingredient IDs and base units, a new-parent tag on every recipe, a safe doneness cue for meat, poultry, fish and eggs, the infant-feeding rules (no honey, whole nuts, salt, unquartered grapes and so on), and UK and Australian words. Allergens come from the catalog, so they update when the ingredients do.',
    '',
    '## Recipes',
    '',
    '| Recipe | Tags | Allergens | Infant | Test-cooked by and on | Health review |',
    '| --- | --- | --- | --- | --- | --- |',
  ];
  for (const recipe of recipes) {
    const title = texts['en-US'][recipe.key].title;
    const record = records[recipe.key] ?? {};
    const allergens = recipeAllergens(recipe, catalog).map(short).join(', ') || 'none';
    const isBaby = isInfant(recipe);
    lines.push(
      `| ${cell(title)} (\`${recipe.key}\`) | ${recipe.tags.map(short).join(', ')} | ${allergens} | ${isBaby ? 'yes' : 'no'} | ${cell(record.testCooked)} | ${isBaby ? cell(record.healthReview) : 'n/a'} |`,
    );
  }
  return `${lines.join('\n')}\n`;
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(path.join(root, file), 'utf8'));
}

function load() {
  const dir = 'src/features/recipes/starter';
  return {
    data: readJson(`${dir}/recipes.json`),
    texts: Object.fromEntries(LOCALES.map((l) => [l, readJson(`${dir}/text/${l}.json`)])),
    catalog: readJson('supabase/catalog/ingredients.json'),
    records: readJson('docs/starter-recipe-review.json'),
  };
}

function main() {
  const mode = process.argv[2];
  if (mode !== '--check' && mode !== '--write') {
    console.error('Usage: node scripts/starter-recipes.js --check | --write');
    process.exit(2);
  }
  const { data, texts, catalog, records } = load();
  const errors = validate(data, texts, catalog, records);
  if (errors.length > 0) {
    console.error(`The starter recipe library has ${errors.length} problem(s):`);
    for (const error of errors) console.error(`  - ${error}`);
    process.exit(1);
  }
  const sheet = reviewSheet(data, texts, catalog, records);
  const file = path.join(root, SHEET);
  if (mode === '--write') {
    fs.writeFileSync(file, sheet);
    console.log(`Wrote ${SHEET}.`);
    return;
  }
  if (!fs.existsSync(file) || fs.readFileSync(file, 'utf8') !== sheet) {
    console.error(`${SHEET} is out of date. Run: pnpm run recipes:sheet`);
    process.exit(1);
  }
  console.log(`Starter recipes OK: ${data.recipes.length} recipes, review sheet current.`);
}

if (require.main === module) main();

module.exports = {
  validate,
  reviewSheet,
  recipeAllergens,
  resolveText,
  TAGS,
  NEW_PARENT_TAGS,
  UNITS,
  DONENESS,
  INFANT_BANNED,
  US_TERMS,
};
