import type { Breadcrumb, ErrorEvent, TransactionEvent } from '@sentry/react-native';

import { sentryPlugin } from '../app.config';

// The root mock (__mocks__/@sentry/react-native.ts) stands in for the SDK.
type CrashReporting = typeof import('@/lib/crash-reporting');
type SentryMock = {
  init: jest.Mock;
  wrap: jest.Mock;
  setUser: jest.Mock;
  captureException: jest.Mock;
};

/** Loads the module fresh with the given DSN, since it reads the variable once. */
function load(dsn: string | undefined): { reporting: CrashReporting; sentry: SentryMock } {
  const previous = process.env.EXPO_PUBLIC_SENTRY_DSN;
  if (dsn === undefined) delete process.env.EXPO_PUBLIC_SENTRY_DSN;
  else process.env.EXPO_PUBLIC_SENTRY_DSN = dsn;
  let loaded!: { reporting: CrashReporting; sentry: SentryMock };
  jest.isolateModules(() => {
    loaded = {
      reporting: require('@/lib/crash-reporting'),
      sentry: require('@sentry/react-native'),
    };
  });
  if (previous === undefined) delete process.env.EXPO_PUBLIC_SENTRY_DSN;
  else process.env.EXPO_PUBLIC_SENTRY_DSN = previous;
  return loaded;
}

const { reporting } = load(undefined);
const { redactText, scrubBreadcrumb, scrubEvent, scrubUrl } = reporting;

describe('crash reporting without a DSN (D-4)', () => {
  it('does nothing at all', () => {
    const { reporting: off, sentry } = load(undefined);
    const Root = () => null;
    off.initCrashReporting();
    off.setCrashUser('user-1');
    off.reportError(new Error('boom'));
    expect(off.wrapRoot(Root)).toBe(Root);
    expect(off.crashReportingEnabled()).toBe(false);
    expect(sentry.init).not.toHaveBeenCalled();
    expect(sentry.setUser).not.toHaveBeenCalled();
    expect(sentry.captureException).not.toHaveBeenCalled();
  });

  it('treats a blank DSN as absent', () => {
    expect(load('  ').reporting.crashReportingEnabled()).toBe(false);
  });
});

describe('crash reporting with a DSN (F-07.1)', () => {
  it('starts Sentry with personal data off and the scrubbers on', () => {
    const { reporting: on, sentry } = load('https://public@example.ingest.sentry.io/1');
    on.initCrashReporting();
    expect(sentry.init).toHaveBeenCalledTimes(1);
    const options = sentry.init.mock.calls[0][0];
    expect(options).toMatchObject({
      dsn: 'https://public@example.ingest.sentry.io/1',
      sendDefaultPii: false,
      attachScreenshot: false,
      attachViewHierarchy: false,
      replaysSessionSampleRate: 0,
      replaysOnErrorSampleRate: 0,
    });
    expect(typeof options.beforeSend).toBe('function');
    expect(typeof options.beforeSendTransaction).toBe('function');
    expect(typeof options.beforeBreadcrumb).toBe('function');
    const sent = options.beforeSend({
      user: { id: 'u1', email: 'sam@example.com' },
    } as ErrorEvent);
    expect(sent.user).toEqual({ id: 'u1' });
  });

  it('sets only the user ID', () => {
    const { reporting: on, sentry } = load('https://public@example.ingest.sentry.io/1');
    on.setCrashUser('user-1');
    on.setCrashUser(null);
    expect(sentry.setUser.mock.calls).toEqual([[{ id: 'user-1' }], [null]]);
  });
});

describe('scrubbing user content (NFR-SEC-6)', () => {
  it('redacts emails, double-quoted text and Postgres key details', () => {
    expect(redactText('No account for sam.lee+1@example.co.uk')).toBe('No account for [redacted]');
    expect(redactText('Could not parse "Granny’s lasagne"')).toBe('Could not parse [redacted]');
    expect(redactText('Key (name)=(Ava Smith) already exists.')).toBe(
      'Key (name)=([redacted]) already exists.',
    );
    expect(redactText('Cannot add “Ava’s milk” to the list')).toBe(
      'Cannot add [redacted] to the list',
    );
  });

  it("keeps engine messages, which quote code, not the user's words", () => {
    const message = "undefined is not an object (evaluating 'recipe.title')";
    expect(redactText(message)).toBe(message);
  });

  it('drops query strings and fragments from URLs', () => {
    expect(scrubUrl('https://x.supabase.co/rest/v1/recipes?title=ilike.*lasagne*')).toBe(
      'https://x.supabase.co/rest/v1/recipes',
    );
    expect(scrubUrl('/join?code=ABC123')).toBe('/join');
    expect(scrubUrl('parentmanager://auth-callback#access_token=secret')).toBe(
      'parentmanager://auth-callback',
    );
    expect(scrubUrl('/plan')).toBe('/plan');
  });

  it('strips everything but the user ID, fixed contexts and redacted messages from events', () => {
    const event = {
      message: 'Failed for sam@example.com',
      user: { id: 'u1', email: 'sam@example.com', username: 'Sam', ip_address: '1.2.3.4' },
      request: { url: 'https://x/rest?name=eq.Ava', data: { name: 'Ava' }, cookies: { a: 'b' } },
      extra: { recipeText: 'Two eggs' },
      server_name: 'Sam’s iPhone',
      transaction: '/join?code=ABC123',
      exception: { values: [{ type: 'Error', value: 'Saving "Ava’s allergies" failed' }] },
      contexts: {
        device: { name: 'Sam’s iPhone', model: 'iPhone17,1' },
        os: { name: 'iOS', version: '26.1' },
        state: { household: { name: 'The Lees' } },
        profile: { display_name: 'Sam' },
      },
      breadcrumbs: [
        { category: 'console', message: 'Ava is allergic to peanuts' },
        {
          category: 'fetch',
          type: 'http',
          data: {
            method: 'GET',
            status_code: 200,
            url: 'https://x/rest/v1/items?name=eq.milk',
            body: 'secret',
          },
        },
        { category: 'touch', message: 'Touch event within element: Ava', data: { path: ['Ava'] } },
        { category: 'navigation', data: { from: '/join?code=1', to: '/plan' } },
      ],
    } as unknown as ErrorEvent;

    const scrubbed = scrubEvent(event);
    expect(scrubbed.message).toBe('Failed for [redacted]');
    expect(scrubbed.user).toEqual({ id: 'u1' });
    expect(scrubbed.request).toBeUndefined();
    expect(scrubbed.extra).toBeUndefined();
    expect(scrubbed.server_name).toBeUndefined();
    expect(scrubbed.transaction).toBe('/join');
    expect(scrubbed.exception?.values?.[0]).toEqual({
      type: 'Error',
      value: 'Saving [redacted] failed',
    });
    expect(scrubbed.contexts).toEqual({
      device: { name: undefined, model: 'iPhone17,1' },
      os: { name: 'iOS', version: '26.1' },
    });
    expect(scrubbed.breadcrumbs).toEqual([
      {
        category: 'fetch',
        type: 'http',
        data: { method: 'GET', status_code: 200, url: 'https://x/rest/v1/items' },
      },
      { category: 'touch', message: undefined, data: {} },
      { category: 'navigation', data: { from: '/join', to: '/plan' } },
    ]);
    // Nothing personal survives anywhere in the payload.
    const json = JSON.stringify(scrubbed);
    for (const leak of ['sam@', 'Ava', 'Sam', 'eggs', 'Lees', 'milk', 'ABC123', 'secret']) {
      expect(json).not.toContain(leak);
    }
  });

  it('drops queries from trace spans', () => {
    const transaction = {
      type: 'transaction',
      spans: [
        {
          description: 'GET https://x/rest/v1/recipes?title=eq.Lasagne',
          data: {
            url: 'https://x?title=Lasagne',
            'http.query': 'title=Lasagne',
            'http.method': 'GET',
          },
        },
      ],
    } as unknown as TransactionEvent;
    const json = JSON.stringify(scrubEvent(transaction));
    expect(json).not.toContain('Lasagne');
    expect(json).toContain('http.method');
  });

  it('drops console breadcrumbs as they arrive', () => {
    expect(scrubBreadcrumb({ category: 'console', message: 'x' } as Breadcrumb)).toBeNull();
  });
});

describe('Sentry config plugin (F-07.1)', () => {
  it('skips the source-map upload without an org and project, so builds still pass', () => {
    expect(sentryPlugin(undefined, undefined)).toEqual([
      '@sentry/react-native/expo',
      { disableAutoUpload: true },
    ]);
    expect(sentryPlugin('org', ' ')).toEqual([
      '@sentry/react-native/expo',
      { disableAutoUpload: true },
    ]);
  });

  it('uploads source maps once the org and project are set', () => {
    expect(sentryPlugin('parent-manager', 'app')).toEqual([
      '@sentry/react-native/expo',
      { organization: 'parent-manager', project: 'app' },
    ]);
  });
});
