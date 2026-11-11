import type { SupabaseClient } from '@supabase/supabase-js';

import type { SyncRow } from '@/lib/sync/types';

/** Where a page of a pull starts: after this row, in `updated_at`, `id` order. */
export type PageCursor = { updatedAt: string; id: string };

export type PageRequest = {
  /** Only rows changed at or after this time. Null lists the whole household. */
  since: string | null;
  after: PageCursor | null;
  /** A full list leaves deleted rows out; an incremental one needs them. */
  includeDeleted: boolean;
  limit: number;
};

/** A failed request. `status` is the HTTP status, or 0 when the network failed. */
export class RemoteError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
  ) {
    super(message);
    this.name = 'RemoteError';
  }
}

/** The server as the sync engine sees it, so tests can stand in for Supabase. */
export type SyncRemote = {
  fetchPage(table: string, householdId: string, request: PageRequest): Promise<SyncRow[]>;
};

type Failure = { message: string; code?: string } | null;

export function toRemoteError(error: Failure, status: number): RemoteError {
  return new RemoteError(error?.message ?? 'Request failed', status, error?.code ?? '');
}

// PostgREST filter values with punctuation (timestamps have `:` and `+`) must be quoted.
const literal = (value: string) => `"${value.replace(/"/g, '\\"')}"`;

/** The Supabase-backed remote. RLS limits every request to the caller's households. */
export function createSupabaseRemote(client: SupabaseClient): SyncRemote {
  return {
    async fetchPage(table, householdId, { since, after, includeDeleted, limit }) {
      let query = client.from(table).select('*').eq('household_id', householdId);
      if (since) query = query.gte('updated_at', since);
      if (!includeDeleted) query = query.is('deleted_at', null);
      if (after) {
        const at = literal(after.updatedAt);
        query = query.or(`updated_at.gt.${at},and(updated_at.eq.${at},id.gt.${literal(after.id)})`);
      }
      const { data, error, status } = await query
        .order('updated_at', { ascending: true })
        .order('id', { ascending: true })
        .limit(limit);
      if (error) throw toRemoteError(error, status);
      return (data ?? []) as SyncRow[];
    },
  };
}
