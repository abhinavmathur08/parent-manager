import { parseSupabaseConfig } from '@/lib/supabase-config';

describe('parseSupabaseConfig', () => {
  it('returns trimmed config when both values are valid', () => {
    expect(parseSupabaseConfig(' https://abc.supabase.co ', ' sb_publishable_x ')).toEqual({
      url: 'https://abc.supabase.co',
      publishableKey: 'sb_publishable_x',
    });
  });

  it.each([
    ['missing url', undefined, 'key'],
    ['missing key', 'https://abc.supabase.co', undefined],
    ['blank key', 'https://abc.supabase.co', '   '],
    ['url without a scheme', 'abc.supabase.co', 'key'],
    ['the .env.example placeholder url', 'your-project-url', 'key'],
  ])('returns null for %s', (_name, url, key) => {
    expect(parseSupabaseConfig(url, key)).toBeNull();
  });
});
