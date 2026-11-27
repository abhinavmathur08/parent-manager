import type { SupabaseClient } from '@supabase/supabase-js';

import { NO_SESSION, RemoteError, createSupabaseRemote } from '@/lib/sync/remote';

// #336: right after sign-in, the first pulls sometimes went out without the member's token,
// so PostgREST ran them as `anon` and answered 401, and every retry did the same.

type Reply = { data: unknown; error: { message: string; code?: string } | null; status: number };

const OK: Reply = { data: [{ id: 'r1' }], error: null, status: 200 };
const ANON: Reply = {
  data: null,
  error: { message: 'permission denied for table items', code: '42501' },
  status: 401,
};

/** A Supabase client whose session and server replies the test controls. */
function fakeClient() {
  const state = {
    session: null as { access_token: string } | null,
    replies: [] as Reply[],
    sentWith: [] as (string | null)[],
    refreshes: 0,
    refreshTo: 'refreshed-token' as string | null,
  };
  // Like supabase-js, each request reads the session as it's sent.
  const query = {
    select: () => query,
    insert: () => query,
    eq: () => query,
    is: () => query,
    gte: () => query,
    or: () => query,
    order: () => query,
    limit: () => query,
    then(resolve: (reply: Reply) => unknown, reject: (error: unknown) => unknown) {
      state.sentWith.push(state.session?.access_token ?? null);
      const reply = state.replies.shift() ?? (state.session ? OK : ANON);
      return Promise.resolve(reply).then(resolve, reject);
    },
  };
  const client = {
    from: jest.fn(() => query),
    auth: {
      getSession: jest.fn(async () => ({ data: { session: state.session }, error: null })),
      refreshSession: jest.fn(async () => {
        state.refreshes += 1;
        await new Promise((resolve) => setTimeout(resolve, 1));
        if (!state.refreshTo) return { data: { session: null }, error: new Error('no session') };
        state.session = { access_token: state.refreshTo };
        return { data: { session: state.session }, error: null };
      }),
    },
  };
  return { state, client, remote: createSupabaseRemote(client as unknown as SupabaseClient) };
}

const page = { since: null, after: null, includeDeleted: false, limit: 500 };

describe('Supabase sync remote and the session (#336)', () => {
  it('sends nothing as anon before the session arrives', async () => {
    const { state, client, remote } = fakeClient();

    const pull = remote.fetchPage('items', 'h1', page);

    await expect(pull).rejects.toMatchObject({ status: 401, code: NO_SESSION });
    await expect(pull).rejects.toBeInstanceOf(RemoteError);
    expect(client.from).not.toHaveBeenCalled();
    expect(state.sentWith).toEqual([]);
  });

  it('uses the session that arrives after the remote was made', async () => {
    const { state, remote } = fakeClient();
    await expect(remote.fetchPage('items', 'h1', page)).rejects.toThrow();

    state.session = { access_token: 'member-token' };

    await expect(remote.fetchPage('items', 'h1', page)).resolves.toEqual(OK.data);
    expect(state.sentWith).toEqual(['member-token']);
  });

  it('refreshes the session once on a 401 and tries again', async () => {
    const { state, remote } = fakeClient();
    state.session = { access_token: 'stale-token' };
    state.replies.push(ANON);

    await expect(remote.fetchPage('items', 'h1', page)).resolves.toEqual(OK.data);
    expect(state.refreshes).toBe(1);
    expect(state.sentWith).toEqual(['stale-token', 'refreshed-token']);
  });

  it('shares one refresh between parallel pulls that got a 401', async () => {
    const { state, remote } = fakeClient();
    state.session = { access_token: 'stale-token' };
    state.replies.push(ANON, ANON, ANON);

    const pulls = ['a', 'b', 'c'].map((table) => remote.fetchPage(table, 'h1', page));

    await expect(Promise.all(pulls)).resolves.toEqual([OK.data, OK.data, OK.data]);
    expect(state.refreshes).toBe(1);
  });

  it('gives up after one refresh, leaving the 401 for the engine to wait on', async () => {
    const { state, remote } = fakeClient();
    state.session = { access_token: 'stale-token' };
    state.refreshTo = null;
    state.replies.push(ANON);

    await expect(remote.insert('items', [{ id: 'r1' }])).rejects.toMatchObject({
      status: 401,
      code: '42501',
    });
    expect(state.refreshes).toBe(1);
    expect(state.sentWith).toEqual(['stale-token']);
  });
});
