import { FunctionsFetchError, FunctionsHttpError } from '@supabase/supabase-js';
import { File } from 'expo-file-system';

import { getSupabase } from '@/lib/supabase';

import type { Capture } from './capture';
import type { DocumentCategory } from './tables';

/** The Edge Function that checks limits, signs uploads and marks documents ready (V-02.2). */
export const DOCUMENTS_FUNCTION = 'documents';
const BUCKET = 'documents';

/** What the parent fills in on S-41 (FR2-DOC-2). */
export type DocumentDetails = {
  title: string;
  category: DocumentCategory;
  personId: string | null;
  /** `YYYY-MM-DD`, or null. */
  expiresOn: string | null;
};

/** Codes the app explains. Server codes come from the function; `network` is the app's own. */
export const UPLOAD_ERROR_CODES = [
  'documents.limit',
  'documents.file_too_large',
  'documents.too_many_pages',
  'documents.forbidden',
  'documents.invalid',
  'documents.exists',
  'documents.not_found',
  'documents.upload_incomplete',
  'documents.unavailable',
  'documents.network',
  'documents.failed',
] as const;
export type UploadErrorCode = (typeof UPLOAD_ERROR_CODES)[number];

export class UploadError extends Error {
  constructor(readonly code: UploadErrorCode) {
    super(code);
    this.name = 'UploadError';
  }
}

/** Failures that may pass on their own, so a draft waits and tries again. */
export function isRetryable(code: UploadErrorCode): boolean {
  return [
    'documents.network',
    'documents.unavailable',
    'documents.upload_incomplete',
    'documents.failed',
  ].includes(code);
}

const known = (code: unknown): UploadErrorCode =>
  (UPLOAD_ERROR_CODES as readonly unknown[]).includes(code)
    ? (code as UploadErrorCode)
    : 'documents.failed';

async function toUploadError(error: unknown): Promise<UploadError> {
  if (error instanceof UploadError) return error;
  if (error instanceof FunctionsHttpError) {
    try {
      const body = (await (error.context as Response).json()) as { error?: { code?: string } };
      return new UploadError(known(body.error?.code));
    } catch {
      return new UploadError('documents.failed');
    }
  }
  if (error instanceof FunctionsFetchError) return new UploadError('documents.network');
  return new UploadError('documents.failed');
}

/** Calls the documents function, turning its error codes into `UploadError`s. */
export async function callDocuments<T>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await getSupabase().functions.invoke<T>(DOCUMENTS_FUNCTION, { body });
  if (error) throw await toUploadError(error);
  if (!data) throw new UploadError('documents.failed');
  return data;
}

/**
 * Stores a document (V-02.2, architecture 3.5): `begin` checks the role and limits and creates
 * the row as `uploading`, which nobody sees; each file goes to its signed upload URL; `finish`
 * checks the stored files and marks the row `ready`. If anything fails halfway, the row stays
 * hidden and the server removes it within 24 hours, so a failed upload leaves no document.
 *
 * A retry of a begun upload asks `finish` first, since a lost response may have hidden a
 * success, then starts again under a new ID (add-queue.ts).
 */
export async function uploadDocument(input: {
  householdId: string;
  documentId: string;
  details: DocumentDetails;
  capture: Capture;
  /** Called once the server holds a hidden row for this ID. */
  onBegun?: () => void;
}): Promise<void> {
  const { householdId, documentId, details, capture } = input;
  const begun = await callDocuments<{ uploads: { path: string; token: string }[] }>({
    action: 'begin',
    household_id: householdId,
    document_id: documentId,
    title: details.title.trim(),
    category: details.category,
    person_id: details.personId,
    expires_on: details.expiresOn,
    mime: capture.mime,
    files: capture.files.map((file) => ({ size: file.size })),
  });
  input.onBegun?.();
  if (begun.uploads.length !== capture.files.length) throw new UploadError('documents.failed');

  const storage = getSupabase().storage.from(BUCKET);
  for (const [index, upload] of begun.uploads.entries()) {
    let bytes: ArrayBuffer;
    try {
      bytes = await new File(capture.files[index].uri).arrayBuffer();
    } catch {
      throw new UploadError('documents.failed');
    }
    const { error } = await storage.uploadToSignedUrl(upload.path, upload.token, bytes, {
      contentType: capture.mime,
      upsert: false,
    });
    if (error) throw new UploadError('documents.network');
  }
  await finishUpload(documentId);
}

/** Asks the server to check the files and mark the document ready. */
export async function finishUpload(documentId: string): Promise<void> {
  await callDocuments({ action: 'finish', document_id: documentId });
}

/** The size bucket for `document_added`: never the exact size (FR2-DOC-11). */
export function sizeBucket(bytes: number): 'under_1mb' | '1_5mb' | '5_20mb' | 'over_20mb' {
  const mb = bytes / (1024 * 1024);
  if (mb < 1) return 'under_1mb';
  if (mb < 5) return '1_5mb';
  if (mb < 20) return '5_20mb';
  return 'over_20mb';
}
