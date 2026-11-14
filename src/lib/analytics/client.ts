import 'expo-sqlite/localStorage/install';

import Constants from 'expo-constants';
import PostHog from 'posthog-react-native';
import { Platform } from 'react-native';

import { SUPPORTED_LOCALES, type AppLocale } from '@/i18n/locale';
import {
  ANALYTICS_EVENTS,
  REGIONS,
  ROLES,
  TIERS,
  validateEvent,
  type AnalyticsEvent,
  type AnalyticsProperties,
} from '@/lib/analytics/schema';
import { reportError } from '@/lib/crash-reporting';

/**
 * Product analytics through PostHog (F-07.2, NFR-OBS-2). Without `EXPO_PUBLIC_POSTHOG_KEY`
 * nothing is sent (D-4), so turning PostHog on needs only EAS environment variables. Every
 * event is checked against the schema before it leaves (NFR-SEC-6), session replay and
 * autocapture are off, and a member can opt this device out (FR-PRIV-5). Events wait in a
 * queue on the device while offline and send when the connection returns.
 */

// Expo inlines EXPO_PUBLIC_* at build time only for this exact dotted form.
const apiKey = process.env.EXPO_PUBLIC_POSTHOG_KEY?.trim() || undefined;
/** PostHog's US region by default (architecture section 9). */
const host = process.env.EXPO_PUBLIC_POSTHOG_HOST?.trim() || 'https://us.i.posthog.com';

/** The device's opt-out (FR-PRIV-5), kept even when PostHog is off so the setting sticks. */
export const OPT_OUT_KEY = 'analytics.opted_out';

/** Events the SDK sends itself that we allow: linking events to the signed-in user's ID. */
const SDK_EVENTS = new Set(['$identify', '$opt_in']);
/** SDK properties that can name the user or say where they are. */
const DROPPED_SDK_PROPERTIES = ['$device_name', '$current_url', '$screen_name', '$referrer', '$ip'];

/** What every event carries (spec section 3.0), apart from the platform and app version. */
export type AnalyticsContext = {
  householdId: string;
  role: (typeof ROLES)[number];
  region: (typeof REGIONS)[number];
  locale: AppLocale;
  tier?: (typeof TIERS)[number];
};

/** The parts of the PostHog client this module uses, so tests can stand in for it. */
export type AnalyticsClient = Pick<
  PostHog,
  'capture' | 'identify' | 'register' | 'unregister' | 'reset' | 'optIn' | 'optOut' | 'flush'
>;

const storage = {
  getItem: (key: string) => readStorage(key),
  setItem: (key: string, value: string) => writeStorage(key, value),
};

function readStorage(key: string): string | null {
  try {
    return globalThis.localStorage?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

function writeStorage(key: string, value: string): void {
  try {
    globalThis.localStorage?.setItem(key, value);
  } catch {
    // Storage unavailable: the queue lives in memory until the next launch.
  }
}

/** Drops anything the SDK adds that isn't ours to send. */
export function filterOutgoing<T extends { event: string; properties?: Record<string, unknown> }>(
  message: T | null,
): T | null {
  if (!message) return null;
  if (!SDK_EVENTS.has(message.event) && !Object.hasOwn(ANALYTICS_EVENTS, message.event)) {
    return null;
  }
  const properties = { ...message.properties };
  for (const key of DROPPED_SDK_PROPERTIES) delete properties[key];
  // Never person properties: the person is only their ID.
  delete properties.$set;
  delete properties.$set_once;
  return { ...message, properties };
}

function createClient(): AnalyticsClient | null {
  if (!apiKey) return null;
  return new PostHog(apiKey, {
    host,
    customStorage: storage,
    persistence: 'file',
    enableSessionReplay: false,
    captureAppLifecycleEvents: false,
    disableSurveys: true,
    disableGeoip: true,
    personProfiles: 'identified_only',
    defaultOptIn: !isAnalyticsOptedOut(),
    customAppProperties: (properties) => ({ ...properties, $device_name: null }),
    before_send: (message) => filterOutgoing(message),
  });
}

let client: AnalyticsClient | null | undefined;

function getClient(): AnalyticsClient | null {
  if (client === undefined) {
    client = createClient();
    if (client) registerDevice(client);
  }
  return client;
}

/** The platform and app version every event carries (spec section 3.0). */
function registerDevice(posthog: AnalyticsClient): void {
  void posthog.register({
    platform: Platform.OS,
    app_version: Constants.expoConfig?.version ?? 'unknown',
  });
}

/** Tests only: swaps in a client, or `undefined` to build the real one again. */
export function setAnalyticsClientForTests(next: AnalyticsClient | null | undefined): void {
  client = next;
}

/** Whether this device has turned analytics off (FR-PRIV-5). */
export function isAnalyticsOptedOut(): boolean {
  return readStorage(OPT_OUT_KEY) === 'true';
}

/**
 * Turns analytics off or on for this device (FR-PRIV-5). Opting out stops every event at
 * once. Opting back in sends `analytics_opt_out_changed`, the only time that event is sent.
 */
export async function setAnalyticsOptOut(optedOut: boolean): Promise<void> {
  writeStorage(OPT_OUT_KEY, String(optedOut));
  const posthog = getClient();
  if (optedOut) {
    await posthog?.optOut();
    return;
  }
  await posthog?.optIn();
  track('analytics_opt_out_changed', { opted_out: false });
}

/**
 * Sends an event. The properties are typed from the schema and checked again at runtime;
 * an event that doesn't fit is dropped and reported by name only, never with its values.
 * Returns whether it was queued.
 */
export function track<E extends AnalyticsEvent>(
  event: E,
  ...[properties]: keyof AnalyticsProperties<E> extends never
    ? [properties?: AnalyticsProperties<E>]
    : [properties: AnalyticsProperties<E>]
): boolean {
  if (isAnalyticsOptedOut()) return false;
  const posthog = getClient();
  if (!posthog) return false;
  let checked: Record<string, unknown>;
  try {
    checked = validateEvent(event, properties as Record<string, unknown> | undefined);
  } catch (error) {
    reportError(error);
    if (__DEV__) throw error;
    return false;
  }
  posthog.capture(event, checked as Record<string, string | number | boolean>);
  return true;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Ties events to the signed-in user's ID, and nothing else about them. */
export function identifyAnalyticsUser(userId: string): void {
  if (!UUID.test(userId)) return;
  getClient()?.identify(userId);
}

/**
 * Sets the household, role, region, locale and tier that every event carries (spec 3.0),
 * or clears them with null. Values outside their fixed sets are left out.
 */
export function setAnalyticsContext(context: AnalyticsContext | null): void {
  const posthog = getClient();
  if (!posthog) return;
  if (!context) {
    for (const key of ['household_id', 'role', 'region', 'locale', 'tier']) posthog.unregister(key);
    return;
  }
  const properties: Record<string, string> = {};
  if (UUID.test(context.householdId)) properties.household_id = context.householdId;
  if (ROLES.includes(context.role)) properties.role = context.role;
  if (REGIONS.includes(context.region)) properties.region = context.region;
  if (SUPPORTED_LOCALES.includes(context.locale)) properties.locale = context.locale;
  if (context.tier && TIERS.includes(context.tier)) properties.tier = context.tier;
  void posthog.register(properties);
}

/** On sign-out: forgets the user and household, and keeps the device's opt-out. */
export async function resetAnalytics(): Promise<void> {
  const posthog = getClient();
  if (!posthog) return;
  await posthog.flush().catch(() => undefined);
  posthog.reset();
  registerDevice(posthog);
  if (isAnalyticsOptedOut()) await posthog.optOut();
}

/** Whether events can be sent from this build. */
export function analyticsEnabled(): boolean {
  return apiKey !== undefined;
}
