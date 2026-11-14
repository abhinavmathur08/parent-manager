import 'expo-sqlite/localStorage/install';

import { getSupabase } from '@/lib/supabase';

/**
 * Remote config (F-09, NFR-REL-4), read from `app_config` at launch and whenever the app
 * returns to the foreground. It lives in Supabase rather than PostHog, so it works when
 * analytics is off or blocked (architecture section 9). Keys:
 *
 * - `app.minimum_version`: `{"ios": "1.2.0", "android": "1.2.0"}`, or one string for both.
 *   Older versions show the blocking update screen (S-01).
 * - `app.store_url`: `{"ios": "https://apps.apple.com/app/id…", "android": "https://…"}`,
 *   where the update screen sends people. Android falls back to the Play listing.
 * - `app.kill_switches`: `{"ai_import": true, "export.pdf": true}`. A switch set to true
 *   turns that feature off without a release.
 */

export const CONFIG_KEYS = ['app.minimum_version', 'app.store_url', 'app.kill_switches'] as const;

/** Features that can be turned off remotely: AI import and each list export target. */
export const KILL_SWITCHES = [
  'ai_import',
  'export.print',
  'export.pdf',
  'export.apple_reminders',
  'export.share_text',
  'export.copy_text',
] as const;
export type KillSwitch = (typeof KILL_SWITCHES)[number];

export type Platform = 'ios' | 'android';

export type RemoteConfig = {
  minimumVersion: string | null;
  storeUrl: string | null;
  disabled: readonly KillSwitch[];
};

export const DEFAULT_CONFIG: RemoteConfig = { minimumVersion: null, storeUrl: null, disabled: [] };

/** How long the launch check waits before it gives up and lets the app open (fails open). */
export const FETCH_TIMEOUT_MS = 5000;

const VERSION = /^\d+(\.\d+){0,3}$/;
const STORE_URL = /^(https:\/\/|itms-apps:\/\/|market:\/\/)\S+$/;

function forPlatform(value: unknown, platform: Platform): unknown {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return (value as Record<string, unknown>)[platform];
  }
  return value;
}

/** Reads the config rows for one platform, ignoring anything malformed. */
export function parseRemoteConfig(
  rows: readonly { key: string; value: unknown }[],
  platform: Platform,
): RemoteConfig {
  const byKey = new Map(rows.map((row) => [row.key, row.value]));
  const version = forPlatform(byKey.get('app.minimum_version'), platform);
  const url = forPlatform(byKey.get('app.store_url'), platform);
  const switches = byKey.get('app.kill_switches');
  const disabled =
    switches && typeof switches === 'object' && !Array.isArray(switches)
      ? KILL_SWITCHES.filter((name) => (switches as Record<string, unknown>)[name] === true)
      : [];
  return {
    minimumVersion:
      typeof version === 'string' && VERSION.test(version.trim()) ? version.trim() : null,
    storeUrl: typeof url === 'string' && STORE_URL.test(url.trim()) ? url.trim() : null,
    disabled,
  };
}

/** Compares dotted versions numerically: negative if `a` is older than `b`. */
export function compareVersions(a: string, b: string): number {
  const left = a.split('.').map(Number);
  const right = b.split('.').map(Number);
  for (let i = 0; i < Math.max(left.length, right.length); i += 1) {
    const diff = (left[i] ?? 0) - (right[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

/** Whether this version is below the minimum. An unknown version never blocks. */
export function isBelowMinimum(appVersion: string | null | undefined, minimum: string | null) {
  if (!minimum || !appVersion || !VERSION.test(appVersion)) return false;
  return compareVersions(appVersion, minimum) < 0;
}

/** Fetches the config, or throws when offline or slow, so callers can fail open. */
export async function fetchRemoteConfig(platform: Platform): Promise<RemoteConfig> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const { data, error } = await getSupabase()
      .from('app_config')
      .select('key, value')
      .in('key', [...CONFIG_KEYS])
      .abortSignal(controller.signal);
    if (error) throw error;
    return parseRemoteConfig(data ?? [], platform);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * The kill switches seen last, so a feature stays off on the next launch before the fetch
 * returns. The minimum version isn't kept: offline, the app always opens (fails open).
 */
const CACHE_KEY = 'remote_config.disabled';

export function readCachedKillSwitches(): KillSwitch[] {
  try {
    const parsed: unknown = JSON.parse(globalThis.localStorage?.getItem(CACHE_KEY) ?? '[]');
    return Array.isArray(parsed) ? KILL_SWITCHES.filter((name) => parsed.includes(name)) : [];
  } catch {
    return [];
  }
}

export function writeCachedKillSwitches(disabled: readonly KillSwitch[]): void {
  try {
    globalThis.localStorage?.setItem(CACHE_KEY, JSON.stringify(disabled));
  } catch {
    // Not cached: the next launch shows every feature until the fetch returns.
  }
}
