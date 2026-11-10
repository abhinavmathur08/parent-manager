/** Wrong codes allowed before the app asks for a new code (FR-AUTH-2). */
export const MAX_WRONG_CODES = 5;

/** A new code can be requested at most this often (FR-AUTH-2; `max_frequency` in config.toml). */
export const RESEND_INTERVAL_SECONDS = 30;

/** How long a code works (`otp_expiry` in config.toml). */
export const CODE_LIFETIME_MINUTES = 10;

/** Whole seconds until another code can be sent, never negative. */
export function secondsUntilResend(sentAt: number, now: number): number {
  const elapsed = Math.floor((now - sentAt) / 1000);
  return Math.max(0, RESEND_INTERVAL_SECONDS - elapsed);
}

/**
 * After this many wrong codes the code screen stops accepting the current code. Requesting
 * a new one replaces it on the server, so the old code stops working too.
 */
export function isCodeLocked(wrongAttempts: number): boolean {
  return wrongAttempts >= MAX_WRONG_CODES;
}
