// Edge Function `documents` (V-02.2): uploads, signed reads and the hourly purge. See handler.ts.
//
// Secrets, added by the product owner (never committed), once D-21 settles the hosted plan:
// - `DOCUMENTS_CRON_SECRET`: shared with pg_cron, which reads it from Vault
//   (`documents_cron_secret`) with the function's URL (`documents_function_url`).

import { adminClient, serviceKey } from '../_shared/admin.ts';
import { createHandler, type StoredDocument, type UploadContext } from './handler.ts';
import { documentStorage } from './storage.ts';

/** The publishable key the app uses, which Storage needs beside the caller's token. */
function publishableKey(): string {
  const keys = Deno.env.get('SUPABASE_PUBLISHABLE_KEYS');
  if (keys) {
    const key = Object.values(JSON.parse(keys) as Record<string, string>)[0];
    if (key) return key;
  }
  const legacy = Deno.env.get('SUPABASE_ANON_KEY');
  if (!legacy) throw new Error('No publishable key in the environment');
  return legacy;
}

const url = Deno.env.get('SUPABASE_URL')!;
const admin = adminClient(url);

async function rpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await admin.rpc(fn, args);
  if (error) throw new Error(`${fn} failed`);
  return data as T;
}

Deno.serve(
  createHandler({
    cronSecret: Deno.env.get('DOCUMENTS_CRON_SECRET'),
    authenticate: (token) => admin.userId(token),
    context: (caller, household) =>
      rpc<UploadContext>('document_upload_context', { caller, household }),
    async create(row) {
      const { error } = await admin.insert('documents', row);
      if (!error) return 'ok';
      if (error.code === '23505') return 'exists';
      if (error.hint === 'documents.limit') return 'limit';
      if (error.code === '23514' || error.code === '23503') return 'invalid';
      throw new Error('documents insert failed');
    },
    async find(id) {
      const { data, error } = await admin.select<StoredDocument>('documents', {
        id: `eq.${id}`,
        select: 'id,household_id,mime,page_count,size_bytes,status,created_by,deleted_at',
      });
      if (error) throw new Error('documents select failed');
      return data?.[0] ?? null;
    },
    async markReady(id) {
      const { error } = await admin.update(
        'documents',
        { id: `eq.${id}`, status: 'eq.uploading' },
        { status: 'ready' },
      );
      if (error) throw new Error('documents update failed');
    },
    storage: documentStorage(url, serviceKey(), publishableKey()),
    removeStale: () => rpc<number>('remove_stale_document_uploads', {}),
    claimPurge: (batch) => rpc<{ id: number; prefix: string }[]>('claim_storage_purge', { batch }),
    finishPurge: (ids) => rpc<void>('finish_storage_purge', { ids }),
  }),
);
