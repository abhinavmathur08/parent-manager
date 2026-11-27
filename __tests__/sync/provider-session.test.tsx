import { act, render, waitFor } from '@testing-library/react-native';
import { AppState } from 'react-native';

import type { AuthState } from '@/features/auth/session';
import { SyncProvider } from '@/lib/sync/provider';

// #336: the tab layout mounts SyncProvider as soon as the household is known, which can be
// before the session reaches the app. A sync started then runs as `anon`.

let mockAuth: AuthState = { status: 'loading' };
const mockEngine = {
  open: jest.fn(async () => undefined),
  sync: jest.fn(async () => undefined),
  startRealtime: jest.fn(),
  stopRealtime: jest.fn(),
  stop: jest.fn(),
};

jest.mock('@/features/auth/session', () => ({ useAuth: () => mockAuth }));
jest.mock('@/features/auth/sign-out', () => ({ onSignOut: jest.fn() }));
jest.mock('@/hooks/use-online', () => ({ useOnline: () => true }));
jest.mock('@/lib/supabase', () => ({ getSupabase: () => ({}) }));
jest.mock('@/lib/sync/database', () => ({
  openSyncDatabase: async () => ({}),
  deleteSyncDatabase: async () => undefined,
}));
jest.mock('@/lib/sync/local-store', () => ({ LocalStore: jest.fn() }));
jest.mock('@/lib/sync/engine', () => ({ SyncEngine: jest.fn(() => mockEngine) }));

const SESSION = { user: { id: 'user-1' } } as Extract<AuthState, { status: 'signedIn' }>['session'];

async function renderProvider() {
  const view = await render(<SyncProvider householdId="h1">{null}</SyncProvider>);
  // The local copy opens asynchronously; the engine is handed out once it has.
  await waitFor(() => expect(mockEngine.open).toHaveBeenCalled());
  await act(async () => undefined);
  return view;
}

beforeEach(() => {
  mockAuth = { status: 'loading' };
  jest.clearAllMocks();
  // jest-expo's AppState mock has a function here; the app reads a status string.
  Object.defineProperty(AppState, 'currentState', { value: 'active', configurable: true });
});

describe('SyncProvider and the session (#336)', () => {
  it('opens the local copy but waits for the session before syncing', async () => {
    const view = await renderProvider();
    expect(mockEngine.open).toHaveBeenCalled();
    expect(mockEngine.sync).not.toHaveBeenCalled();
    expect(mockEngine.startRealtime).not.toHaveBeenCalled();

    mockAuth = { status: 'signedIn', session: SESSION };
    await view.rerender(<SyncProvider householdId="h1">{null}</SyncProvider>);

    await waitFor(() => expect(mockEngine.sync).toHaveBeenCalledTimes(1));
    expect(mockEngine.startRealtime).toHaveBeenCalledTimes(1);
  });

  it('stops talking to the server when the session goes', async () => {
    mockAuth = { status: 'signedIn', session: SESSION };
    const view = await renderProvider();
    await waitFor(() => expect(mockEngine.sync).toHaveBeenCalledTimes(1));

    mockAuth = { status: 'signedOut' };
    await view.rerender(<SyncProvider householdId="h1">{null}</SyncProvider>);

    expect(mockEngine.stopRealtime).toHaveBeenCalled();
    expect(mockEngine.sync).toHaveBeenCalledTimes(1);
  });
});
