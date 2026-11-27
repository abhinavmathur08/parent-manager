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
  /** One row, or null if it doesn't exist or the caller can't see it. */
  fetchRow(table: string, id: string): Promise<SyncRow | null>;
  /** Rows by ID; ones that don't exist or the caller can't see are left out. */
  fetchRows(table: string, ids: readonly string[]): Promise<SyncRow[]>;
  /**
   * The IDs of the household's live rows of a scoped table that the caller can see now
   * (`public.visible_ids`, C-01.3).
   */
  visibleIds(table: string, householdId: string): Promise<string[]>;
  /** Creates rows; the server answers with them as stored. */
  insert(table: string, rows: readonly Record<string, unknown>[]): Promise<SyncRow[]>;
  /** Updates one row; null if the caller can't see or change it. */
  update(table: string, id: string, values: Record<string, unknown>): Promise<SyncRow | null>;
  /**
   * Listens for changes to the household's rows of `tables` (H-06.4). The server applies
   * RLS to each change, so a removed member stops receiving them. Returns a function that
   * stops listening.
   */
  subscribe(householdId: string, tables: readonly string[], listener: ChangeListener): () => void;
};

export type RealtimeState = 'off' | 'connecting' | 'connected';

export type ChangeListener = {
  onRow(table: string, row: SyncRow): void;
  onState(state: RealtimeState): void;
};

type Failure = { message: string; code?: string } | null;

export function toRemoteError(error: Failure, status: number): RemoteError {
  return new RemoteError(error?.message ?? 'Request failed', status, error?.code ?? '');
}

const ID_PAGE = 100;

// PostgREST filter values with punctuation (timestamps have `:` and `+`) must be quoted.
const literal = (value: string) => `"${value.replace(/"/g, '\\"')}"`;

type Reply<T> = { data: T | null; error: Failure; status: number };

/** Thrown instead of sending a request when there's no session on the device. */
export const NO_SESSION = 'no_session';

/** The Supabase-backed remote. RLS limits every request to the caller's households. */
export function createSupabaseRemote(client: SupabaseClient): SyncRemote {
  let refreshing: Promise<boolean> | null = null;

  // One refresh at a time, shared by the parallel pulls that got a 401 together.
  function refreshOnce(): Promise<boolean> {
    refreshing ??= client.auth.refreshSession().then(
      ({ error }) => !error,
      () => false,
    );
    const shared = refreshing;
    void shared.finally(() => {
      if (refreshing === shared) refreshing = null;
    });
    return shared;
  }

  /**
   * Sends a request as the member (#336). supabase-js reads the session for each request
   * and, without one, sends the publishable key, so the request runs as `anon` and every
   * table answers 401. So a request goes only once there's a session, and a 401 refreshes
   * the session once and tries again, rather than retrying as `anon`.
   */
  async function send<T>(request: () => PromiseLike<Reply<T>>): Promise<T | null> {
    const { data } = await client.auth.getSession();
    if (!data.session) throw new RemoteError('Not signed in', 401, NO_SESSION);
    let reply = await request();
    if (reply.status === 401 && (await refreshOnce())) reply = await request();
    if (reply.error) throw toRemoteError(reply.error, reply.status);
    return reply.data;
  }

  return {
    async fetchPage(table, householdId, { since, after, includeDeleted, limit }) {
      const data = await send(() => {
        let query = client.from(table).select('*').eq('household_id', householdId);
        if (since) query = query.gte('updated_at', since);
        if (!includeDeleted) query = query.is('deleted_at', null);
        if (after) {
          const at = literal(after.updatedAt);
          query = query.or(
            `updated_at.gt.${at},and(updated_at.eq.${at},id.gt.${literal(after.id)})`,
          );
        }
        return query
          .order('updated_at', { ascending: true })
          .order('id', { ascending: true })
          .limit(limit);
      });
      return (data ?? []) as SyncRow[];
    },

    async fetchRow(table, id) {
      const data = await send(() => client.from(table).select('*').eq('id', id).maybeSingle());
      return (data ?? null) as SyncRow | null;
    },

    async fetchRows(table, ids) {
      const rows: SyncRow[] = [];
      // Short pages, so the ID list fits in the request URL.
      for (let i = 0; i < ids.length; i += ID_PAGE) {
        const page = ids.slice(i, i + ID_PAGE);
        const data = await send(() => client.from(table).select('*').in('id', page));
        rows.push(...((data ?? []) as SyncRow[]));
      }
      return rows;
    },

    async visibleIds(table, householdId) {
      const data = await send(() =>
        client.rpc('visible_ids', { target: table, household: householdId }),
      );
      return (data ?? []) as string[];
    },

    async insert(table, rows) {
      const data = await send(() => client.from(table).insert(rows).select('*'));
      return (data ?? []) as SyncRow[];
    },

    async update(table, id, values) {
      const data = await send(() => client.from(table).update(values).eq('id', id).select('*'));
      return (((data ?? []) as SyncRow[])[0] ?? null) as SyncRow | null;
    },

    subscribe(householdId, tables, listener) {
      const channel = client.channel(`sync:${householdId}`);
      for (const table of tables) {
        channel.on(
          'postgres_changes',
          { event: '*', schema: 'public', table, filter: `household_id=eq.${householdId}` },
          (payload) => {
            // Rows are only ever soft-deleted, so inserts and updates carry everything.
            if (payload.eventType !== 'DELETE') listener.onRow(table, payload.new as SyncRow);
          },
        );
      }
      channel.subscribe((status) => {
        // The client rejoins by itself after an error or a timeout.
        if (status === 'SUBSCRIBED') listener.onState('connected');
        else if (status === 'CLOSED') listener.onState('off');
        else listener.onState('connecting');
      });
      listener.onState('connecting');
      return () => {
        void client.removeChannel(channel);
        listener.onState('off');
      };
    },
  };
}
