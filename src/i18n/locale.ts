export const SUPPORTED_LOCALES = ['en-US', 'en-GB', 'en-AU'] as const;
export type AppLocale = (typeof SUPPORTED_LOCALES)[number];

/** Pseudo-locale for development builds: accented, lengthened text (see pseudo.ts). */
export const PSEUDO_LOCALE = 'en-XA';

export const DEFAULT_LOCALE: AppLocale = 'en-US';

type DeviceLocale = { languageCode?: string | null; regionCode?: string | null };

const REGION_TO_LOCALE: Record<string, AppLocale> = {
  US: 'en-US',
  GB: 'en-GB',
  IE: 'en-GB',
  AU: 'en-AU',
  NZ: 'en-AU',
};

/**
 * Picks the app locale from the device's preferred locales (most preferred first).
 * Phase 1 ships English only, so the first English locale decides the variant.
 */
export function resolveLocale(deviceLocales: readonly DeviceLocale[]): AppLocale {
  const english = deviceLocales.find((l) => l.languageCode?.toLowerCase() === 'en');
  if (!english) return DEFAULT_LOCALE;
  return REGION_TO_LOCALE[english.regionCode?.toUpperCase() ?? ''] ?? DEFAULT_LOCALE;
}
