import type { AppLocale, Region, UnitSystem } from '@/i18n';

export const REGIONS = ['US', 'GB', 'AU'] as const satisfies readonly Region[];

export type RegionSettings = {
  locale: AppLocale;
  unitSystem: UnitSystem;
  /** ISO weekday: 1 is Monday, 7 is Sunday. */
  weekStart: 1 | 7;
  currency: 'USD' | 'GBP' | 'AUD';
};

/**
 * What a region sets (FR-ONB-2, FR-ONB-3): locale, units, week start and currency. The
 * week start is Sunday in the US and Monday in GB and AU (PROPOSED).
 */
export const REGION_SETTINGS: Record<Region, RegionSettings> = {
  US: { locale: 'en-US', unitSystem: 'us_customary', weekStart: 7, currency: 'USD' },
  GB: { locale: 'en-GB', unitSystem: 'metric', weekStart: 1, currency: 'GBP' },
  AU: { locale: 'en-AU', unitSystem: 'metric', weekStart: 1, currency: 'AUD' },
};

// Nearby regions whose shoppers expect the same units, as in src/i18n/locale.ts.
const DEVICE_REGION: Record<string, Region> = { US: 'US', GB: 'GB', IE: 'GB', AU: 'AU', NZ: 'AU' };

/** The region to prefill from the device's preferred locales (FR-ONB-2), US if none match. */
export function deviceRegion(locales: readonly { regionCode?: string | null }[]): Region {
  for (const locale of locales) {
    const region = DEVICE_REGION[locale.regionCode?.toUpperCase() ?? ''];
    if (region) return region;
  }
  return 'US';
}

/** The device's IANA time zone (FR-ONB-3), UTC if it can't be read. */
export function deviceTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}
