import { FunctionsFetchError, FunctionsHttpError } from '@supabase/supabase-js';

import { getSupabase } from '@/lib/supabase';

import { readImage } from './image';
import type { ImportedDraft, ImportSource } from './types';

/** The Edge Function that turns links, text and images into drafts (architecture section 6). */
export const IMPORT_FUNCTION = 'import-recipe';

/** What the member gave us. Kept on the device so a retry needs no retyping (FR-AI-11). */
export type ImportInput =
  | { type: 'link'; url: string }
  | { type: 'text'; text: string }
  /** A compressed photo or screenshot in the app's cache (R-07, FR-AI-12). */
  | { type: 'image'; kind: 'photo' | 'screenshot'; uri: string; mediaType: 'image/jpeg' };

export type ImportResult = { draft: ImportedDraft; source: ImportSource };

/**
 * Error codes the app knows how to explain. Server codes come from the function; `network`
 * is the app's own, for a request that never got an answer.
 */
export const IMPORT_ERROR_CODES = [
  'import.unauthenticated',
  'import.invalid_request',
  'import.forbidden',
  'import.rate_limited',
  'import.quota_exceeded',
  'import.timeout',
  'import.parser_unavailable',
  'import.parse_failed',
  'import.failed',
  'import.link_refused',
  'import.link_unreachable',
  'import.link_unsupported',
  'import.link_too_large',
  'import.no_recipe_found',
  'import.image_too_large',
  'import.network',
] as const;
export type ImportErrorCode = (typeof IMPORT_ERROR_CODES)[number];

export class ImportError extends Error {
  constructor(readonly code: ImportErrorCode) {
    super(code);
    this.name = 'ImportError';
  }
}

const known = (code: unknown): ImportErrorCode =>
  (IMPORT_ERROR_CODES as readonly unknown[]).includes(code)
    ? (code as ImportErrorCode)
    : 'import.failed';

/** Codes worth retrying as they are; the others need a different input or a wait. */
export function isRetryable(code: ImportErrorCode): boolean {
  return [
    'import.timeout',
    'import.parse_failed',
    'import.failed',
    'import.link_unreachable',
    'import.network',
  ].includes(code);
}

/** Codes about the link itself, where pasting the recipe's text may work instead. */
export function isLinkProblem(code: ImportErrorCode): boolean {
  return code.startsWith('import.link_') || code === 'import.no_recipe_found';
}

async function toImportError(error: unknown): Promise<ImportError> {
  if (error instanceof FunctionsHttpError) {
    try {
      const body = (await (error.context as Response).json()) as { error?: { code?: string } };
      return new ImportError(known(body.error?.code));
    } catch {
      return new ImportError('import.failed');
    }
  }
  if (error instanceof FunctionsFetchError) return new ImportError('import.network');
  return new ImportError('import.failed');
}

/** Starts an import under the app's own job ID and waits for the draft. */
export async function startImport(jobId: string, input: ImportInput): Promise<ImportResult> {
  let body: Record<string, unknown> = input;
  if (input.type === 'image') {
    let base64: string;
    try {
      base64 = await readImage(input);
    } catch {
      throw new ImportError('import.failed');
    }
    body = { type: 'image', kind: input.kind, mediaType: input.mediaType, base64 };
  }
  const { data, error } = await getSupabase().functions.invoke<{
    draft: ImportedDraft;
    source: ImportSource;
  }>(IMPORT_FUNCTION, { body: { jobId, input: body } });
  if (error) throw await toImportError(error);
  if (!data?.draft) throw new ImportError('import.failed');
  return { draft: data.draft, source: data.source };
}

export type JobState =
  | { status: 'missing' }
  | { status: 'processing' }
  | { status: 'succeeded'; result: ImportResult }
  | { status: 'failed'; code: ImportErrorCode };

/** Reads a job back by ID, after the app left the screen while it ran (S-20). */
export async function fetchJob(jobId: string): Promise<JobState> {
  const { data, error } = await getSupabase()
    .from('ai_import_jobs')
    .select('status, source, draft, error_code')
    .eq('id', jobId)
    .maybeSingle();
  if (error) throw new ImportError('import.network');
  if (!data) return { status: 'missing' };
  const row = data as {
    status: string;
    source: ImportSource | null;
    draft: ImportedDraft | null;
    error_code: string | null;
  };
  if (row.status === 'succeeded' && row.draft && row.source) {
    return { status: 'succeeded', result: { draft: row.draft, source: row.source } };
  }
  if (row.status === 'failed') return { status: 'failed', code: known(row.error_code) };
  return { status: 'processing' };
}
