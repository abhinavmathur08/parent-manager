import * as Sentry from '@sentry/react-native';
import Constants from 'expo-constants';
import * as Updates from 'expo-updates';
import type { ComponentType } from 'react';

/**
 * Crash reporting with Sentry (F-07.1, NFR-OBS-1). Without `EXPO_PUBLIC_SENTRY_DSN` every
 * function here does nothing, so turning Sentry on needs only EAS environment variables
 * (architecture section 9). Reports carry the user ID and nothing else personal (NFR-SEC-6):
 * `sendDefaultPii` is off, and the scrubbers below strip user content from events,
 * breadcrumbs and traces before they leave the device.
 */

// Expo inlines EXPO_PUBLIC_* at build time only for this exact dotted form.
const dsn = process.env.EXPO_PUBLIC_SENTRY_DSN?.trim() || undefined;

/** Share of sessions that send performance traces (NFR-OBS-1, NFR-PERF). */
export const TRACES_SAMPLE_RATE = 0.2;

const REDACTED = '[redacted]';

/** Emails, quoted text and Postgres key details such as `Key (name)=(Alice)`. */
const EMAIL = /[^\s@<>"'()[\]]+@[^\s@<>"'()[\]]+\.[^\s@<>"'()[\]]+/g;
const QUOTED = /"[^"]*"|“[^”]*”|‘[^’]*’|«[^»]*»/g;
const KEY_DETAIL = /=\([^)]*\)/g;

/**
 * Removes the parts of an error message that can hold what the user typed. Engine messages
 * quote code with single quotes (`evaluating 'a.b'`), which are kept for debugging.
 */
export function redactText(text: string): string {
  return text
    .replace(KEY_DETAIL, `=(${REDACTED})`)
    .replace(QUOTED, REDACTED)
    .replace(EMAIL, REDACTED);
}

/**
 * Drops a URL's query and fragment, which can hold search text, invite codes, filter values
 * (`?name=eq.Alice`) or sign-in tokens. The path holds only routes, tables and IDs.
 */
export function scrubUrl(url: string): string {
  const cut = url.search(/[?#]/);
  return cut === -1 ? url : url.slice(0, cut);
}

/** Event contexts that describe the app and device, never the user. */
const ALLOWED_CONTEXTS = new Set([
  'app',
  'device',
  'os',
  'runtime',
  'trace',
  'culture',
  'expo_updates',
  'react_native_context',
]);

/** Breadcrumb data keys that hold fixed values; URLs are scrubbed. */
const ALLOWED_BREADCRUMB_DATA = new Set(['method', 'status_code', 'url', 'from', 'to', 'state']);
const URL_KEYS = new Set(['url', 'from', 'to']);

/**
 * Keeps a breadcrumb only with fixed data. Console breadcrumbs are dropped, because logged
 * values can be anything, and touch breadcrumbs lose their labels, which are screen text.
 */
export function scrubBreadcrumb(breadcrumb: Sentry.Breadcrumb): Sentry.Breadcrumb | null {
  if (breadcrumb.category === 'console') return null;
  const scrubbed: Sentry.Breadcrumb = { ...breadcrumb };
  if (scrubbed.message !== undefined) {
    scrubbed.message =
      breadcrumb.category === 'touch' ? undefined : scrubUrl(redactText(scrubbed.message));
  }
  if (breadcrumb.data) {
    const data: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(breadcrumb.data)) {
      if (!ALLOWED_BREADCRUMB_DATA.has(key)) continue;
      data[key] = URL_KEYS.has(key) && typeof value === 'string' ? scrubUrl(value) : value;
    }
    scrubbed.data = data;
  }
  return scrubbed;
}

type AnyEvent = Sentry.ErrorEvent | Sentry.TransactionEvent;

/**
 * Strips user content from an event before it's sent (NFR-SEC-6): request data, extras and
 * any user field but the ID go; messages are redacted; URLs lose their queries.
 */
export function scrubEvent<T extends AnyEvent>(event: T): T {
  const scrubbed: T = { ...event };
  delete scrubbed.request;
  delete scrubbed.extra;
  delete scrubbed.server_name;
  scrubbed.user = event.user?.id ? { id: event.user.id } : undefined;
  if (scrubbed.message) scrubbed.message = redactText(scrubbed.message);
  if (scrubbed.transaction) scrubbed.transaction = scrubUrl(scrubbed.transaction);
  if (event.exception?.values) {
    scrubbed.exception = {
      ...event.exception,
      values: event.exception.values.map((value) => ({
        ...value,
        value: value.value === undefined ? undefined : redactText(value.value),
      })),
    };
  }
  if (event.contexts) {
    const contexts: NonNullable<AnyEvent['contexts']> = {};
    for (const [key, value] of Object.entries(event.contexts)) {
      if (!ALLOWED_CONTEXTS.has(key) || !value) continue;
      // The device's name is often the owner's ("Sam's iPhone").
      contexts[key] = key === 'device' ? { ...value, name: undefined } : value;
    }
    scrubbed.contexts = contexts;
  }
  if (event.breadcrumbs) {
    scrubbed.breadcrumbs = event.breadcrumbs
      .map(scrubBreadcrumb)
      .filter((crumb): crumb is Sentry.Breadcrumb => crumb !== null);
  }
  if (event.spans) {
    scrubbed.spans = event.spans.map((span) => ({
      ...span,
      description: span.description === undefined ? undefined : scrubUrl(span.description),
      data: Object.fromEntries(
        Object.entries(span.data ?? {}).filter(
          ([key]) => !/query|fragment|body/.test(key) && key !== 'url',
        ),
      ),
    }));
  }
  return scrubbed;
}

/** Whether crash reports are sent from this build. */
export function crashReportingEnabled(): boolean {
  return dsn !== undefined;
}

/** Starts Sentry as early as possible at launch. Does nothing without a DSN. */
export function initCrashReporting(): void {
  if (!dsn) return;
  Sentry.init({
    dsn,
    environment: String(Constants.expoConfig?.extra?.appVariant ?? 'production'),
    sendDefaultPii: false,
    attachScreenshot: false,
    attachViewHierarchy: false,
    replaysSessionSampleRate: 0,
    replaysOnErrorSampleRate: 0,
    tracesSampleRate: TRACES_SAMPLE_RATE,
    beforeSend: (event) => scrubEvent(event),
    beforeSendTransaction: (event) => scrubEvent(event),
    beforeBreadcrumb: (breadcrumb) => scrubBreadcrumb(breadcrumb),
  });
  // Ties reports to the OTA update that was running (F-03.3).
  const scope = Sentry.getGlobalScope();
  scope.setTag('expo-update-id', Updates.updateId ?? 'embedded');
  scope.setTag('expo-channel', Updates.channel ?? 'none');
  scope.setTag('expo-runtime-version', Updates.runtimeVersion ?? 'unknown');
}

type RootProps = Record<string, unknown>;

/** Wraps the root component so Sentry can trace it. Returns it unchanged without a DSN. */
export function wrapRoot(component: ComponentType<RootProps>): ComponentType<RootProps> {
  return dsn ? Sentry.wrap(component) : component;
}

/** Tags reports with the signed-in user's ID, and nothing else about them. */
export function setCrashUser(userId: string | null): void {
  if (!dsn) return;
  Sentry.setUser(userId ? { id: userId } : null);
}

/** Reports an error that was caught and handled, so it still shows up in Sentry. */
export function reportError(error: unknown): void {
  if (!dsn) return;
  Sentry.captureException(error);
}
