// The `documents` Edge Function (V-02.2, architecture section 3.5). One POST endpoint with an
// `action`:
//
// - `begin` (a parent): checks the role and the limits from app_config `documents.limits`
//   (25 documents on Free, 2 GB on Premium, 10 MB a file, 20 pages; FR2-DOC-8, FR2-PAY-2),
//   creates the row as `uploading` and returns one signed upload token per file.
// - `finish` (the parent who began it): checks the stored files match what was declared and
//   marks the row `ready`. Until then nobody sees it (spec: "Upload fails halfway").
// - `read` (anyone who can see the document): checks `private.can_read_document` for the
//   caller, then signs read links with the service role that expire after 60 seconds. Clients
//   can't sign links themselves: the bucket has no client policy (R2-DOC-2, D-22).
// - `purge` (pg_cron, with DOCUMENTS_CRON_SECRET): removes stale uploads and deletes queued
//   folders from storage (R2-DOC-4, FR2-PRIV-2).
//
// Responses carry IDs and fixed codes only. Nothing about a document (title, category, file
// names or contents) is logged (NFR2-SEC-2, FR2-DOC-11).

import { bearerToken } from '../_shared/admin.ts';
import { errorResponse, jsonResponse } from '../_shared/http.ts';
import type { DocumentStorage } from './storage.ts';

export type Mime = 'application/pdf' | 'image/jpeg' | 'image/png';

export interface Limits {
  free_documents: number;
  premium_bytes: number;
  file_bytes: number;
  pages: number;
  read_seconds: number;
}

export interface UploadContext {
  role: 'parent' | 'family' | 'caregiver' | null;
  premium: boolean;
  documents: number;
  bytes: number;
  limits: Limits;
}

export interface StoredDocument {
  id: string;
  household_id: string;
  mime: Mime;
  page_count: number;
  size_bytes: number;
  status: 'uploading' | 'ready';
  created_by: string | null;
  deleted_at: string | null;
}

export type NewDocument = Omit<StoredDocument, 'deleted_at'> & {
  title: string;
  category: string;
  person_id: string | null;
  expires_on: string | null;
};

export interface DocumentsDeps {
  /** The `DOCUMENTS_CRON_SECRET` secret; `purge` refuses to run without one. */
  cronSecret: string | undefined;
  authenticate(accessToken: string): Promise<string | null>;
  context(caller: string, household: string): Promise<UploadContext>;
  /** Inserts as the service role: `exists` for a taken ID, `limit` or `invalid` from the database. */
  create(row: NewDocument): Promise<'ok' | 'exists' | 'limit' | 'invalid'>;
  find(id: string): Promise<StoredDocument | null>;
  /** `private.can_read_document(id)` evaluated for the caller. */
  canRead(caller: string, id: string): Promise<boolean>;
  markReady(id: string): Promise<void>;
  storage: DocumentStorage;
  removeStale(): Promise<number>;
  claimPurge(batch: number): Promise<{ id: number; prefix: string }[]>;
  finishPurge(ids: number[]): Promise<void>;
  log?: (event: string, fields: Record<string, number>) => void;
}

export const CATEGORIES = [
  'doc.insurance',
  'doc.identity',
  'doc.childcare_school',
  'doc.medical',
  'doc.household',
  'doc.other',
];
const EXTENSIONS: Record<Mime, string> = {
  'application/pdf': 'pdf',
  'image/jpeg': 'jpg',
  'image/png': 'png',
};
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const PURGE_BATCH = 50;

/** A document's files: <household>/<document>/<page>.<ext>, pages from 1 (R2-DOC-1). */
export function filePaths(
  doc: Pick<StoredDocument, 'household_id' | 'id' | 'mime' | 'page_count'>,
) {
  return Array.from(
    { length: doc.page_count },
    (_, i) => `${doc.household_id}/${doc.id}/${i + 1}.${EXTENSIONS[doc.mime]}`,
  );
}

function sameSecret(a: string, b: string): boolean {
  const left = new TextEncoder().encode(a);
  const right = new TextEncoder().encode(b);
  let diff = left.length ^ right.length;
  for (let i = 0; i < Math.max(left.length, right.length); i++) {
    diff |= (left[i] ?? 0) ^ (right[i] ?? 0);
  }
  return diff === 0;
}

const isUuid = (value: unknown): value is string => typeof value === 'string' && UUID.test(value);
const optional = (value: unknown, test: (v: unknown) => boolean) =>
  value === undefined || value === null || test(value);

export function createHandler(deps: DocumentsDeps): (req: Request) => Promise<Response> {
  const log = deps.log ?? ((event, fields) => console.log(JSON.stringify({ event, ...fields })));

  async function begin(caller: string, body: Record<string, unknown>): Promise<Response> {
    const { household_id, document_id, title, category, person_id, expires_on, mime, files } = body;
    if (
      !isUuid(household_id) ||
      !isUuid(document_id) ||
      typeof title !== 'string' ||
      title.trim().length < 1 ||
      title.trim().length > 200 ||
      !CATEGORIES.includes(category as string) ||
      !optional(person_id, isUuid) ||
      !optional(expires_on, (v) => typeof v === 'string' && DATE.test(v)) ||
      !(typeof mime === 'string' && mime in EXTENSIONS) ||
      !Array.isArray(files) ||
      files.length < 1 ||
      !files.every((f) => Number.isSafeInteger(f?.size) && f.size > 0)
    ) {
      return errorResponse('documents.invalid', 400);
    }
    const sizes = files.map((f) => f.size as number);
    // A PDF or an image is one file; scans are pages.
    if (mime !== 'image/jpeg' && sizes.length !== 1) return errorResponse('documents.invalid', 400);

    const ctx = await deps.context(caller, household_id);
    if (ctx.role !== 'parent') return errorResponse('documents.forbidden', 403);
    if (sizes.length > ctx.limits.pages) return errorResponse('documents.too_many_pages', 413);
    if (sizes.some((size) => size > ctx.limits.file_bytes)) {
      return errorResponse('documents.file_too_large', 413);
    }
    const total = sizes.reduce((sum, size) => sum + size, 0);
    // The Premium sheet opens on `documents.limit` (FR2-PAY-1 trigger `documents`).
    if (
      ctx.premium
        ? ctx.bytes + total > ctx.limits.premium_bytes
        : ctx.documents >= ctx.limits.free_documents
    ) {
      return errorResponse('documents.limit', 402);
    }

    const row: NewDocument = {
      id: document_id,
      household_id,
      title: title.trim(),
      category: category as string,
      person_id: (person_id as string | undefined) ?? null,
      expires_on: (expires_on as string | undefined) ?? null,
      mime: mime as Mime,
      page_count: sizes.length,
      size_bytes: total,
      status: 'uploading',
      created_by: caller,
    };
    const created = await deps.create(row);
    if (created === 'exists') return errorResponse('documents.exists', 409);
    if (created === 'limit') return errorResponse('documents.limit', 402);
    if (created === 'invalid') return errorResponse('documents.invalid', 400);

    const uploads = await Promise.all(
      filePaths(row).map(async (path) => ({ path, token: await deps.storage.signUpload(path) })),
    );
    log('documents.begin', { pages: sizes.length });
    return jsonResponse({ document_id, uploads });
  }

  async function finish(caller: string, body: Record<string, unknown>): Promise<Response> {
    if (!isUuid(body.document_id)) return errorResponse('documents.invalid', 400);
    const doc = await deps.find(body.document_id);
    if (!doc || doc.deleted_at || doc.created_by !== caller) {
      return errorResponse('documents.not_found', 404);
    }
    if (doc.status === 'ready') return jsonResponse({ document_id: doc.id, status: 'ready' });
    const ctx = await deps.context(caller, doc.household_id);
    if (ctx.role !== 'parent') return errorResponse('documents.forbidden', 403);

    const stored = new Map(
      (await deps.storage.list(`${doc.household_id}/${doc.id}`)).map((f) => [f.name, f.size]),
    );
    const expected = filePaths(doc).map((path) => path.split('/')[2]);
    const sizes = expected.map((name) => stored.get(name));
    if (
      stored.size !== expected.length ||
      sizes.some((size) => size === undefined || size > ctx.limits.file_bytes) ||
      sizes.reduce((sum: number, size) => sum + (size ?? 0), 0) !== doc.size_bytes
    ) {
      return errorResponse('documents.upload_incomplete', 409);
    }
    await deps.markReady(doc.id);
    log('documents.finish', { pages: doc.page_count });
    return jsonResponse({ document_id: doc.id, status: 'ready' });
  }

  async function read(caller: string, body: Record<string, unknown>) {
    if (!isUuid(body.document_id)) return errorResponse('documents.invalid', 400);
    const doc = await deps.find(body.document_id);
    // A refusal answers like a missing document, so nothing leaks about other households.
    if (!doc || doc.deleted_at || doc.status !== 'ready' || !(await deps.canRead(caller, doc.id))) {
      return errorResponse('documents.not_found', 404);
    }
    const { limits } = await deps.context(caller, doc.household_id);
    const links = await Promise.all(
      filePaths(doc).map((path) => deps.storage.signRead(path, limits.read_seconds)),
    );
    if (links.some((link) => link === null)) return errorResponse('documents.not_found', 404);
    return jsonResponse({
      document_id: doc.id,
      mime: doc.mime,
      expires_in: limits.read_seconds,
      links,
    });
  }

  async function purge(): Promise<Response> {
    const stale = await deps.removeStale();
    let folders = 0;
    let files = 0;
    let failed = 0;
    for (;;) {
      const claimed = await deps.claimPurge(PURGE_BATCH);
      if (claimed.length === 0) break;
      const done: number[] = [];
      for (const { id, prefix } of claimed) {
        try {
          const folder = prefix.replace(/\/$/, '');
          const names = (await deps.storage.list(folder)).map((f) => `${folder}/${f.name}`);
          await deps.storage.remove(names);
          files += names.length;
          done.push(id);
        } catch {
          // Left claimed; claim_storage_purge offers it again after 10 minutes.
          failed++;
        }
      }
      await deps.finishPurge(done);
      folders += done.length;
      if (claimed.length < PURGE_BATCH) break;
    }
    log('documents.purge', { stale, folders, files, failed });
    return jsonResponse({ stale, folders, files, failed });
  }

  return async (req) => {
    if (req.method !== 'POST') return errorResponse('documents.method_not_allowed', 405);
    let body: Record<string, unknown>;
    try {
      body = await req.json();
    } catch {
      return errorResponse('documents.invalid', 400);
    }
    if (body === null || typeof body !== 'object') return errorResponse('documents.invalid', 400);
    const token = bearerToken(req);

    if (body.action === 'purge') {
      if (!deps.cronSecret) return errorResponse('documents.not_configured', 503);
      if (!token || !sameSecret(token, deps.cronSecret)) {
        return errorResponse('documents.unauthorized', 401);
      }
      return purge();
    }

    const caller = token ? await deps.authenticate(token) : null;
    if (!caller) return errorResponse('documents.unauthorized', 401);
    try {
      if (body.action === 'begin') return await begin(caller, body);
      if (body.action === 'finish') return await finish(caller, body);
      if (body.action === 'read') return await read(caller, body);
    } catch {
      log('documents.error', {});
      return errorResponse('documents.unavailable', 503);
    }
    return errorResponse('documents.invalid', 400);
  };
}
