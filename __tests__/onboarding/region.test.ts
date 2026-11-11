import { deviceRegion, REGION_SETTINGS } from '@/features/household/region';
import { regionDescription } from '@/features/onboarding/create-household-screen';
import { i18n } from '@/i18n';

jest.mock('@/lib/supabase', () => ({ getSupabase: jest.fn() }));
jest.mock('expo-network', () => ({ useNetworkState: jest.fn() }));

describe('region settings (FR-ONB-2, FR-ONB-3)', () => {
  it('sets locale, units, week start and currency', () => {
    expect(REGION_SETTINGS.US).toEqual({
      locale: 'en-US',
      unitSystem: 'us_customary',
      weekStart: 7,
      currency: 'USD',
    });
    expect(REGION_SETTINGS.GB).toEqual({
      locale: 'en-GB',
      unitSystem: 'metric',
      weekStart: 1,
      currency: 'GBP',
    });
    expect(REGION_SETTINGS.AU).toEqual({
      locale: 'en-AU',
      unitSystem: 'metric',
      weekStart: 1,
      currency: 'AUD',
    });
  });

  it('prefills the region from the device', () => {
    expect(deviceRegion([{ regionCode: 'gb' }])).toBe('GB');
    expect(deviceRegion([{ regionCode: 'NZ' }])).toBe('AU');
    expect(deviceRegion([{ regionCode: 'FR' }, { regionCode: 'IE' }])).toBe('GB');
    expect(deviceRegion([{ regionCode: 'FR' }])).toBe('US');
    expect(deviceRegion([])).toBe('US');
  });

  it('describes each region with its own units and week start', () => {
    const t = i18n.getFixedT('en-US');
    expect(regionDescription('US', t)).toBe('For example, 2 cups · Week starts Sunday');
    expect(regionDescription('GB', t)).toBe('For example, 475 ml · Week starts Monday');
    expect(regionDescription('AU', t)).toBe('For example, 475 ml · Week starts Monday');
  });
});
