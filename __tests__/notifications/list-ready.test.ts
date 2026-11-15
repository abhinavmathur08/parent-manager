import { act, renderHook, waitFor } from '@testing-library/react-native';

import { announceListReady, useListReady } from '@/features/notifications/list-ready';

let mockSentRows: unknown[] = [];
let mockRpcResult: { data: unknown; error: Error | null } = { data: 'sent', error: null };
const mockRpc = jest.fn(async (..._args: unknown[]) => mockRpcResult);
const mockEq = jest.fn();
jest.mock('@/lib/supabase', () => ({
  getSupabase: () => {
    const query = {
      select: () => query,
      eq: (...args: unknown[]) => {
        mockEq(...args);
        return query;
      },
      limit: async () => ({ data: mockSentRows, error: null }),
    };
    return { rpc: (...args: unknown[]) => mockRpc(...args), from: () => query };
  },
}));

beforeEach(() => {
  jest.clearAllMocks();
  mockSentRows = [];
  mockRpcResult = { data: 'sent', error: null };
});

describe('list is ready (FR-NOT-4)', () => {
  it('asks the server, which sends it once per list per day', async () => {
    expect(await announceListReady('2026-11-15', 'week_planned')).toBe('sent');
    expect(mockRpc).toHaveBeenCalledWith('announce_list_ready', {
      week: '2026-11-15',
      source: 'week_planned',
    });
    mockRpcResult = { data: 'already_sent', error: null };
    expect(await announceListReady('2026-11-15', 'button')).toBe('already_sent');
  });

  it('offers the button until the list was announced today', async () => {
    const hook = await renderHook(() => useListReady('hh', '2026-11-15', 'America/New_York'));
    await waitFor(() => expect(hook.result.current.state).toBe('ready'));
    expect(mockEq).toHaveBeenCalledWith('week_start', '2026-11-15');
    let ok = false;
    await act(async () => {
      ok = await hook.result.current.announce();
    });
    expect(ok).toBe(true);
    expect(hook.result.current.state).toBe('sent');
  });

  it('says it was sent when someone already announced it today', async () => {
    mockSentRows = [{ week_start: '2026-11-15' }];
    const hook = await renderHook(() => useListReady('hh', '2026-11-15', null));
    await waitFor(() => expect(hook.result.current.state).toBe('sent'));
  });

  it('lets the member try again when sending fails', async () => {
    mockRpcResult = { data: null, error: new Error('offline') };
    const hook = await renderHook(() => useListReady('hh', '2026-11-15', null));
    await waitFor(() => expect(hook.result.current.state).toBe('ready'));
    await act(async () => {
      await hook.result.current.announce();
    });
    expect(hook.result.current.state).toBe('ready');
  });
});
