import { AuthApiError, AuthRetryableFetchError } from '@supabase/supabase-js';

import { policyUrl } from '@/constants/policy-links';
import { authErrorKey } from '@/features/auth/auth-errors';
import {
  isCodeLocked,
  MAX_WRONG_CODES,
  RESEND_INTERVAL_SECONDS,
  secondsUntilResend,
} from '@/features/auth/code-attempts';
import { isValidEmail, normalizeEmail } from '@/features/auth/email';
import { parseMagicLink } from '@/features/auth/email-sign-in';

jest.mock('@/lib/supabase', () => ({ getSupabase: jest.fn() }));

describe('email addresses (FR-AUTH-3)', () => {
  it('normalizes case and spaces so one address is one account', () => {
    expect(normalizeEmail('  Sam@Example.COM ')).toBe('sam@example.com');
  });

  it.each([
    ['sam@example.com', true],
    [' sam@example.co.uk ', true],
    ['sam@example', false],
    ['sam example.com', false],
    ['@example.com', false],
    ['', false],
  ])('%p is valid: %p', (email, valid) => {
    expect(isValidEmail(email)).toBe(valid);
  });
});

describe('code attempts and resend timer (FR-AUTH-2)', () => {
  it('allows a new code every 30 seconds', () => {
    expect(RESEND_INTERVAL_SECONDS).toBe(30);
    expect(secondsUntilResend(1_000, 1_000)).toBe(30);
    expect(secondsUntilResend(1_000, 7_500)).toBe(24);
    expect(secondsUntilResend(1_000, 31_000)).toBe(0);
    expect(secondsUntilResend(1_000, 999_000)).toBe(0);
  });

  it('locks the code after 5 wrong tries', () => {
    expect(MAX_WRONG_CODES).toBe(5);
    expect(isCodeLocked(4)).toBe(false);
    expect(isCodeLocked(5)).toBe(true);
  });
});

describe('authErrorKey', () => {
  it('maps Supabase error codes to translation keys', () => {
    expect(authErrorKey(new AuthApiError('Token has expired', 403, 'otp_expired'))).toBe(
      'invalidCode',
    );
    expect(authErrorKey(new AuthApiError('Too many', 429, 'over_email_send_rate_limit'))).toBe(
      'tooManyRequests',
    );
    expect(authErrorKey(new AuthApiError('Slow down', 429, undefined))).toBe('tooManyRequests');
    expect(authErrorKey(new AuthApiError('Bad', 400, 'email_address_invalid'))).toBe(
      'invalidEmail',
    );
    expect(authErrorKey(new AuthRetryableFetchError('Failed to fetch', 0))).toBe('network');
    expect(authErrorKey(new TypeError('Network request failed'))).toBe('network');
    expect(authErrorKey(new Error('boom'))).toBe('generic');
  });
});

describe('parseMagicLink', () => {
  it('reads the tokens from the fragment', () => {
    expect(
      parseMagicLink(
        'parentmanager://auth-callback#access_token=a.b.c&expires_in=3600&refresh_token=r1&type=magiclink',
      ),
    ).toEqual({ kind: 'session', accessToken: 'a.b.c', refreshToken: 'r1' });
  });

  it('reports an expired or used link as an error', () => {
    expect(
      parseMagicLink(
        'parentmanager://auth-callback#error=access_denied&error_code=otp_expired&error_description=x',
      ),
    ).toEqual({ kind: 'error' });
  });

  it('ignores a link without tokens', () => {
    expect(parseMagicLink(null)).toEqual({ kind: 'none' });
    expect(parseMagicLink('parentmanager://auth-callback')).toEqual({ kind: 'none' });
  });
});

describe('policyUrl (FR-PRIV-6)', () => {
  it('is null until there is a site', () => {
    expect(policyUrl('terms', 'en-US', null)).toBeNull();
  });

  it('points at the page in the user locale', () => {
    expect(policyUrl('privacy', 'en-GB', 'https://example.com/legal/')).toBe(
      'https://example.com/legal/en-gb/privacy',
    );
  });
});
