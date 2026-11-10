/** Trims and lowercases an email address, so the same address always maps to one account (FR-AUTH-3). */
export function normalizeEmail(text: string): string {
  return text.trim().toLowerCase();
}

/**
 * A light check before asking the server: one @, something before it, and a dot in the
 * domain. The server has the final say.
 */
export function isValidEmail(text: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizeEmail(text));
}
