import { getSupabase } from '@/lib/supabase';

let mockConfig: { url: string; publishableKey: string } | null = null;

jest.mock('@/lib/supabase-config', () => ({
  get supabaseConfig() {
    return mockConfig;
  },
}));
jest.mock('expo-sqlite/localStorage/install', () => ({}));
jest.mock('react-native-url-polyfill/auto', () => ({}));

describe('getSupabase', () => {
  beforeAll(() => {
    // Provided on device by expo-sqlite/localStorage/install, mocked above.
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      value: { getItem: jest.fn(), setItem: jest.fn(), removeItem: jest.fn() },
    });
  });

  it('throws a helpful error when the backend is not configured', () => {
    mockConfig = null;
    expect(() => getSupabase()).toThrow(/\.env\.example/);
  });

  it('creates one shared client when configured', () => {
    mockConfig = { url: 'https://abc.supabase.co', publishableKey: 'sb_publishable_x' };
    const client = getSupabase();
    expect(client.from).toEqual(expect.any(Function));
    expect(getSupabase()).toBe(client);
  });
});

describe('getSupabase session storage (F-08)', () => {
  it('stores the session encrypted, with its key in SecureStore', async () => {
    const items = new Map<string, string>();
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      value: {
        getItem: (key: string) => items.get(key) ?? null,
        setItem: (key: string, value: string) => void items.set(key, value),
        removeItem: (key: string) => void items.delete(key),
      },
    });
    mockConfig = { url: 'https://abc.supabase.co', publishableKey: 'sb_publishable_x' };
    let client: ReturnType<typeof getSupabase> | undefined;
    let secureStore: typeof import('expo-secure-store') | undefined;
    jest.isolateModules(() => {
      // A fresh module, so the client is created with the localStorage defined above.
      client = (require('@/lib/supabase') as typeof import('@/lib/supabase')).getSupabase();
      secureStore = require('expo-secure-store') as typeof import('expo-secure-store');
    });
    const storage = (
      client!.auth as unknown as { storage: { setItem: Function; getItem: Function } }
    ).storage;

    await storage.setItem('sb-abc-auth-token', '{"refresh_token":"secret-refresh"}');

    expect(items.get('sb-abc-auth-token')).toBeDefined();
    expect(items.get('sb-abc-auth-token')).not.toContain('secret-refresh');
    await expect(secureStore!.getItemAsync('sb-abc-auth-token.aes-key')).resolves.toMatch(
      /^[0-9a-f]{64}$/,
    );
    await expect(storage.getItem('sb-abc-auth-token')).resolves.toBe(
      '{"refresh_token":"secret-refresh"}',
    );
  });
});
