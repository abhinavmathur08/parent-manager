import { assertEquals } from 'jsr:@std/assert@1';

import { createHandler, type HandlerDeps } from './handler.ts';
import { createJobStore, type FinishOutcome, JobRefused, type JobStore } from './jobs.ts';
import {
  type ParseRequest,
  ParserError,
  parserNotConfigured,
  type RecipeParser,
} from './parser.ts';
import { FetchPageError } from './fetch_page.ts';
import type { RecipeDraft } from './types.ts';

const DRAFT: RecipeDraft = {
  title: 'Pancakes',
  servings: 4,
  prepMinutes: 5,
  cookMinutes: 10,
  ingredients: [
    {
      original: '1 cup flour',
      quantity: 1,
      unitId: 'unit.cup_us',
      ingredientName: 'flour',
      note: null,
      confidence: 0.95,
    },
  ],
  steps: ['Mix.', 'Cook.'],
  tags: [],
  allergens: [],
};

/** An in-memory job store with a monthly allowance, like the database's. */
function fakeJobs(options: { allowance?: number; refuse?: string } = {}) {
  const state = {
    used: 0,
    reserved: new Set<string>(),
    finished: new Map<string, FinishOutcome>(),
    started: [] as { userId: string; inputType: string }[],
  };
  const jobs: JobStore = {
    start(userId, inputType) {
      if (options.refuse) return Promise.reject(new JobRefused(options.refuse));
      state.started.push({ userId, inputType });
      return Promise.resolve({
        jobId: `job-${state.started.length}`,
        householdId: 'household-1',
        locale: 'en-AU',
        region: 'AU',
      });
    },
    reserve(jobId) {
      if (state.used >= (options.allowance ?? 5)) return Promise.resolve(false);
      state.used += 1;
      state.reserved.add(jobId);
      return Promise.resolve(true);
    },
    finish(jobId, outcome) {
      state.finished.set(jobId, outcome);
      if (outcome.status === 'failed' && state.reserved.delete(jobId)) state.used -= 1;
      return Promise.resolve();
    },
  };
  return { jobs, state };
}

function parserReturning(draft: RecipeDraft, seen: ParseRequest[] = []): RecipeParser {
  return {
    parse(request) {
      seen.push(request);
      return Promise.resolve({ draft, model: 'test-model', costUnits: 3 });
    },
  };
}

function handler(overrides: Partial<HandlerDeps> = {}) {
  const logs: string[] = [];
  const deps: HandlerDeps = {
    authenticate: (token) => Promise.resolve(token === 'good-token' ? 'user-1' : null),
    jobs: fakeJobs().jobs,
    parser: parserReturning(DRAFT),
    fetchPage: () => Promise.reject(new Error('no network in tests')),
    log: (event, fields) => logs.push(JSON.stringify({ event, ...fields })),
    ...overrides,
  };
  return { handle: createHandler(deps), logs };
}

function post(body: unknown, token = 'good-token'): Request {
  return new Request('http://localhost/import-recipe', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

const TEXT = { input: { type: 'text', text: 'Pancakes\n1 cup flour\nMix and cook.' } };

Deno.test('a text import reserves, parses with locale and region, and counts', async () => {
  const { jobs, state } = fakeJobs();
  const seen: ParseRequest[] = [];
  const { handle } = handler({ jobs, parser: parserReturning(DRAFT, seen) });

  const response = await handle(post(TEXT));

  assertEquals(response.status, 200);
  assertEquals(await response.json(), {
    jobId: 'job-1',
    status: 'succeeded',
    source: 'parser',
    counted: true,
    draft: DRAFT,
  });
  assertEquals(state.started, [{ userId: 'user-1', inputType: 'text' }]);
  assertEquals(state.used, 1);
  assertEquals(seen[0].locale, 'en-AU');
  assertEquals(seen[0].region, 'AU');
  assertEquals(seen[0].source, { kind: 'text', text: TEXT.input.text });
  assertEquals(state.finished.get('job-1'), {
    status: 'succeeded',
    source: 'parser',
    draft: DRAFT,
    model: 'test-model',
    costUnits: 3,
  });
});

Deno.test('requests without a valid session are refused', async () => {
  const { jobs, state } = fakeJobs();
  const { handle } = handler({ jobs });
  assertEquals((await handle(post(TEXT, 'bad-token'))).status, 401);
  const noHeader = new Request('http://localhost/', { method: 'POST', body: '{}' });
  const response = await handle(noHeader);
  assertEquals(response.status, 401);
  assertEquals(await response.json(), { error: { code: 'import.unauthenticated' } });
  assertEquals(state.started.length, 0);
});

Deno.test('only POST is accepted', async () => {
  const { handle } = handler();
  const response = await handle(new Request('http://localhost/', { method: 'GET' }));
  assertEquals(response.status, 405);
});

Deno.test('malformed, empty and oversized inputs are refused before a job starts', async () => {
  const { jobs, state } = fakeJobs();
  const { handle } = handler({ jobs });
  for (const body of [
    'not json',
    {},
    { input: { type: 'voice' } },
    { input: { type: 'text', text: '   ' } },
    { input: { type: 'text', text: 'x'.repeat(20_001) } },
    { input: { type: 'text', text: 42 } },
  ]) {
    const response = await handle(post(body));
    assertEquals(response.status, 400);
    assertEquals(await response.json(), { error: { code: 'import.invalid_request' } });
  }
  assertEquals(state.started.length, 0);
});

Deno.test('caregivers are refused by the server (FR-AI-16)', async () => {
  const { jobs } = fakeJobs({ refuse: 'import.forbidden' });
  const { handle } = handler({ jobs });
  const response = await handle(post(TEXT));
  assertEquals(response.status, 403);
  assertEquals(await response.json(), { error: { code: 'import.forbidden' } });
});

Deno.test('the hourly rate limit returns 429', async () => {
  const { jobs } = fakeJobs({ refuse: 'import.rate_limited' });
  const { handle } = handler({ jobs });
  const response = await handle(post(TEXT));
  assertEquals(response.status, 429);
  assertEquals(await response.json(), { error: { code: 'import.rate_limited' } });
});

Deno.test('an import past the allowance fails without calling the parser', async () => {
  const { jobs, state } = fakeJobs({ allowance: 0 });
  const seen: ParseRequest[] = [];
  const { handle } = handler({ jobs, parser: parserReturning(DRAFT, seen) });
  const response = await handle(post(TEXT));
  assertEquals(response.status, 429);
  assertEquals(await response.json(), { error: { code: 'import.quota_exceeded' } });
  assertEquals(seen.length, 0);
  // The database already failed the job.
  assertEquals(state.finished.size, 0);
});

Deno.test('a failed parse does not count (FR-AI-8)', async () => {
  const { jobs, state } = fakeJobs();
  const failing: RecipeParser = {
    parse: () => Promise.reject(new ParserError('import.parse_failed')),
  };
  const { handle, logs } = handler({ jobs, parser: failing });
  const response = await handle(post(TEXT));
  assertEquals(response.status, 422);
  assertEquals(await response.json(), { error: { code: 'import.parse_failed' } });
  assertEquals(state.used, 0);
  assertEquals(state.finished.get('job-1'), { status: 'failed', errorCode: 'import.parse_failed' });
  assertEquals(logs, [
    JSON.stringify({ event: 'import.failed', job_id: 'job-1', code: 'import.parse_failed' }),
  ]);
});

Deno.test('until R-05.3 the parser is not configured and nothing counts', async () => {
  const { jobs, state } = fakeJobs();
  const { handle } = handler({ jobs, parser: parserNotConfigured });
  const response = await handle(post(TEXT));
  assertEquals(response.status, 503);
  assertEquals(await response.json(), { error: { code: 'import.parser_unavailable' } });
  assertEquals(state.used, 0);
});

Deno.test('an unexpected error fails the job with a generic code', async () => {
  const { jobs, state } = fakeJobs();
  const broken: RecipeParser = { parse: () => Promise.reject(new TypeError('boom')) };
  const { handle } = handler({ jobs, parser: broken });
  const response = await handle(post(TEXT));
  assertEquals(response.status, 500);
  assertEquals(await response.json(), { error: { code: 'import.failed' } });
  assertEquals(state.used, 0);
});

Deno.test('an import over the time limit fails, aborts the parser and does not count', async () => {
  const { jobs, state } = fakeJobs();
  let aborted = false;
  const slow: RecipeParser = {
    parse: ({ signal }) =>
      new Promise((_, reject) => {
        signal.addEventListener('abort', () => {
          aborted = true;
          reject(new DOMException('aborted', 'AbortError'));
        });
      }),
  };
  const { handle } = handler({ jobs, parser: slow, timeLimitMs: 10 });
  const response = await handle(post(TEXT));
  assertEquals(response.status, 504);
  assertEquals(await response.json(), { error: { code: 'import.timeout' } });
  assertEquals(aborted, true);
  assertEquals(state.used, 0);
});

Deno.test('logs never include the pasted text', async () => {
  const secret = 'Grandma Rose secret walnut cake';
  const { jobs } = fakeJobs();
  const failing: RecipeParser = {
    parse: () => Promise.reject(new ParserError('import.parse_failed')),
  };
  const { handle, logs } = handler({ jobs, parser: failing });
  await handle(post({ input: { type: 'text', text: secret } }));
  assertEquals(logs.length, 1);
  assertEquals(
    logs.some((line) => line.includes('walnut')),
    false,
  );
});

// ---------------------------------------------------------------------------
// Link imports (R-05.2)
// ---------------------------------------------------------------------------

const RECIPE_PAGE = `<html><head><title>Soup</title>
<script type="application/ld+json">{"@context":"https://schema.org","@type":"Recipe",
"name":"Tomato soup","recipeYield":"4","recipeIngredient":["2 tbsp olive oil","1 onion"],
"recipeInstructions":[{"@type":"HowToStep","text":"Fry the onion."}]}</script>
</head><body><p>Tomato soup</p></body></html>`;

const PLAIN_PAGE = `<html><body><nav>Home</nav><h1>Tomato soup</h1>
<ul><li>2 tbsp olive oil</li><li>1 onion</li></ul><p>Fry the onion.</p></body></html>`;

function pageFetcher(html: string, urls: string[] = []) {
  return (url: string) => {
    urls.push(url);
    return Promise.resolve({ url, html });
  };
}

const LINK = { input: { type: 'link', url: 'https://recipes.example.com/soup' } };

Deno.test('a page with schema.org data needs no parser call and does not count', async () => {
  const { jobs, state } = fakeJobs({ allowance: 0 });
  const seen: ParseRequest[] = [];
  const { handle } = handler({
    jobs,
    parser: parserReturning(DRAFT, seen),
    fetchPage: pageFetcher(RECIPE_PAGE),
  });
  const response = await handle(post(LINK));
  assertEquals(response.status, 200);
  const body = await response.json();
  assertEquals(body.source, 'structured_data');
  assertEquals(body.counted, false);
  assertEquals(body.draft.title, 'Tomato soup');
  assertEquals(body.draft.servings, 4);
  assertEquals(seen.length, 0);
  assertEquals(state.used, 0);
  assertEquals(state.started, [{ userId: 'user-1', inputType: 'link' }]);
  assertEquals(state.finished.get('job-1')?.status, 'succeeded');
});

Deno.test('a page without schema.org data sends its readable text to the parser', async () => {
  const { jobs, state } = fakeJobs();
  const seen: ParseRequest[] = [];
  const { handle } = handler({
    jobs,
    parser: parserReturning(DRAFT, seen),
    fetchPage: pageFetcher(PLAIN_PAGE),
  });
  const response = await handle(post(LINK));
  assertEquals(response.status, 200);
  assertEquals((await response.json()).counted, true);
  assertEquals(state.used, 1);
  assertEquals(seen[0].source, {
    kind: 'text',
    text: 'Tomato soup\n2 tbsp olive oil\n1 onion\nFry the onion.',
  });
  assertEquals(seen[0].locale, 'en-AU');
});

Deno.test('non-http schemes and private addresses are refused before a job starts', async () => {
  const { jobs, state } = fakeJobs();
  const urls: string[] = [];
  const { handle } = handler({ jobs, fetchPage: pageFetcher(RECIPE_PAGE, urls) });
  for (const url of [
    'file:///etc/passwd',
    'javascript:alert(1)',
    'ftp://example.com/recipe',
    'http://127.0.0.1/',
    'http://169.254.169.254/latest/meta-data/',
    'http://[::1]/',
    'http://10.0.0.5/recipe',
    'http://localhost/',
    'https://example.com:8443/',
  ]) {
    const response = await handle(post({ input: { type: 'link', url } }));
    assertEquals(response.status, 400, url);
    assertEquals(await response.json(), { error: { code: 'import.link_refused' } });
  }
  assertEquals(urls.length, 0);
  assertEquals(state.started.length, 0);
});

Deno.test('a link refused while fetching fails the job without counting', async () => {
  const { jobs, state } = fakeJobs();
  const { handle, logs } = handler({
    jobs,
    fetchPage: () => Promise.reject(new FetchPageError('import.link_refused')),
  });
  const response = await handle(post(LINK));
  assertEquals(response.status, 422);
  assertEquals(await response.json(), { error: { code: 'import.link_refused' } });
  assertEquals(state.used, 0);
  assertEquals(state.finished.get('job-1'), { status: 'failed', errorCode: 'import.link_refused' });
  assertEquals(
    logs.some((line) => line.includes('example.com')),
    false,
  );
});

Deno.test('an unreachable site fails with 502', async () => {
  const { handle } = handler({
    fetchPage: () => Promise.reject(new FetchPageError('import.link_unreachable')),
  });
  assertEquals((await handle(post(LINK))).status, 502);
});

Deno.test('a page with no readable text fails without counting', async () => {
  const { jobs, state } = fakeJobs();
  const { handle } = handler({
    jobs,
    fetchPage: pageFetcher('<html><script>x()</script></html>'),
  });
  const response = await handle(post(LINK));
  assertEquals(await response.json(), { error: { code: 'import.no_recipe_found' } });
  assertEquals(state.used, 0);
});

// ---------------------------------------------------------------------------
// The database adapter
// ---------------------------------------------------------------------------

function fakeRpc(responses: Record<string, { data: unknown; error: unknown }>) {
  const calls: { fn: string; args: Record<string, unknown> }[] = [];
  return {
    calls,
    client: {
      rpc(fn: string, args: Record<string, unknown>) {
        calls.push({ fn, args });
        return Promise.resolve(
          responses[fn] as { data: unknown; error: { message: string; hint?: string } | null },
        );
      },
    },
  };
}

Deno.test('the job store maps database refusals to their codes', async () => {
  const { client } = fakeRpc({
    ai_import_start: { data: null, error: { message: 'x', hint: 'import.forbidden' } },
  });
  const store = createJobStore(client);
  let refused: unknown;
  try {
    await store.start('user-1', 'text');
  } catch (error) {
    refused = error;
  }
  assertEquals(refused instanceof JobRefused && refused.code, 'import.forbidden');
});

Deno.test('the job store reads the started job and passes outcomes through', async () => {
  const { client, calls } = fakeRpc({
    ai_import_start: {
      data: [{ job_id: 'j', household_id: 'h', locale: 'en-GB', region: 'GB' }],
      error: null,
    },
    ai_import_reserve: { data: true, error: null },
    ai_import_finish: { data: null, error: null },
  });
  const store = createJobStore(client);
  assertEquals(await store.start('user-1', 'text'), {
    jobId: 'j',
    householdId: 'h',
    locale: 'en-GB',
    region: 'GB',
  });
  assertEquals(await store.reserve('j'), true);
  await store.finish('j', { status: 'failed', errorCode: 'import.timeout' });
  assertEquals(
    calls.map((c) => c.fn),
    ['ai_import_start', 'ai_import_reserve', 'ai_import_finish'],
  );
  assertEquals(calls[2].args, {
    p_job_id: 'j',
    p_status: 'failed',
    p_error_code: 'import.timeout',
  });
});
