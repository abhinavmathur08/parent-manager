# AI import evaluation set

The evaluation for AI recipe import (R-05.4, spec AI-21 to AI-23). It scores how well a
provider and our own extraction and matching code turn recipes into ingredient IDs, unit
IDs, quantities and allergens.

## What's here

- `fixtures.json`: 60 original recipes, 20 each for the US, the UK and Australia, written
  for this set and not copied from any site or book. Each region mixes pasted text (11),
  links without embedded data (3), links with schema.org data (2), screenshots (2) and
  photos (2). Each has a hand-made gold parse per ingredient line: the ingredient ID, the
  unit ID and the quantity (the base quantity follows from the unit).
- `images/`: the screenshot and photo fixtures, rendered from their transcripts by
  `render_image.py` (macOS). The photos are stand-ins; replace them with real photos of
  recipes we own when we have some.
- `run.ts`: runs each fixture through the real pipeline (link extraction, the AI parser
  over a provider, then normalization on the device) and scores it.
- `results/`: stored reports, for comparison between prompts, models and providers.

## Measures and thresholds (spec AI-22, PROPOSED)

| Measure                                             | Threshold   |
| --------------------------------------------------- | ----------- |
| Ingredient matched to the gold ID                   | 90% or more |
| Gold unit, and base quantity within 2%              | 95% or more |
| Recall of catalog allergens of the gold ingredients | 100%        |
| Output lines whose text isn't in the source         | 1% or fewer |
| Median link import time (real providers only)       | 8 s or less |

## In CI

`__tests__/import/ai-eval.test.ts` runs the whole set with the fake provider on every
build, so it needs no key. It fails if a threshold is missed, or if the report differs from
`results/fake.json`: a change to the prompt, schema, extraction or matching code that moves
any score shows up in the diff. Update the stored report with:

```bash
AI_EVAL_WRITE=1 pnpm test __tests__/import/ai-eval
```

The fake provider reads text with simple rules and "reads" images from their transcripts,
so in CI the scores mostly measure our own extraction and matching. Only a real provider
measures parsing quality.

## Against a real provider

Once the product owner has an API key (decision D-7), run the set with the key in the
environment of your own shell. Never commit or paste the key.

```bash
AI_EVAL_PROVIDER=anthropic ANTHROPIC_API_KEY=... pnpm run eval:ai
```

- `AI_MODEL` picks the model (default `claude-opus-5-5`), for example `claude-sonnet-5-5` or
  `claude-haiku-5-5`, to compare accuracy against cost.
- `AI_EVAL_ONLY=us-0` runs a sample (fixture IDs starting with that text).
- The report goes to `results/<provider>-<model>.json`, with the scores, the
  median link time and every missed line. Commit it with the change it measures.
- The run makes one request per fixture (two if one is retried): about 60 requests.

Run it again monthly against the live configuration (AI-23), and on any change to the
prompt (`supabase/functions/import-recipe/ai/prompt.ts`, which has `PROMPT_VERSION`), the
model, the schema or the matching code.

To evaluate another provider, add its adapter next to `ai/anthropic.ts` and a branch for it
in `live.eval.ts`.
