import { isAuthError, isAuthRetryableFetchError } from '@supabase/supabase-js';

/** Translation keys under `auth.errors`, so screens never show the server's English text. */
export type AuthErrorKey =
  'invalidCode' | 'tooManyRequests' | 'network' | 'invalidEmail' | 'signUpDisabled' | 'generic';

const BY_CODE: Record<string, AuthErrorKey> = {
  otp_expired: 'invalidCode',
  otp_disabled: 'generic',
  over_email_send_rate_limit: 'tooManyRequests',
  over_request_rate_limit: 'tooManyRequests',
  email_address_invalid: 'invalidEmail',
  email_address_not_authorized: 'invalidEmail',
  validation_failed: 'invalidEmail',
  signup_disabled: 'signUpDisabled',
};

/** Maps a Supabase Auth error (or anything thrown) to a translation key. */
export function authErrorKey(error: unknown): AuthErrorKey {
  if (isAuthRetryableFetchError(error)) return 'network';
  if (error instanceof TypeError && /network/i.test(error.message)) return 'network';
  if (isAuthError(error)) {
    if (error.code && BY_CODE[error.code]) return BY_CODE[error.code];
    if (error.status === 429) return 'tooManyRequests';
  }
  return 'generic';
}
