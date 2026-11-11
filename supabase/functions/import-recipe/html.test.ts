import { assertEquals } from 'jsr:@std/assert@1';

import {
  decodeEntities,
  durationMinutes,
  readableText,
  recipeFromStructuredData,
  servingsFrom,
} from './html.ts';

const ld = (data: unknown) =>
  `<html><head><script type="application/ld+json">${JSON.stringify(data)}</script></head></html>`;

const RECIPE = {
  '@context': 'https://schema.org',
  '@type': 'Recipe',
  name: 'Lamington &amp; cream',
  recipeYield: ['12', '12 squares'],
  prepTime: 'PT20M',
  cookTime: 'PT1H5M',
  recipeIngredient: ['1 &frac12; cups self-raising flour', '<b>2</b> eggs', ''],
  recipeInstructions: [
    {
      '@type': 'HowToSection',
      name: 'Cake',
      itemListElement: [
        { '@type': 'HowToStep', text: 'Heat the oven to 180&deg;C.' },
        { '@type': 'HowToStep', text: 'Bake for 25 minutes.' },
      ],
    },
    'Cut into squares.',
  ],
};

Deno.test('reads a schema.org Recipe into a draft', () => {
  assertEquals(recipeFromStructuredData(ld(RECIPE)), {
    title: 'Lamington & cream',
    servings: 12,
    prepMinutes: 20,
    cookMinutes: 65,
    ingredients: [
      {
        original: '1 ½ cups self-raising flour',
        quantity: null,
        unitId: null,
        ingredientName: null,
        note: null,
        confidence: 0,
      },
      {
        original: '2 eggs',
        quantity: null,
        unitId: null,
        ingredientName: null,
        note: null,
        confidence: 0,
      },
    ],
    steps: ['Heat the oven to 180°C.', 'Bake for 25 minutes.', 'Cut into squares.'],
    tags: [],
    allergens: [],
  });
});

Deno.test('finds the Recipe inside @graph, arrays and multi-typed nodes', () => {
  const graph = { '@context': 'https://schema.org', '@graph': [{ '@type': 'WebPage' }, RECIPE] };
  assertEquals(recipeFromStructuredData(ld(graph))?.title, 'Lamington & cream');
  assertEquals(recipeFromStructuredData(ld([{ '@type': 'Organization' }, RECIPE]))?.servings, 12);
  const multi = { ...RECIPE, '@type': ['Recipe', 'NewsArticle'] };
  assertEquals(recipeFromStructuredData(ld(multi))?.cookMinutes, 65);
});

Deno.test('skips malformed blocks and uses a later valid one', () => {
  const page = `<script type="application/ld+json">{not json</script>${ld(RECIPE)}`;
  assertEquals(recipeFromStructuredData(page)?.title, 'Lamington & cream');
});

Deno.test('incomplete or missing recipe data goes to the parser instead', () => {
  assertEquals(recipeFromStructuredData('<html><p>Soup</p></html>'), null);
  assertEquals(recipeFromStructuredData(ld({ ...RECIPE, recipeIngredient: [] })), null);
  assertEquals(recipeFromStructuredData(ld({ ...RECIPE, recipeInstructions: undefined })), null);
  assertEquals(recipeFromStructuredData(ld({ ...RECIPE, name: '' })), null);
  assertEquals(recipeFromStructuredData(ld({ ...RECIPE, '@type': 'HowTo' })), null);
});

Deno.test('instructions given as one block of text become one step per line', () => {
  const draft = recipeFromStructuredData(
    ld({ ...RECIPE, recipeInstructions: '<p>Mix.</p><p>Bake.</p>\nCool.' }),
  );
  assertEquals(draft?.steps, ['Mix.', 'Bake.', 'Cool.']);
});

Deno.test('caps the number of ingredient lines and their length', () => {
  const many = Array.from({ length: 150 }, (_, i) => `${i} ${'x'.repeat(600)}`);
  const draft = recipeFromStructuredData(ld({ ...RECIPE, recipeIngredient: many }));
  assertEquals(draft?.ingredients.length, 100);
  assertEquals(draft?.ingredients[0].original.length, 500);
});

Deno.test('ISO 8601 durations become minutes', () => {
  assertEquals(durationMinutes('PT45M'), 45);
  assertEquals(durationMinutes('PT1H30M'), 90);
  assertEquals(durationMinutes('P1DT2H'), 1560);
  assertEquals(durationMinutes('PT90S'), 2);
  assertEquals(durationMinutes('PT'), null);
  assertEquals(durationMinutes('45 minutes'), null);
  assertEquals(durationMinutes(45), null);
});

Deno.test('servings come from the first number in recipeYield', () => {
  assertEquals(servingsFrom(4), 4);
  assertEquals(servingsFrom('Serves 6'), 6);
  assertEquals(servingsFrom(['8', '8 slices']), 8);
  assertEquals(servingsFrom('a few'), null);
  assertEquals(servingsFrom('0'), null);
});

Deno.test('entities are decoded and unknown ones left alone', () => {
  assertEquals(
    decodeEntities('Fish &amp; chips &#8211; &#x2019;s &unknown;'),
    'Fish & chips – ’s &unknown;',
  );
});

Deno.test('readable text drops page furniture and code, one block per line', () => {
  const page = `<html><head><title>T</title><style>p{}</style></head><body>
    <header>Site</header><nav>Menu</nav><!-- note -->
    <h1>Scones</h1><ul><li>2 cups flour</li><li>1 cup cream</li></ul>
    <script>track()</script><p>Mix &amp; bake.</p>
    <footer>Copyright</footer></body></html>`;
  assertEquals(readableText(page, 1000), 'Scones\n2 cups flour\n1 cup cream\nMix & bake.');
  assertEquals(readableText(page, 6), 'Scones');
});
