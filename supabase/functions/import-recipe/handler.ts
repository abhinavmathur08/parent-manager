// The import-recipe pipeline (architecture section 6), with its dependencies passed in so
// it can be tested without a database or a model.
//
// Logs carry only job IDs and error codes: never recipe text, URLs or user content.

import { errorResponse, jsonResponse } from '../_shared/http.ts';
import { JobRefused, type JobStore } from './jobs.ts';
import { ParserError, type RecipeParser } from './parser.ts';
import type { ImportRequest, InputType, Locale, RecipeDraft, Region } from './types.ts';

/** FR-AI-11 (PROPOSED): an import not finished in 45 seconds fails and can be retried. */
export const IMPORT_TIME_LIMIT_MS = 45_000;
/** Pasted text longer than this is refused. A long recipe is well under it. */
export const MAX_TEXT_CHARS = 20_000;
const MAX_BODY_BYTES = 64 * 1024;

export interface HandlerDeps {
  /** Returns the user ID for a valid access token, or null. */
  authenticate(accessToken: string): Promise<string | null>;
  jobs: JobStore;
  parser: RecipeParser;
  timeLimitMs?: number;
  log?: (event: string, fields: Record<string, string>) => void;
}

export interface ImportSuccess {
  jobId: string;
  status: 'succeeded';
  source: 'structured_data' | 'parser';
  /** Whether this import used one of the month's allowance (FR-AI-8). */
  counted: boolean;
  draft: RecipeDraft;
}

/** A failure inside a job, which finishes it as failed with this code. */
class ImportFailure extends Error {
  constructor(
    readonly code: string,
    readonly status: number,
  ) {
    super(code);
  }
}

export function createHandler(deps: HandlerDeps): (req: Request) => Promise<Response> {
  const log = deps.log ?? defaultLog;
  const timeLimitMs = deps.timeLimitMs ?? IMPORT_TIME_LIMIT_MS;

  return async (req) => {
    if (req.method !== 'POST') return errorResponse('import.method_not_allowed', 405);

    const token = bearerToken(req);
    const userId = token ? await deps.authenticate(token) : null;
    if (!userId) return errorResponse('import.unauthenticated', 401);

    const request = await readRequest(req);
    if (!request) return errorResponse('import.invalid_request', 400);

    let job;
    try {
      job = await deps.jobs.start(userId, inputTypeOf(request));
    } catch (error) {
      if (error instanceof JobRefused) {
        return errorResponse(error.code, error.code === 'import.rate_limited' ? 429 : 403);
      }
      log('import.start_failed', {});
      return errorResponse('import.failed', 500);
    }

    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        reject(new ImportFailure('import.timeout', 504));
      }, timeLimitMs);
    });

    try {
      const result = await Promise.race([
        run(deps, request, job.jobId, job.locale, job.region, controller.signal),
        deadline,
      ]);
      await deps.jobs.finish(job.jobId, {
        status: 'succeeded',
        source: result.source,
        draft: result.draft,
        model: result.model,
        costUnits: result.costUnits,
      });
      const body: ImportSuccess = {
        jobId: job.jobId,
        status: 'succeeded',
        source: result.source,
        counted: result.source === 'parser',
        draft: result.draft,
      };
      return jsonResponse(body);
    } catch (error) {
      const failure = toFailure(error);
      log('import.failed', { job_id: job.jobId, code: failure.code });
      // A quota refusal already failed the job in the database.
      if (failure.code !== 'import.quota_exceeded') {
        try {
          await deps.jobs.finish(job.jobId, { status: 'failed', errorCode: failure.code });
        } catch {
          // Housekeeping fails the job and releases its reservation later.
          log('import.finish_failed', { job_id: job.jobId });
        }
      }
      return errorResponse(failure.code, failure.status);
    } finally {
      clearTimeout(timer);
      controller.abort();
    }
  };
}

interface RunResult {
  source: 'structured_data' | 'parser';
  draft: RecipeDraft;
  model?: string;
  costUnits?: number;
}

async function run(
  deps: HandlerDeps,
  request: ImportRequest,
  jobId: string,
  locale: Locale,
  region: Region,
  signal: AbortSignal,
): Promise<RunResult> {
  // Only a parser call uses the allowance, so reserve right before it (FR-AI-8).
  if (!(await deps.jobs.reserve(jobId))) {
    throw new ImportFailure('import.quota_exceeded', 429);
  }
  const parsed = await deps.parser.parse({
    source: { kind: 'text', text: request.text },
    locale,
    region,
    signal,
  });
  return { source: 'parser', ...parsed };
}

function toFailure(error: unknown): ImportFailure {
  if (error instanceof ImportFailure) return error;
  if (error instanceof ParserError) {
    return new ImportFailure(error.code, error.code === 'import.parser_unavailable' ? 503 : 422);
  }
  return new ImportFailure('import.failed', 500);
}

function inputTypeOf(request: ImportRequest): InputType {
  return request.type;
}

function bearerToken(req: Request): string | null {
  const match = /^Bearer\s+(\S+)$/i.exec(req.headers.get('Authorization') ?? '');
  return match ? match[1] : null;
}

/** Reads and validates the body, or returns null. */
async function readRequest(req: Request): Promise<ImportRequest | null> {
  const declared = Number(req.headers.get('Content-Length') ?? '0');
  if (declared > MAX_BODY_BYTES) return null;
  let raw: string;
  try {
    raw = await req.text();
  } catch {
    return null;
  }
  if (new TextEncoder().encode(raw).length > MAX_BODY_BYTES) return null;

  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof body !== 'object' || body === null) return null;
  const input = (body as { input?: unknown }).input;
  if (typeof input !== 'object' || input === null) return null;
  const { type, text } = input as { type?: unknown; text?: unknown };

  if (type === 'text' && typeof text === 'string') {
    const trimmed = text.trim();
    if (trimmed.length === 0 || trimmed.length > MAX_TEXT_CHARS) return null;
    return { type: 'text', text: trimmed };
  }
  return null;
}

function defaultLog(event: string, fields: Record<string, string>): void {
  console.error(JSON.stringify({ event, ...fields }));
}
