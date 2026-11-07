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
