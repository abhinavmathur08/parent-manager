// The import-recipe pipeline (architecture section 6), with its dependencies passed in so
// it can be tested without a database or a model.
//
// Logs carry only job IDs and error codes: never recipe text, URLs or user content.

import { errorResponse, jsonResponse } from '../_shared/http.ts';
import { checkLinkShape, type FetchedPage, FetchPageError } from './fetch_page.ts';
import { readableText, recipeFromStructuredData } from './html.ts';
import { JobRefused, type JobStore } from './jobs.ts';
import { ParserError, type RecipeParser } from './parser.ts';
import type {
  ImportRequest,
  InputType,
  Locale,
  ParseSource,
  RecipeDraft,
  Region,
} from './types.ts';

/** FR-AI-11 (PROPOSED): an import not finished in 45 seconds fails and can be retried. */
export const IMPORT_TIME_LIMIT_MS = 45_000;
/** Pasted text longer than this is refused. A long recipe is well under it. */
export const MAX_TEXT_CHARS = 20_000;
/**
 * Images are compressed on the device to 1600 px on the long edge (FR-AI-12), well under 1 MB
 * as JPEG. Anything larger than this is refused.
 */
export const MAX_IMAGE_BASE64_CHARS = 2_800_000;
const MAX_BODY_BYTES = MAX_IMAGE_BASE64_CHARS + 64 * 1024;
const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;
/** The start of a JPEG or PNG file, in base64. */
const MAGIC: Record<string, string> = { 'image/jpeg': '/9j/', 'image/png': 'iVBORw0KGgo' };

export interface HandlerDeps {
  /** Returns the user ID for a valid access token, or null. */
  authenticate(accessToken: string): Promise<string | null>;
  jobs: JobStore;
  parser: RecipeParser;
  /** Fetches a link with the SSRF guards in fetch_page.ts. */
  fetchPage(url: string, signal: AbortSignal): Promise<FetchedPage>;
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

    const read = await readRequest(req);
    if ('error' in read) return errorResponse(read.error, 400);
    const { request, jobId } = read;

    let job;
    try {
      job = await deps.jobs.start(userId, inputTypeOf(request), jobId);
    } catch (error) {
      if (error instanceof JobRefused) {
        const status = { 'import.rate_limited': 429, 'import.invalid_request': 400 }[error.code];
        return errorResponse(error.code, status ?? 403);
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
  let source: ParseSource;
  if (request.type === 'image') {
    // The image goes to the parser from memory and is never written anywhere, so it's gone
    // when this request ends (FR-AI-12).
    source = { kind: 'image', mediaType: request.mediaType, base64: request.base64 };
  } else if (request.type === 'link') {
    const page = await deps.fetchPage(request.url, signal);
    // Embedded schema.org data needs no parser call, so it's free (AI-17, FR-AI-8).
    const structured = recipeFromStructuredData(page.html);
    if (structured) return { source: 'structured_data', draft: structured };
    const text = readableText(page.html, MAX_TEXT_CHARS);
    if (!text) throw new ImportFailure('import.no_recipe_found', 422);
    source = { kind: 'text', text };
  } else {
    source = { kind: 'text', text: request.text };
  }

  // Only a parser call uses the allowance, so reserve right before it (FR-AI-8).
  if (!(await deps.jobs.reserve(jobId))) {
    throw new ImportFailure('import.quota_exceeded', 429);
  }
  const parsed = await deps.parser.parse({
    source,
    locale,
    region,
    signal,
  });
  return { source: 'parser', ...parsed };
}

function toFailure(error: unknown): ImportFailure {
  if (error instanceof ImportFailure) return error;
  if (error instanceof FetchPageError) {
    return new ImportFailure(error.code, error.code === 'import.link_unreachable' ? 502 : 422);
  }
  if (error instanceof ParserError) {
    return new ImportFailure(error.code, error.code === 'import.parser_unavailable' ? 503 : 422);
  }
  return new ImportFailure('import.failed', 500);
}

function inputTypeOf(request: ImportRequest): InputType {
  return request.type;
}

function readImage(input: Record<string, unknown>): ReadResult | ImportRequest {
  const { kind, mediaType, base64 } = input;
  if (kind !== 'photo' && kind !== 'screenshot') return INVALID;
  if (mediaType !== 'image/jpeg' && mediaType !== 'image/png') return INVALID;
  if (typeof base64 !== 'string' || base64.length === 0) return INVALID;
  if (base64.length > MAX_IMAGE_BASE64_CHARS) return { error: 'import.image_too_large' };
  if (!BASE64.test(base64) || !base64.startsWith(MAGIC[mediaType])) return INVALID;
  return { type: 'image', kind, mediaType, base64 };
}

function bearerToken(req: Request): string | null {
  const match = /^Bearer\s+(\S+)$/i.exec(req.headers.get('Authorization') ?? '');
  return match ? match[1] : null;
}

type ReadResult = { request: ImportRequest; jobId?: string } | { error: string };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const INVALID: ReadResult = { error: 'import.invalid_request' };

/** Reads and validates the body. Links are checked for shape before any job starts. */
async function readRequest(req: Request): Promise<ReadResult> {
  const declared = Number(req.headers.get('Content-Length') ?? '0');
  if (declared > MAX_BODY_BYTES) return { error: 'import.image_too_large' };
  let raw: string;
  try {
    raw = await req.text();
  } catch {
    return INVALID;
  }
  if (new TextEncoder().encode(raw).length > MAX_BODY_BYTES) {
    return { error: 'import.image_too_large' };
  }

  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return INVALID;
  }
  if (typeof body !== 'object' || body === null) return INVALID;
  const { input, jobId } = body as { input?: unknown; jobId?: unknown };
  if (typeof input !== 'object' || input === null) return INVALID;
  // The app's own job ID, so it can read the result after leaving the screen (R-06.1).
  if (jobId !== undefined && (typeof jobId !== 'string' || !UUID.test(jobId))) return INVALID;
  const withId = jobId ? { jobId: jobId.toLowerCase() } : {};
  const { type, text, url } = input as { type?: unknown; text?: unknown; url?: unknown };
  if (type === 'image') {
    const image = readImage(input as Record<string, unknown>);
    return 'type' in image ? { request: image, ...withId } : image;
  }

  if (type === 'text' && typeof text === 'string') {
    const trimmed = text.trim();
    if (trimmed.length === 0 || trimmed.length > MAX_TEXT_CHARS) return INVALID;
    return { request: { type: 'text', text: trimmed }, ...withId };
  }
  if (type === 'link' && typeof url === 'string') {
    const link = checkLinkShape(url.trim());
    return link
      ? { request: { type: 'link', url: link.href }, ...withId }
      : { error: 'import.link_refused' };
  }
  return INVALID;
}

function defaultLog(event: string, fields: Record<string, string>): void {
  console.error(JSON.stringify({ event, ...fields }));
}
