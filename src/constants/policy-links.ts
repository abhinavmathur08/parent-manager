import { DEFAULT_LOCALE, SUPPORTED_LOCALES, type AppLocale } from '@/i18n';

/**
 * Where the terms and privacy policy live (FR-PRIV-6). They need the product domain (D-2)
 * and the reviewed policies (L-01.2), so this is null until then and the sign-in screen
 * shows the agreement without links. Set it to the site's base URL, for example
 * `https://example.com/legal`; pages are `<base>/<locale>/terms` and `<base>/<locale>/privacy`.
 */
export const POLICY_BASE_URL: string | null = null;

export type PolicyKind = 'terms' | 'privacy';

/** The policy page in the user's locale, or null while there's no site. */
export function policyUrl(
  kind: PolicyKind,
  locale: AppLocale,
  base: string | null = POLICY_BASE_URL,
): string | null {
  if (!base) return null;
  return `${base.replace(/\/+$/, '')}/${locale.toLowerCase()}/${kind}`;
}

/** The policy page for the app's current language, falling back to the default locale. */
export function policyUrlForLanguage(
  kind: PolicyKind,
  language: string,
  base: string | null = POLICY_BASE_URL,
): string | null {
  const locale = (SUPPORTED_LOCALES as readonly string[]).includes(language)
    ? (language as AppLocale)
    : DEFAULT_LOCALE;
  return policyUrl(kind, locale, base);
}
