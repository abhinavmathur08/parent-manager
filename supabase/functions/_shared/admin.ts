// A small service-role client for Edge Functions, over fetch with no dependencies, so workers
// boot fast (supabase-js makes a cold worker download and compile a large module graph). The
// service key never leaves the server.

/** The service key: the new secret key if the project has one, otherwise the legacy one. */
export function serviceKey(): string {
  const keys = Deno.env.get('SUPABASE_SECRET_KEYS');
  if (keys) {
    const parsed = JSON.parse(keys) as Record<string, string>;
    const key = parsed.default ?? Object.values(parsed)[0];
    if (key) return key;
  }
  const legacy = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!legacy) throw new Error('No service key in the environment');
  return legacy;
}

/** The bearer token of a request, or null. */
export function bearerToken(req: Request): string | null {
  const match = /^Bearer\s+(\S+)$/i.exec(req.headers.get('Authorization') ?? '');
  return match ? match[1] : null;
}

export interface RestError {
  message: string;
  code?: string;
  hint?: string | null;
}

export type RestResult<T> = { data: T | null; error: RestError | null };

export interface AdminClient {
  /** The user ID for a valid access token, or null. */
  userId(accessToken: string): Promise<string | null>;
  /** Calls a public RPC as the service role. */
  rpc(fn: string, args: Record<string, unknown>): Promise<RestResult<unknown>>;
  /** GET /rest/v1/<table>?<query>, as the service role. */
  select<T>(table: string, query: Record<string, string>): Promise<RestResult<T[]>>;
  /** Inserts or updates on the primary key, as the service role. */
  upsert(table: string, row: Record<string, unknown>): Promise<RestResult<null>>;
  /** Inserts a new row, as the service role; an existing key is an error (23505). */
  insert(table: string, row: Record<string, unknown>): Promise<RestResult<null>>;
  /** PATCH /rest/v1/<table>?<query>, as the service role. */
  update(
    table: string,
    query: Record<string, string>,
    patch: Record<string, unknown>,
  ): Promise<RestResult<null>>;
}

export function adminClient(
  url = Deno.env.get('SUPABASE_URL')!,
  key = serviceKey(),
  fetcher: typeof fetch = fetch,
): AdminClient {
  const headers: Record<string, string> = { apikey: key, 'Content-Type': 'application/json' };
  // Legacy service_role keys are JWTs and go in Authorization too; new secret keys don't.
  if (key.startsWith('eyJ')) headers.Authorization = `Bearer ${key}`;

  async function call<T>(path: string, init: RequestInit): Promise<RestResult<T>> {
    const res = await fetcher(`${url}${path}`, {
      ...init,
      headers: { ...headers, ...(init.headers as Record<string, string>) },
    });
    const text = await res.text();
    const body = text ? JSON.parse(text) : null;
    if (!res.ok) {
      return {
        data: null,
        error: { message: body?.message ?? res.statusText, code: body?.code, hint: body?.hint },
      };
    }
    return { data: body as T, error: null };
  }

  return {
    async userId(accessToken) {
      const res = await fetcher(`${url}/auth/v1/user`, {
        headers: { apikey: key, Authorization: `Bearer ${accessToken}` },
      });
      if (!res.ok) {
        await res.body?.cancel();
        return null;
      }
      const user = (await res.json()) as { id?: string };
      return typeof user.id === 'string' ? user.id : null;
    },
    rpc(fn, args) {
      return call(`/rest/v1/rpc/${fn}`, { method: 'POST', body: JSON.stringify(args) });
    },
    select<T>(table: string, query: Record<string, string>) {
      return call<T[]>(`/rest/v1/${table}?${new URLSearchParams(query)}`, { method: 'GET' });
    },
    async upsert(table, row) {
      const result = await call<null>(`/rest/v1/${table}`, {
        method: 'POST',
        headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
        body: JSON.stringify(row),
      });
      return result;
    },
    insert(table, row) {
      return call<null>(`/rest/v1/${table}`, {
        method: 'POST',
        headers: { Prefer: 'return=minimal' },
        body: JSON.stringify(row),
      });
    },
    update(table, query, patch) {
      return call<null>(`/rest/v1/${table}?${new URLSearchParams(query)}`, {
        method: 'PATCH',
        headers: { Prefer: 'return=minimal' },
        body: JSON.stringify(patch),
      });
    },
  };
}
