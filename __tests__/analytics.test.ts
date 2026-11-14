import PostHog from 'posthog-react-native';

import {
  filterOutgoing,
  isAnalyticsOptedOut,
  OPT_OUT_KEY,
  resetAnalytics,
  setAnalyticsClientForTests,
  setAnalyticsContext,
  setAnalyticsOptOut,
  track,
  type AnalyticsClient,
} from '@/lib/analytics/client';
import {
  ANALYTICS_EVENTS,
  AnalyticsSchemaError,
  validateEvent,
  type PropertySpec,
} from '@/lib/analytics/schema';

const HOUSEHOLD = '0b5f7a52-3c41-4f0e-9d8e-2b6a1c9e7f10';
const RECIPE = '6f1d2c3b-4a59-4e68-8b7c-9d0e1f2a3b4c';

function fakeClient(): jest.Mocked<AnalyticsClient> {
  return {
    capture: jest.fn(),
    identify: jest.fn(),
    register: jest.fn(async () => undefined),
    unregister: jest.fn(async () => undefined),
    reset: jest.fn(),
    optIn: jest.fn(async () => undefined),
    optOut: jest.fn(async () => undefined),
    flush: jest.fn(async () => undefined),
  } as unknown as jest.Mocked<AnalyticsClient>;
}

beforeEach(() => {
  localStorage.removeItem(OPT_OUT_KEY);
});

afterAll(() => setAnalyticsClientForTests(undefined));

describe('analytics schema (NFR-SEC-6)', () => {
  it('accepts IDs, counts, durations and fixed values', () => {
    expect(validateEvent('signed_in', { method: 'apple', is_new_device: true })).toEqual({
      method: 'apple',
      is_new_device: true,
    });
    expect(validateEvent('starter_recipe_copied', { recipe_id: RECIPE })).toBeTruthy();
    expect(
      validateEvent('list_item_checked', { offline: false, section_id: 'section.dairy' }),
    ).toBeTruthy();
    expect(validateEvent('onboarding_completed', { duration_seconds: 42.5 })).toBeTruthy();
    expect(validateEvent('signed_out')).toEqual({});
  });

  it.each([
    ['a name in an ID', 'starter_recipe_copied', { recipe_id: 'Granny’s lasagne' }],
    [
      'free text in a code',
      'sign_in_failed',
      { method: 'email', error_code: 'No account for Sam' },
    ],
    ['an email in a code', 'sign_in_failed', { method: 'email', error_code: 'sam@example.com' }],
    ['a value outside a fixed set', 'invite_failed', { reason: 'Ava already joined' }],
    ['text in a count', 'recipe_search_used', { results_count: 'lasagne', has_tag_filter: true }],
    ['a negative count', 'recipe_search_used', { results_count: -1, has_tag_filter: true }],
    ['a fractional count', 'recipe_search_used', { results_count: 1.5, has_tag_filter: true }],
    ['a string for a flag', 'have_marked', { surface: 'list', extra: 'x' }],
    ['an extra property', 'signed_out', { recipe_title: 'Lasagne' }],
    ['a missing property', 'signed_in', { method: 'email' }],
    ['an object', 'signed_up', { method: { name: 'Sam' } }],
  ])('rejects %s', (_label, event, properties) => {
    expect(() => validateEvent(event, properties)).toThrow(AnalyticsSchemaError);
  });

  it('rejects events that are not in the schema', () => {
    expect(() => validateEvent('child_named', {})).toThrow(AnalyticsSchemaError);
    expect(() => validateEvent('toString', {})).toThrow(AnalyticsSchemaError);
  });

  it('names the property in errors, never the value', () => {
    expect(() => validateEvent('invite_failed', { reason: 'Ava Smith' })).toThrow(
      expect.objectContaining({ message: expect.not.stringContaining('Ava') }),
    );
  });

  it('gives every property a kind that cannot hold free text', () => {
    const allowed = new Set(['id', 'code', 'count', 'duration', 'bool', 'oneOf']);
    for (const [event, specs] of Object.entries(ANALYTICS_EVENTS)) {
      expect(event).toMatch(/^[a-z]+(_[a-z]+)*$/);
      for (const spec of Object.values(specs) as PropertySpec[]) {
        expect(allowed.has(spec.kind)).toBe(true);
      }
    }
  });

  it('types properties from the schema', () => {
    const client = fakeClient();
    setAnalyticsClientForTests(client);
    // @ts-expect-error: not a method the schema allows
    expect(() => track('signed_up', { method: 'facebook' })).toThrow(AnalyticsSchemaError);
    // @ts-expect-error: unknown event
    expect(() => track('child_named')).toThrow(AnalyticsSchemaError);
    // @ts-expect-error: the property is required
    expect(() => track('signed_up')).toThrow(AnalyticsSchemaError);
    expect(client.capture).not.toHaveBeenCalled();
  });
});

describe('track (F-07.2)', () => {
  it('sends schema events', () => {
    const client = fakeClient();
    setAnalyticsClientForTests(client);
    expect(track('week_planned', { dinners_count: 5, days_until_week_start: 2 })).toBe(true);
    expect(client.capture).toHaveBeenCalledWith('week_planned', {
      dinners_count: 5,
      days_until_week_start: 2,
    });
  });

  it('does nothing without a PostHog key', () => {
    setAnalyticsClientForTests(null);
    expect(track('signed_out')).toBe(false);
  });

  it('sets only fixed household context on every event', () => {
    const client = fakeClient();
    setAnalyticsClientForTests(client);
    setAnalyticsContext({
      householdId: HOUSEHOLD,
      role: 'parent',
      region: 'GB',
      locale: 'en-GB',
      tier: 'premium',
    });
    expect(client.register).toHaveBeenCalledWith({
      household_id: HOUSEHOLD,
      role: 'parent',
      region: 'GB',
      locale: 'en-GB',
      tier: 'premium',
    });
    setAnalyticsContext({
      householdId: 'The Lees',
      role: 'parent',
      region: 'US',
      locale: 'en-US',
    });
    expect(client.register).toHaveBeenLastCalledWith({
      role: 'parent',
      region: 'US',
      locale: 'en-US',
    });
  });
});

describe('opting out (FR-PRIV-5)', () => {
  it('stops every event on this device', async () => {
    const client = fakeClient();
    setAnalyticsClientForTests(client);
    await setAnalyticsOptOut(true);
    expect(isAnalyticsOptedOut()).toBe(true);
    expect(client.optOut).toHaveBeenCalled();
    expect(track('signed_out')).toBe(false);
    expect(track('week_planned', { dinners_count: 5, days_until_week_start: 2 })).toBe(false);
    expect(client.capture).not.toHaveBeenCalled();
  });

  it('stays opted out after sign-out', async () => {
    const client = fakeClient();
    setAnalyticsClientForTests(client);
    await setAnalyticsOptOut(true);
    await resetAnalytics();
    expect(client.reset).toHaveBeenCalled();
    expect(client.optOut).toHaveBeenCalledTimes(2);
    expect(track('signed_out')).toBe(false);
  });

  it('sends analytics_opt_out_changed only when opting back in', async () => {
    const client = fakeClient();
    setAnalyticsClientForTests(client);
    await setAnalyticsOptOut(true);
    await setAnalyticsOptOut(false);
    expect(client.optIn).toHaveBeenCalled();
    expect(client.capture.mock.calls).toEqual([
      ['analytics_opt_out_changed', { opted_out: false }],
    ]);
  });
});

describe('outgoing filter', () => {
  it('drops SDK events and properties that could identify the user', () => {
    expect(filterOutgoing({ event: 'Application Opened', properties: { url: 'x?code=1' } })).toBe(
      null,
    );
    expect(filterOutgoing({ event: '$screen', properties: { $screen_name: 'Ava' } })).toBe(null);
    expect(
      filterOutgoing({
        event: 'signed_out',
        properties: { $device_name: 'Sam’s iPhone', $set: { email: 'x' }, $os: 'iOS' },
      }),
    ).toEqual({ event: 'signed_out', properties: { $os: 'iOS' } });
  });
});

describe('offline queue (F-07.2)', () => {
  const realFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  it('keeps events while offline and sends them once back online', async () => {
    const stored = new Map<string, string>();
    const bodies: string[] = [];
    let online = false;
    // The SDK logs the failed flush; that's the offline case this test sets up.
    const logged = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    globalThis.fetch = jest.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      if (!online) throw new TypeError('Network request failed');
      if (String(url).includes('/batch')) bodies.push(String(init?.body));
      return new Response('{}', { status: 200 });
    }) as typeof fetch;

    const posthog = new PostHog('phc_test', {
      host: 'https://us.i.posthog.com',
      customStorage: {
        getItem: (key) => stored.get(key) ?? null,
        setItem: (key, value) => void stored.set(key, value),
      },
      flushAt: 1,
      fetchRetryCount: 0,
      captureAppLifecycleEvents: false,
      disableRemoteConfig: true,
      preloadFeatureFlags: false,
      disableCompression: true,
    });
    await posthog.ready();
    setAnalyticsClientForTests(posthog);

    track('list_item_checked', { offline: true, section_id: 'section.produce' });
    await posthog.flush().catch(() => undefined);
    expect(bodies).toHaveLength(0);

    online = true;
    await posthog.flush();
    expect(bodies.join()).toContain('list_item_checked');
    await posthog.shutdown();
    logged.mockRestore();
  });
});
